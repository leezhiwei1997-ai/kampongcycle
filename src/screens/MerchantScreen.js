// src/screens/MerchantScreen.js
import React, {
  useState, useCallback, useEffect,
} from 'react';
import {
  View, ScrollView, SafeAreaView, StatusBar, Image, Alert, StyleSheet, RefreshControl,
} from 'react-native';
import {
  Text, Button, Card, TextInput, Surface, ActivityIndicator,
  Portal, Modal, Dialog, Divider, Avatar, useTheme, BottomNavigation, SegmentedButtons,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';

import { toMoney } from '../utils/format';
import { COLLECT_BY_PRESETS, formatRelativeTime } from '../utils/time';
import { identifyDishFromImage } from '../services/geminiService';
import {
  fetchDealsForMerchant, publishFoodDeal, updateFoodDeal, removeFoodDeal,
  getImpactStats, getMerchantRatingStats,
  fetchReservationsForMerchant, beginHandover, resolveReservation,
  getFollowerCount, getReviewsForMerchant,
  attachStallCategories, autoExpireReservation, setMerchantStatus,
} from '../services/appDataService';
import StarRating from '../components/StarRating';
import CollectByBadge from '../components/CollectByBadge';
import { splitListings, archiveReason, portionsLeft } from '../utils/listings';
import EarningsTab from '../components/EarningsTab';
import HandoverQr from '../components/HandoverQr';
import ReservationCard from '../components/ReservationCard';
import MessageThread from '../components/MessageThread';
import StoreSetup from '../components/StoreSetup';
import StaffManagement from '../components/StaffManagement';
import {
  classifyReservation, groupByDay, fulfilmentSummary, isResolvedState, openCount,
} from '../utils/reservations';
import { getUserById, listStalls, pickOwnStall } from '../services/authService';
import {
  isStaff, stallEmailFor, canViewEarnings, canManageStalls, canManageStaff,
} from '../utils/permissions';
import { useAuth } from '../context/AuthContext';

const IMAGE_QUALITY = 0.3;

function ListingsTab({ theme }) {
  const { user } = useAuth();
  const staffMember = isStaff(user);
  const stallEmail = stallEmailFor(user);
  const ownerUid = staffMember ? user.assignedOwnerUid : user.uid;

  // Staff carry no `verified` of their own (see isActiveStaff() in
  // firestore.rules) — their publish permission depends on the OWNER's
  // verification, fetched once here rather than trusting a stale value.
  const [ownerVerified, setOwnerVerified] = useState(staffMember ? false : user.verified);
  useEffect(() => {
    if (!staffMember) { setOwnerVerified(user.verified); return; }
    getUserById(user.assignedOwnerUid)
      .then((owner) => setOwnerVerified(!!owner?.verified))
      .catch(() => setOwnerVerified(false));
  }, [staffMember, user.assignedOwnerUid, user.verified]);

  const [myDeals, setMyDeals] = useState([]);
  const [isLoadingDeals, setIsLoadingDeals] = useState(true);
  const [mealsSaved, setMealsSaved] = useState(null);
  const [stalls, setStalls] = useState([]);
  const [selectedStallId, setSelectedStallId] = useState(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingDealId, setEditingDealId] = useState(null);
  const [imageUri, setImageUri] = useState(null);
  const [storedImageBase64, setStoredImageBase64] = useState(null);
  const [existingImage, setExistingImage] = useState(null);
  const [dishName, setDishName] = useState('');
  const [stallName, setStallName] = useState(user.name || 'My Hawker Stall');
  const [discountPrice, setDiscountPrice] = useState('3.00');
  const [originalPrice, setOriginalPrice] = useState('6.00');
  const [quantity, setQuantity] = useState('1');
  const [collectMinutes, setCollectMinutes] = useState(60);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [aiWarning, setAiWarning] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadMyDeals = useCallback(async () => {
    try {
      setMyDeals(await fetchDealsForMerchant(stallEmail));
    } catch (err) {
      Alert.alert('Could not load your listings', err.message || 'Please try again.');
    } finally {
      setIsLoadingDeals(false);
      setIsRefreshing(false);
    }
  }, [stallEmail]);

  const loadImpact = useCallback(async () => {
    try {
      const stats = await getImpactStats(stallEmail);
      setMealsSaved(stats.mealsSaved);
    } catch (err) {
      setMealsSaved(0);
    }
  }, [stallEmail]);

  const loadStalls = useCallback(async () => {
    try {
      const list = await listStalls(ownerUid);
      setStalls(list);
      setSelectedStallId((prev) => prev ?? (list[0]?.id || null));
    } catch {
      setStalls([]);
    }
  }, [ownerUid]);

  useEffect(() => { loadMyDeals(); loadImpact(); loadStalls(); }, [loadMyDeals, loadImpact, loadStalls]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadMyDeals();
    loadImpact();
    loadStalls();
  }, [loadMyDeals, loadImpact, loadStalls]);

  const handlePickOwnStall = useCallback(async (stallId) => {
    try {
      await pickOwnStall(user.uid, stallId);
    } catch (err) {
      Alert.alert('Could not set your stall', err.message || 'Please try again.');
    }
  }, [user.uid]);

  const runAiAnalysis = useCallback(async (base64) => {
    setIsAnalyzing(true);
    setAiWarning('');
    setDishName('');
    try {
      const identified = await identifyDishFromImage(base64);
      if (identified) {
        setDishName(identified);
        setAiWarning(`✅ Identified: ${identified}`);
      } else {
        setAiWarning('❌ Dish not recognized. Please enter the dish name manually.');
      }
    } catch (err) {
      setAiWarning(err.message === 'MISSING_KEY'
        ? '⚠️ No Gemini API key configured. Enter the dish name manually for now.'
        : `⚠️ ${err.message || 'AI analysis failed.'} Please enter the dish name manually.`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const openNewListingModal = useCallback(async () => {
    if (!ownerVerified) {
      Alert.alert(
        'Account pending verification',
        'An admin needs to approve your stall owner\'s account before you can publish listings. Pull down to refresh once they\'ve been approved.',
      );
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Camera access is required to snap a meal photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true, base64: true, quality: IMAGE_QUALITY,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setEditingDealId(null);
      setExistingImage(null);
      setImageUri(asset.uri);
      setStoredImageBase64(null);
      setDishName('');
      setDiscountPrice('3.00');
      setOriginalPrice('6.00');
      setQuantity('1');
      setCollectMinutes(60);
      setModalVisible(true);
      runAiAnalysis(asset.base64);

      try {
        const resized = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 640 } }],
          { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        setStoredImageBase64(resized.base64);
      } catch (resizeErr) {
        setStoredImageBase64(null);
      }
    } catch (err) {
      Alert.alert('Camera error', err.message || 'Could not open the camera. Please try again.');
    }
  }, [runAiAnalysis, ownerVerified]);

  const openEditModal = useCallback((deal) => {
    setEditingDealId(deal.id);
    setImageUri(null);
    setStoredImageBase64(null);
    setExistingImage(deal.image || null);
    setDishName(deal.item || '');
    setStallName(deal.stall || '');
    setDiscountPrice((deal.price || '$0').replace('$', ''));
    setOriginalPrice((deal.originalPrice || '$0').replace('$', ''));
    setQuantity(String(deal.quantity ?? 1));
    setCollectMinutes(60);
    setAiWarning('');
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingDealId(null);
    setImageUri(null);
    setStoredImageBase64(null);
    setExistingImage(null);
    setAiWarning('');
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedDish = dishName.trim();
    if (!trimmedDish) {
      Alert.alert('Missing dish name', 'Please enter a dish name before publishing.');
      return;
    }
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert('Invalid quantity', 'Please enter at least 1 portion.');
      return;
    }

    setIsPublishing(true);
    try {
      const collectByTimestamp = Date.now() + collectMinutes * 60000;
      const image = storedImageBase64
        ? `data:image/jpeg;base64,${storedImageBase64}`
        : existingImage;

      let payload = {
        stall: stallName.trim(),
        item: trimmedDish,
        price: toMoney(discountPrice),
        originalPrice: toMoney(originalPrice),
        image,
        quantity: qty,
        collectByTimestamp,
        merchantEmail: stallEmail,
      };
      if (selectedStallId) {
        payload = await attachStallCategories(payload, ownerUid, selectedStallId);
      }

      if (editingDealId) {
        await updateFoodDeal(editingDealId, payload);
        setMyDeals((prev) => prev.map((d) => (d.id === editingDealId ? { ...d, ...payload } : d)));
        Alert.alert('Updated! ✅', 'Your listing has been updated.');
      } else {
        let location = null;
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const position = await Location.getCurrentPositionAsync({});
            location = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
          }
        } catch (locErr) {
          // Location is optional — publishing still proceeds without it.
        }
        const published = await publishFoodDeal({ ...payload, location });
        setMyDeals((prev) => [published, ...prev]);
        Alert.alert('Published! 🎉', 'Your listing is now live for customers to reserve.');
      }

      closeModal();
    } catch (err) {
      Alert.alert('Could not save listing', err.message || 'Please try again.');
    } finally {
      setIsPublishing(false);
    }
  }, [
    dishName, stallName, discountPrice, originalPrice, quantity, collectMinutes,
    storedImageBase64, existingImage, editingDealId, stallEmail, ownerUid, selectedStallId, closeModal,
  ]);

  const handleRemoveDeal = useCallback((dealId) => {
    Alert.alert('Remove listing?', 'This will take it off the marketplace.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFoodDeal(dealId);
            setMyDeals((prev) => prev.filter((d) => d.id !== dealId));
          } catch (err) {
            Alert.alert('Could not remove listing', err.message || 'Please try again.');
          }
        },
      },
    ]);
  }, []);

  // Derived on every render from quantity + collectByTimestamp — nothing is
  // written to mark a listing expired, so it's correct the moment it renders.
  const { active: activeDeals, archived: archivedDeals } = splitListings(myDeals);

  return (
    <ScrollView
      style={styles.tabContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Surface style={[styles.impactBanner, { backgroundColor: theme.colors.primary }]} elevation={1}>
        <Text variant="displaySmall" style={styles.impactCount}>
          {mealsSaved === null ? '—' : mealsSaved}
        </Text>
        <Text variant="bodySmall" style={styles.impactLabel}>meals saved from your stall 🌍</Text>
      </Surface>

      {!ownerVerified && (
        <Card style={[styles.aiCard, { backgroundColor: '#fff3cd' }]} mode="contained">
          <Card.Content style={{ alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', textAlign: 'center' }}>
              ⏳ Account pending verification
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>
              An admin needs to approve your {staffMember ? "stall owner's" : ''} account before you can publish listings.
              Pull down to refresh once {staffMember ? "they've" : "you've"} been approved.
            </Text>
          </Card.Content>
        </Card>
      )}

      {staffMember && !user.assignedStallId && stalls.length > 0 && (
        <Card style={[styles.aiCard, { backgroundColor: '#e8f4fd' }]} mode="contained">
          <Card.Content style={{ alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', textAlign: 'center' }}>
              Which stall do you work at?
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4, marginBottom: 10 }}>
              This is a one-time choice — an owner or admin can change it later.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {stalls.map((s) => (
                <Button key={s.id} mode="outlined" compact onPress={() => handlePickOwnStall(s.id)}>
                  {s.stallName}
                </Button>
              ))}
            </View>
          </Card.Content>
        </Card>
      )}

      <Card style={styles.aiCard} mode="contained">
        <Card.Content style={{ alignItems: 'center' }}>
          <Text variant="titleMedium" style={{ color: theme.colors.error, fontWeight: 'bold' }}>
            List Surplus Food 📸
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Snap a photo to auto-detect the dish and list it
          </Text>
          <Button
            mode="contained"
            buttonColor={theme.colors.error}
            onPress={openNewListingModal}
            icon="camera"
            disabled={!ownerVerified}
          >
            Snap & List
          </Button>
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        Your Active Listings ({activeDeals.length})
      </Text>

      {isLoadingDeals ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : activeDeals.length === 0 ? (
        <Text style={styles.emptyText}>No active listings. Snap a meal above to add one.</Text>
      ) : (
        activeDeals.map((deal) => (
          <Card key={deal.id} style={styles.dealCard} mode="elevated">
            <Card.Content style={styles.dealCardContent}>
              {deal.image && <Avatar.Image size={48} source={{ uri: deal.image }} style={{ marginRight: 12 }} />}
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{deal.item}</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.secondary, fontWeight: 'bold' }}>
                  {deal.price} <Text style={{ textDecorationLine: 'line-through', color: theme.colors.outline, fontSize: 12 }}>{deal.originalPrice}</Text>
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  🍽️ {deal.quantity ?? 1} portion{(deal.quantity ?? 1) === 1 ? '' : 's'} left
                </Text>
                <CollectByBadge collectByTimestamp={deal.collectByTimestamp} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Button mode="outlined" onPress={() => openEditModal(deal)} compact style={{ marginBottom: 6 }}>
                  Edit
                </Button>
                <Button mode="contained" buttonColor={theme.colors.error} onPress={() => handleRemoveDeal(deal.id)} compact>
                  Remove
                </Button>
              </View>
            </Card.Content>
          </Card>
        ))
      )}

      {archivedDeals.length > 0 && (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Archived ({archivedDeals.length})
          </Text>
          {archivedDeals.map((deal) => (
            <Card key={deal.id} style={[styles.dealCard, { opacity: 0.65 }]} mode="outlined">
              <Card.Content style={styles.dealCardContent}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{deal.item}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {archiveReason(deal)} · {portionsLeft(deal)} left
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Button mode="outlined" onPress={() => openEditModal(deal)} compact style={{ marginBottom: 6 }}>
                    Relist
                  </Button>
                  <Button mode="text" textColor={theme.colors.error} onPress={() => handleRemoveDeal(deal.id)} compact>
                    Delete
                  </Button>
                </View>
              </Card.Content>
            </Card>
          ))}
        </>
      )}

      <Portal>
        <Modal visible={modalVisible} onDismiss={closeModal} contentContainerStyle={styles.modalContent}>
          <ScrollView>
            <Text variant="titleLarge" style={{ textAlign: 'center', marginBottom: 12 }}>
              {editingDealId ? 'Edit Listing' : 'AI Vision Scan'}
            </Text>
            {(imageUri || existingImage) && (
              <Image source={{ uri: imageUri || existingImage }} style={styles.modalImage} />
            )}

            {isAnalyzing ? (
              <View style={{ alignItems: 'center', marginVertical: 20 }}>
                <ActivityIndicator size="large" />
                <Text style={{ marginTop: 8, color: theme.colors.primary }}>Analyzing dish features with Vision AI...</Text>
              </View>
            ) : (
              <View>
                {!!aiWarning && (
                  <Text style={{ color: theme.colors.error, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>
                    {aiWarning}
                  </Text>
                )}
                <TextInput label="Dish Name" value={dishName} onChangeText={setDishName} mode="outlined" style={styles.input} />
                <TextInput label="Stall Name" value={stallName} onChangeText={setStallName} mode="outlined" style={styles.input} />
                {stalls.length > 1 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>Which stall is this for?</Text>
                    <SegmentedButtons
                      value={selectedStallId || ''}
                      onValueChange={setSelectedStallId}
                      buttons={stalls.map((s) => ({ value: s.id, label: s.stallName }))}
                    />
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <TextInput
                    label="Discount ($)"
                    value={discountPrice}
                    onChangeText={setDiscountPrice}
                    mode="outlined"
                    keyboardType="decimal-pad"
                    style={[styles.input, { width: '48%' }]}
                  />
                  <TextInput
                    label="Original ($)"
                    value={originalPrice}
                    onChangeText={setOriginalPrice}
                    mode="outlined"
                    keyboardType="decimal-pad"
                    style={[styles.input, { width: '48%' }]}
                  />
                </View>

                <TextInput
                  label="Quantity Available"
                  value={quantity}
                  onChangeText={setQuantity}
                  mode="outlined"
                  keyboardType="number-pad"
                  style={styles.input}
                />

                <Text style={styles.label}>Collect within:</Text>
                <SegmentedButtons
                  value={String(collectMinutes)}
                  onValueChange={(v) => setCollectMinutes(Number(v))}
                  buttons={COLLECT_BY_PRESETS.map((p) => ({ value: String(p.minutes), label: p.label }))}
                  style={{ marginBottom: 4 }}
                />
                {editingDealId && (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                    Saving will reset the collection window to start counting down from now.
                  </Text>
                )}

                <View style={styles.modalButtons}>
                  <Button mode="outlined" onPress={closeModal} disabled={isPublishing} style={{ width: '48%' }}>
                    Cancel
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleSubmit}
                    loading={isPublishing}
                    disabled={isPublishing}
                    style={{ width: '48%' }}
                  >
                    {editingDealId ? 'Save Changes' : 'Publish Live'}
                  </Button>
                </View>
              </View>
            )}
          </ScrollView>
        </Modal>
      </Portal>
    </ScrollView>
  );
}

function ReservationsTab({ theme }) {
  const { user } = useAuth();
  const staffMember = isStaff(user);
  const stallEmail = stallEmailFor(user);
  const [reservations, setReservations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [handover, setHandover] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [dispute, setDispute] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [messageTarget, setMessageTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await fetchReservationsForMerchant(stallEmail);
      // Opportunistic sweep — no Cloud Functions in this app, so this runs
      // from whichever stall member's device has the tab open. Best-effort:
      // a failed sweep just leaves those rows 'pending' until the next load.
      const expiredIds = await autoExpireReservation(rows, user.uid).catch(() => []);
      setReservations(expiredIds.length
        ? rows.map((r) => (expiredIds.includes(r.id) ? { ...r, status: 'expired' } : r))
        : rows);
    } catch (err) {
      Alert.alert('Could not load reservations', err.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [stallEmail, user.uid]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    load();
  }, [load]);

  const handleHandOver = useCallback(async (r) => {
    try {
      const { nonce, handoverExpiresAt } = await beginHandover(r.id, r, user.uid);
      setReservations((prev) => prev.map((x) => (x.id === r.id
        ? { ...x, status: 'awaiting_handover', handoverNonce: nonce, handoverExpiresAt }
        : x)));
      setHandover({
        reservationId: r.id,
        nonce,
        expiresAt: handoverExpiresAt,
        issuedAt: Date.now(),
        item: r.item,
      });
    } catch (err) {
      Alert.alert('Could not start handover', err.message || 'Please try again.');
    }
  }, [user.uid]);

  // Re-issues the nonce in place. Writing a new one invalidates the old
  // immediately — the rule compares the scan against whatever is currently on
  // the document — so there's nothing to revoke separately.
  const handleRefreshQr = useCallback(async () => {
    if (!handover) return;
    try {
      const target = reservations.find((x) => x.id === handover.reservationId);
      const { nonce, handoverExpiresAt } = await beginHandover(
        handover.reservationId, target, user.uid,
      );
      setReservations((prev) => prev.map((x) => (x.id === handover.reservationId
        ? { ...x, handoverNonce: nonce, handoverExpiresAt }
        : x)));
      setHandover((h) => ({
        ...h, nonce, expiresAt: handoverExpiresAt, issuedAt: Date.now(),
      }));
    } catch (err) {
      Alert.alert('Could not refresh the code', err.message || 'Please try again.');
    }
  }, [handover, reservations, user.uid]);

  const handleResolve = useCallback(async (reservationId, outcome) => {
    try {
      await resolveReservation(reservationId, outcome, { actorUid: user.uid });
      setReservations((prev) => prev.map(
        (r) => (r.id === reservationId ? { ...r, status: outcome } : r),
      ));
    } catch (err) {
      Alert.alert('Could not update', err.message || 'Please try again.');
    }
  }, [user.uid]);

  const handleSetMerchantStatus = useCallback(async (reservationId, value) => {
    try {
      await setMerchantStatus(reservationId, value);
      setReservations((prev) => prev.map(
        (r) => (r.id === reservationId ? { ...r, merchantStatus: value } : r),
      ));
    } catch (err) {
      Alert.alert('Could not update status', err.message || 'Please try again.');
    }
  }, []);

  const handleOpenMessage = useCallback(async (r) => {
    let notifyTarget = null;
    try {
      const customer = await getUserById(r.customerUid);
      notifyTarget = customer?.pushToken || null;
    } catch {
      // Best-effort — the thread still opens without push notification.
    }
    setMessageTarget({ reservation: r, notifyTarget });
  }, []);

  const submitDispute = useCallback(async () => {
    if (!dispute || !disputeReason.trim()) return;
    try {
      await resolveReservation(dispute.id, 'disputed', {
        actorUid: user.uid, reason: disputeReason,
      });
      setReservations((prev) => prev.map(
        (r) => (r.id === dispute.id ? { ...r, status: 'disputed' } : r),
      ));
      setDispute(null);
      setDisputeReason('');
    } catch (err) {
      Alert.alert('Could not raise dispute', err.message || 'Please try again.');
    }
  }, [dispute, disputeReason, user.uid]);

  if (isLoading) {
    return (
      <View style={styles.tabContent}>
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      </View>
    );
  }

  const days = groupByDay(reservations);
  const summary = fulfilmentSummary(reservations);

  return (
    <ScrollView
      style={styles.tabContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Card style={{ marginBottom: 12 }} mode="contained">
        <Card.Content>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text variant="titleMedium">Fulfilment</Text>
            <Text variant="headlineSmall" style={{ color: theme.colors.primary }}>
              {summary.rate == null ? '—' : `${Math.round(summary.rate * 100)}%`}
            </Text>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            {summary.counts.collected} collected · {summary.counts.merchantFault} missed · {summary.counts.noShow} no-show
            {summary.counts.disputed > 0 ? ` · ${summary.counts.disputed} under review` : ''}
          </Text>
          {(summary.counts.needsReview + summary.counts.unconfirmed) > 0 && (
            <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 4 }}>
              {summary.counts.needsReview + summary.counts.unconfirmed} order(s) to account for — these count against you until you do
            </Text>
          )}
        </Card.Content>
      </Card>

      {days.length === 0 && <Text style={styles.emptyText}>No reservations yet.</Text>}

      {days.map((day) => {
        const open = day.items.filter((r) => !isResolvedState(classifyReservation(r)));
        const done = day.items.filter((r) => isResolvedState(classifyReservation(r)));
        const showDone = collapsed[day.key];

        return (
          <View key={day.key}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {day.label}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
              {openCount(day.items) > 0
                ? `${openCount(day.items)} open · ${day.collected}/${day.total} collected`
                : `${day.collected}/${day.total} collected`}
            </Text>

            {open.map((r) => (
              <ReservationCard
                key={r.id}
                reservation={r}
                onHandOver={handleHandOver}
                onShowCode={(x) => setHandover({
                  reservationId: x.id,
                  nonce: x.handoverNonce,
                  expiresAt: x.handoverExpiresAt,
                  issuedAt: 0,
                  item: x.item,
                })}
                onResolve={handleResolve}
                onDispute={(x) => { setDispute(x); setDisputeReason(''); }}
                onSetMerchantStatus={handleSetMerchantStatus}
                onMessage={handleOpenMessage}
              />
            ))}

            {done.length > 0 && (
              <>
                <Button
                  mode="text"
                  compact
                  onPress={() => setCollapsed((c) => ({ ...c, [day.key]: !c[day.key] }))}
                  style={{ alignSelf: 'flex-start', marginBottom: 8 }}
                >
                  {showDone ? 'Hide' : `Show ${done.length} finished`}
                </Button>
                {showDone && done.map((r) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    onHandOver={handleHandOver}
                    onShowCode={() => {}}
                    onResolve={handleResolve}
                    onDispute={(x) => { setDispute(x); setDisputeReason(''); }}
                    onSetMerchantStatus={handleSetMerchantStatus}
                    onMessage={handleOpenMessage}
                  />
                ))}
              </>
            )}
            <Divider style={{ marginTop: 4, marginBottom: 14 }} />
          </View>
        );
      })}

      <HandoverQr
        visible={!!handover}
        onDismiss={() => { setHandover(null); load(); }}
        reservationId={handover?.reservationId}
        nonce={handover?.nonce}
        expiresAt={handover?.expiresAt}
        issuedAt={handover?.issuedAt}
        item={handover?.item}
        onRefresh={handleRefreshQr}
      />

      <MessageThread
        visible={!!messageTarget}
        onDismiss={() => setMessageTarget(null)}
        reservationId={messageTarget?.reservation?.id}
        currentUid={user.uid}
        senderRole={staffMember ? 'staff' : 'owner'}
        item={messageTarget?.reservation?.item}
        notifyTarget={messageTarget?.notifyTarget}
      />

      <Portal>
        <Dialog visible={!!dispute} onDismiss={() => setDispute(null)}>
          <Dialog.Title>Raise a dispute</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={{ marginBottom: 10 }}>
              An admin will read this and decide. Say what happened — when you handed
              it over, and why the customer didn&apos;t confirm.
            </Text>
            <TextInput
              mode="outlined"
              label="What happened"
              value={disputeReason}
              onChangeText={setDisputeReason}
              multiline
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDispute(null)}>Cancel</Button>
            <Button onPress={submitDispute} disabled={!disputeReason.trim()}>Submit</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

function ProfileTab({ theme }) {
  const { user, logout } = useAuth();
  const staffMember = isStaff(user);
  const stallEmail = stallEmailFor(user);
  const ownerUid = staffMember ? user.assignedOwnerUid : user.uid;
  const [ratingStats, setRatingStats] = useState(null);
  const [followerCount, setFollowerCount] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);
  const [storeSetupVisible, setStoreSetupVisible] = useState(false);
  const [staffManagementVisible, setStaffManagementVisible] = useState(false);

  useEffect(() => {
    getMerchantRatingStats(stallEmail)
      .then(setRatingStats)
      .catch(() => setRatingStats({ average: null, count: 0 }));
    getFollowerCount(stallEmail)
      .then(setFollowerCount)
      .catch(() => setFollowerCount(0));
    getReviewsForMerchant(stallEmail)
      .then(setReviews)
      .catch(() => setReviews([]))
      .finally(() => setIsLoadingReviews(false));
  }, [stallEmail]);

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { alignItems: 'center', paddingTop: 40 }]}>
      <Avatar.Text size={80} label={user.name?.[0]?.toUpperCase() || '?'} style={{ backgroundColor: theme.colors.primary }} />
      <Text variant="titleLarge" style={{ marginTop: 12 }}>{user.name}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
        {staffMember ? `Staff at ${user.assignedOwnerEmail}` : 'Stall owner account'}
      </Text>
      {!staffMember && (
        <Text
          variant="bodySmall"
          style={{
            marginTop: 4, fontWeight: 'bold', color: user.verified ? theme.colors.primary : theme.colors.error,
          }}
        >
          {user.verified ? '✓ Verified' : '⏳ Pending verification'}
        </Text>
      )}
      {ratingStats && (
        <View style={{ marginTop: 12 }}>
          <StarRating value={ratingStats.average || 0} size={22} showCount count={ratingStats.count} />
        </View>
      )}
      {followerCount !== null && (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
          ❤️ {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
        </Text>
      )}

      <View style={{ width: '100%', marginTop: 28 }}>
        <Text variant="titleMedium" style={styles.sectionTitle}>Recent reviews</Text>
        {isLoadingReviews ? (
          <ActivityIndicator style={{ marginTop: 12 }} />
        ) : reviews.length === 0 ? (
          <Text style={styles.emptyText}>No reviews yet.</Text>
        ) : (
          reviews.map((r) => (
            <Card key={r.id} style={styles.dealCard} mode="elevated">
              <Card.Content>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="titleSmall">{r.customerName}</Text>
                  <StarRating value={r.rating} size={14} />
                </View>
                {!!r.item && (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    on {r.item}
                  </Text>
                )}
                <Text variant="bodyMedium" style={{ marginTop: 4 }}>{r.comment}</Text>
              </Card.Content>
            </Card>
          ))
        )}
      </View>

      {(canManageStalls(user) || canManageStaff(user)) && (
        <View style={{ width: '100%', marginTop: 28 }}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Stall management</Text>
          {canManageStalls(user) && (
            <Button mode="outlined" icon="storefront" onPress={() => setStoreSetupVisible(true)} style={{ marginBottom: 10 }}>
              Manage stalls
            </Button>
          )}
          {canManageStaff(user) && (
            <Button mode="outlined" icon="account-group" onPress={() => setStaffManagementVisible(true)}>
              Your staff
            </Button>
          )}
        </View>
      )}

      <StoreSetup visible={storeSetupVisible} onDismiss={() => setStoreSetupVisible(false)} ownerUid={ownerUid} />
      <StaffManagement visible={staffManagementVisible} onDismiss={() => setStaffManagementVisible(false)} ownerUid={ownerUid} />

      <Button mode="contained" buttonColor={theme.colors.error} onPress={logout} style={{ marginTop: 24 }}>
        Log Out
      </Button>
    </ScrollView>
  );
}

