// src/screens/MerchantScreen.js
import React, {
  useState, useCallback, useEffect,
} from 'react';
import {
  View, ScrollView, SafeAreaView, StatusBar, Image, Alert, StyleSheet, RefreshControl,
} from 'react-native';
import {
  Text, Button, Card, TextInput, Surface, ActivityIndicator,
  Portal, Modal, Avatar, useTheme, BottomNavigation, SegmentedButtons,
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
  fetchReservationsForMerchant, markReservationCollected,
  getFollowerCount, getReviewsForMerchant,
} from '../services/appDataService';
import StarRating from '../components/StarRating';
import CollectByBadge from '../components/CollectByBadge';
import EarningsTab from '../components/EarningsTab';
import { sendPushNotification } from '../services/notificationService';
import { getUserById } from '../services/authService';
import { useAuth } from '../context/AuthContext';

const IMAGE_QUALITY = 0.3;

function ListingsTab({ theme }) {
  const { user, refreshUser } = useAuth();
  const [myDeals, setMyDeals] = useState([]);
  const [isLoadingDeals, setIsLoadingDeals] = useState(true);
  const [mealsSaved, setMealsSaved] = useState(null);

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
      setMyDeals(await fetchDealsForMerchant(user.email));
    } catch (err) {
      Alert.alert('Could not load your listings', err.message || 'Please try again.');
    } finally {
      setIsLoadingDeals(false);
      setIsRefreshing(false);
    }
  }, [user.email]);

  const loadImpact = useCallback(async () => {
    try {
      const stats = await getImpactStats(user.email);
      setMealsSaved(stats.mealsSaved);
    } catch (err) {
      setMealsSaved(0);
    }
  }, [user.email]);

  useEffect(() => { loadMyDeals(); loadImpact(); }, [loadMyDeals, loadImpact]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadMyDeals();
    loadImpact();
    refreshUser();
  }, [loadMyDeals, loadImpact, refreshUser]);

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
    if (!user.verified) {
      Alert.alert(
        'Account pending verification',
        'An admin needs to approve your merchant account before you can publish listings. Pull down to refresh once you\'ve been approved.',
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
  }, [runAiAnalysis, user.verified]);

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

      const payload = {
        stall: stallName.trim(),
        item: trimmedDish,
        price: toMoney(discountPrice),
        originalPrice: toMoney(originalPrice),
        image,
        quantity: qty,
        collectByTimestamp,
        merchantEmail: user.email,
      };

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
    storedImageBase64, existingImage, editingDealId, user.email, closeModal,
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

      {!user.verified && (
        <Card style={[styles.aiCard, { backgroundColor: '#fff3cd' }]} mode="contained">
          <Card.Content style={{ alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', textAlign: 'center' }}>
              ⏳ Account pending verification
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>
              An admin needs to approve your merchant account before you can publish listings.
              Pull down to refresh once you&apos;ve been approved.
            </Text>
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
            disabled={!user.verified}
          >
            Snap & List
          </Button>
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        Your Active Listings ({myDeals.length})
      </Text>

      {isLoadingDeals ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : myDeals.length === 0 ? (
        <Text style={styles.emptyText}>No active listings. Snap a meal above to add one.</Text>
      ) : (
        myDeals.map((deal) => (
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
  const [reservations, setReservations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReservations(await fetchReservationsForMerchant(user.email));
    } catch (err) {
      Alert.alert('Could not load reservations', err.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user.email]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    load();
  }, [load]);

  const handleMarkCollected = useCallback(async (reservationId, reservation) => {
    try {
      await markReservationCollected(reservationId);
      setReservations((prev) => prev.map(
        (r) => (r.id === reservationId ? { ...r, status: 'collected' } : r),
      ));

      if (reservation?.customerUid) {
        getUserById(reservation.customerUid).then((customer) => {
          if (customer?.pushToken) {
            sendPushNotification(
              customer.pushToken,
              'Order collected ✅',
              `Your ${reservation.item} has been marked as picked up. Enjoy!`,
            );
          }
        }).catch(() => {});
      }
    } catch (err) {
      Alert.alert('Could not update', err.message || 'Please try again.');
    }
  }, []);

  const pending = reservations.filter((r) => r.status !== 'collected');
  const collected = reservations.filter((r) => r.status === 'collected');

  if (isLoading) {
    return (
      <View style={styles.tabContent}>
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.tabContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Text variant="titleMedium" style={styles.sectionTitle}>
        Awaiting Pickup ({pending.length})
      </Text>
      {pending.length === 0 ? (
        <Text style={styles.emptyText}>No pending reservations right now.</Text>
      ) : (
        pending.map((r) => (
          <Card key={r.id} style={styles.dealCard} mode="elevated">
            <Card.Content style={styles.dealCardContent}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{r.item}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {r.customerName} · {formatRelativeTime(r.reservedAtMillis)}
                </Text>
              </View>
              <Button mode="contained" onPress={() => handleMarkCollected(r.id, r)} compact>
                Mark Collected
              </Button>
            </Card.Content>
          </Card>
        ))
      )}

      {collected.length > 0 && (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Collected ({collected.length})
          </Text>
          {collected.map((r) => (
            <Card key={r.id} style={[styles.dealCard, { opacity: 0.6 }]} mode="elevated">
              <Card.Content style={styles.dealCardContent}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{r.item}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {r.customerName} · {formatRelativeTime(r.reservedAtMillis)}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                  ✓ Collected
                </Text>
              </Card.Content>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function ProfileTab({ theme }) {
  const { user, logout } = useAuth();
  const [ratingStats, setRatingStats] = useState(null);
  const [followerCount, setFollowerCount] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);

  useEffect(() => {
    getMerchantRatingStats(user.email)
      .then(setRatingStats)
      .catch(() => setRatingStats({ average: null, count: 0 }));
    getFollowerCount(user.email)
      .then(setFollowerCount)
      .catch(() => setFollowerCount(0));
    getReviewsForMerchant(user.email)
      .then(setReviews)
      .catch(() => setReviews([]))
      .finally(() => setIsLoadingReviews(false));
  }, [user.email]);

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { alignItems: 'center', paddingTop: 40 }]}>
      <Avatar.Text size={80} label={user.name?.[0]?.toUpperCase() || '?'} style={{ backgroundColor: theme.colors.primary }} />
      <Text variant="titleLarge" style={{ marginTop: 12 }}>{user.name}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>Merchant account</Text>
      <Text
        variant="bodySmall"
        style={{
          marginTop: 4, fontWeight: 'bold', color: user.verified ? theme.colors.primary : theme.colors.error,
        }}
      >
        {user.verified ? '✓ Verified' : '⏳ Pending verification'}
      </Text>
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
    earnings: () => <EarningsTab />,
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