export default function MerchantScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'listings', title: 'Listings', focusedIcon: 'store', unfocusedIcon: 'store-outline' },
    { key: 'reservations', title: 'Reservations', focusedIcon: 'clipboard-list', unfocusedIcon: 'clipboard-list-outline' },
    { key: 'earnings', title: 'Earnings', focusedIcon: 'chart-line', unfocusedIcon: 'chart-line-variant' },
    { key: 'profile', title: 'Profile', focusedIcon: 'account', unfocusedIcon: 'account-outline' },
  ]);

  const renderScene = BottomNavigation.SceneMap({
    listings: () => <ListingsTab theme={theme} />,
    reservations: () => <ReservationsTab theme={theme} />,
    earnings: () => (canViewEarnings(user) ? <EarningsTab /> : (
      <View style={[styles.tabContent, { alignItems: 'center', paddingTop: 60 }]}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
          Earnings are only visible to the stall owner.
        </Text>
      </View>
    )),
    profile: () => <ProfileTab theme={theme} />,
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <Surface style={styles.header} elevation={1}>
        <Text variant="titleLarge">🏪 Merchant Dashboard</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {user.name} · {user.email}
        </Text>
      </Surface>
      <BottomNavigation
        navigationState={{ index, routes }}
        onIndexChange={setIndex}
        renderScene={renderScene}
        shifting={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40 },
  tabContent: { flex: 1, padding: 16 },
  impactBanner: { borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center' },
  impactCount: { color: '#fff', fontWeight: 'bold' },
  impactLabel: { color: '#fff', marginTop: 2, textAlign: 'center' },
  aiCard: { marginBottom: 12, borderRadius: 16 },
  sectionTitle: { marginBottom: 12, marginTop: 4, fontWeight: 'bold' },
  emptyText: { fontStyle: 'italic', marginBottom: 12, opacity: 0.7 },
  dealCard: { marginBottom: 12, borderRadius: 12 },
  dealCardContent: { flexDirection: 'row', alignItems: 'center' },
  profileContainer: { alignItems: 'center', paddingVertical: 30 },
  modalContent: {
    backgroundColor: '#fff', margin: 20, padding: 20, borderRadius: 16, maxHeight: '85%',
  },
  modalImage: {
    width: 160, height: 120, borderRadius: 10, marginBottom: 8, alignSelf: 'center',
  },
  label: {
    fontSize: 12, fontWeight: 'bold', color: '#636e72', marginTop: 8, marginBottom: 4,
  },
  input: { marginBottom: 12 },
  modalButtons: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 8,
  },
});
