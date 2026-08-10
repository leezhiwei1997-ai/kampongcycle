// src/screens/CustomerScreen.js
import React, {
  useState, useCallback, useEffect, useMemo,
} from 'react';
import {
  View, SafeAreaView, StatusBar, Alert, StyleSheet, RefreshControl, ScrollView,
} from 'react-native';
import {
  Text, Button, Card, Surface, ActivityIndicator, Avatar, useTheme, BottomNavigation, Portal, Modal,
  Searchbar, Chip, TextInput,
} from 'react-native-paper';
import * as Location from 'expo-location';

import {
  fetchFoodDeals, reserveFoodDeal, getImpactStats,
  getRatingStatsForMerchants, submitRating, fetchReservationsForCustomer,
  fetchFollowedMerchants, followStall, unfollowStall, getFollowerCountsForMerchants,
  getReviewsForMerchant, fetchFollowedStalls,
} from '../services/appDataService';
import { distanceKm, formatDistance } from '../utils/geo';
import { formatRelativeTime } from '../utils/time';
import { scheduleLocalNotification, sendPushNotification } from '../services/notificationService';
import { getUserByEmail } from '../services/authService';
import SwipeDealCard from '../components/SwipeDealCard';
import StarRating from '../components/StarRating';
import { useAuth } from '../context/AuthContext';

function DiscoverTab({ theme, stallFilter, onClearStallFilter }) {
  const { user } = useAuth();
  const [foodDeals, setFoodDeals] = useState([]);
  const [isLoadingDeals, setIsLoadingDeals] = useState(true);
  const [mealsSaved, setMealsSaved] = useState(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [userLocation, setUserLocation] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState(null); // { merchantEmail, stall, item }
  const [selectedStars, setSelectedStars] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState(null); // null | number
  const [maxDistance, setMaxDistance] = useState(null); // null | number (km)
  const [followingOnly, setFollowingOnly] = useState(false);

  const [followedEmails, setFollowedEmails] = useState(new Set());
  const [followerCounts, setFollowerCounts] = useState(new Map());

  const [reviewsModalVisible, setReviewsModalVisible] = useState(false);
  const [reviewsTarget, setReviewsTarget] = useState(null); // { merchantEmail, stall }
  const [reviewsList, setReviewsList] = useState([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);

  const loadDeals = useCallback(async () => {
    try {
      const deals = await fetchFoodDeals();
      const merchantEmails = deals.map((d) => d.merchantEmail);
      const [ratingMap, followerMap] = await Promise.all([
        getRatingStatsForMerchants(merchantEmails),
        getFollowerCountsForMerchants(merchantEmails),
      ]);
      setFoodDeals(deals.map((d) => ({
        ...d,
        merchantRating: ratingMap.get(d.merchantEmail),
      })));
      setFollowerCounts(followerMap);
    } catch (err) {
      Alert.alert('Could not load food deals', err.message || 'Please try again.');
    } finally {
      setIsLoadingDeals(false);
    }
  }, []);

  const loadFollows = useCallback(async () => {
    try {
      const emails = await fetchFollowedMerchants(user.uid);
      setFollowedEmails(new Set(emails));
    } catch (err) {
      // Non-critical — the heart icons just won't reflect follow state until next load.
    }
  }, [user.uid]);

  const loadImpact = useCallback(async () => {
    try {
      const stats = await getImpactStats();
      setMealsSaved(stats.mealsSaved);
    } catch (err) {
      setMealsSaved(0);
    }
  }, []);

  const loadLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (err) {
      setLocationDenied(true);
    }
  }, []);

  useEffect(() => {
    loadDeals();
    loadImpact();
    loadLocation();
    loadFollows();
  }, [loadDeals, loadImpact, loadLocation, loadFollows]);

  const dealsWithDistance = useMemo(() => {
    const withDistance = foodDeals.map((deal) => {
      if (userLocation && deal.location) {
        const km = distanceKm(
          userLocation.latitude, userLocation.longitude,
          deal.location.latitude, deal.location.longitude,
        );
        return { ...deal, distanceKmValue: km, distanceLabel: formatDistance(km) };
      }
      return deal;
    });
    if (userLocation) {
      return [...withDistance].sort(
        (a, b) => (a.distanceKmValue ?? Infinity) - (b.distanceKmValue ?? Infinity),
      );
    }
    return withDistance;
  }, [foodDeals, userLocation]);

  const filteredDeals = useMemo(() => {
    if (stallFilter) {
      return dealsWithDistance.filter((deal) => deal.merchantEmail === stallFilter.merchantEmail);
    }
    const q = searchQuery.trim().toLowerCase();
    return dealsWithDistance.filter((deal) => {
      if (q) {
        const matches = deal.item?.toLowerCase().includes(q) || deal.stall?.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (maxPrice != null) {
        const priceNum = parseFloat((deal.price || '$0').replace('$', ''));
        if (Number.isFinite(priceNum) && priceNum > maxPrice) return false;
      }
      if (maxDistance != null && deal.distanceKmValue != null && deal.distanceKmValue > maxDistance) {
        return false;
      }
      if (followingOnly && !followedEmails.has(deal.merchantEmail)) {
        return false;
      }
      return true;
    });
  }, [dealsWithDistance, searchQuery, maxPrice, maxDistance, followingOnly, followedEmails, stallFilter]);

  // Reset the deck to the top whenever the active filters change, so you
  // don't end up "past the end" of a newly-shorter filtered list.
  useEffect(() => {
    setCardIndex(0);
  }, [searchQuery, maxPrice, maxDistance, followingOnly, stallFilter]);

  const handleToggleFollow = useCallback(async (deal) => {
    const isCurrentlyFollowing = followedEmails.has(deal.merchantEmail);
    // Optimistic update — flip the heart immediately, roll back on failure.
    setFollowedEmails((prev) => {
      const next = new Set(prev);
      if (isCurrentlyFollowing) next.delete(deal.merchantEmail);
      else next.add(deal.merchantEmail);
      return next;
    });
    setFollowerCounts((prev) => {
      const next = new Map(prev);
      const current = next.get(deal.merchantEmail) || 0;
      next.set(deal.merchantEmail, Math.max(0, current + (isCurrentlyFollowing ? -1 : 1)));
      return next;
    });
    try {
      if (isCurrentlyFollowing) {
        await unfollowStall(user.uid, deal.merchantEmail);
      } else {
        await followStall(user.uid, deal.merchantEmail, deal.stall);
      }
    } catch (err) {
      // Roll back on failure.
      setFollowedEmails((prev) => {
        const next = new Set(prev);
        if (isCurrentlyFollowing) next.add(deal.merchantEmail);
        else next.delete(deal.merchantEmail);
        return next;
      });
      setFollowerCounts((prev) => {
        const next = new Map(prev);
        const current = next.get(deal.merchantEmail) || 0;
        next.set(deal.merchantEmail, Math.max(0, current + (isCurrentlyFollowing ? 1 : -1)));
        return next;
      });
      Alert.alert('Could not update follow', err.message || 'Please try again.');
    }
  }, [followedEmails, user.uid]);

  const handleShowReviews = useCallback(async (deal) => {
    setReviewsTarget({ merchantEmail: deal.merchantEmail, stall: deal.stall });
    setReviewsModalVisible(true);
    setIsLoadingReviews(true);
    try {
      setReviewsList(await getReviewsForMerchant(deal.merchantEmail));
    } catch (err) {
      Alert.alert('Could not load reviews', err.message || 'Please try again.');
    } finally {
      setIsLoadingReviews(false);
    }
  }, []);

  const closeReviewsModal = useCallback(() => {
    setReviewsModalVisible(false);
    setReviewsTarget(null);
    setReviewsList([]);
  }, []);

  const handleSwipeRight = useCallback(async (deal) => {
    try {
      await reserveFoodDeal(deal.id, deal, { uid: user.uid, name: user.name, email: user.email });
      setMealsSaved((prev) => (prev === null ? 1 : prev + 1));
      setRatingTarget({ merchantEmail: deal.merchantEmail, stall: deal.stall, item: deal.item });
      setSelectedStars(0);
      setReviewComment('');
      setRatingModalVisible(true);

      scheduleLocalNotification(
        'Reservation confirmed! 🎉',
        `${deal.item} from ${deal.stall} — check My Orders for pickup details.`,
      );

      getUserByEmail(deal.merchantEmail).then((merchant) => {
        if (merchant?.pushToken) {
          sendPushNotification(
            merchant.pushToken,
            'New reservation! 🍽️',
            `${user.name} reserved ${deal.item}.`,
          );
        }
      }).catch(() => {});
    } catch (err) {
      Alert.alert('Could not reserve', err.message || 'Please try again.');
    } finally {
      setCardIndex((i) => i + 1);
    }
  }, [user]);

  const handleSwipeLeft = useCallback(() => {
    setCardIndex((i) => i + 1);
  }, []);

  const closeRatingModal = useCallback(() => {
    setRatingModalVisible(false);
    setRatingTarget(null);
    setSelectedStars(0);
    setReviewComment('');
  }, []);

  const handleSubmitRating = useCallback(async () => {
    if (!ratingTarget || selectedStars === 0) return;
    setIsSubmittingRating(true);
    try {
      await submitRating({
        merchantEmail: ratingTarget.merchantEmail,
        customerUid: user.uid,
        customerName: user.name,
        rating: selectedStars,
        comment: reviewComment,
        item: ratingTarget.item,
      });
      closeRatingModal();
    } catch (err) {
      Alert.alert('Could not submit rating', err.message || 'Please try again.');
    } finally {
      setIsSubmittingRating(false);
    }
  }, [ratingTarget, selectedStars, reviewComment, user, closeRatingModal]);

  const visibleDeal = filteredDeals[cardIndex];

  return (
    <View style={styles.tabContent}>
      <Surface style={[styles.impactBanner, { backgroundColor: theme.colors.primary }]} elevation={1}>
        <Text variant="displaySmall" style={styles.impactCount}>
          {mealsSaved === null ? '—' : mealsSaved}
        </Text>
        <Text variant="bodySmall" style={styles.impactLabel}>meals saved from going to waste 🌍</Text>
      </Surface>

      {locationDenied && (
        <Text variant="bodySmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
          Enable location access to see distance to each stall
        </Text>
      )}

      <Searchbar
        placeholder="Search dishes or stalls"
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.searchbar}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        <Chip
          selected={maxPrice === 3}
          onPress={() => setMaxPrice(maxPrice === 3 ? null : 3)}
          style={styles.filterChip}
          compact
        >
          Under $3
        </Chip>
        <Chip
          selected={maxPrice === 5}
          onPress={() => setMaxPrice(maxPrice === 5 ? null : 5)}
          style={styles.filterChip}
          compact
        >
          Under $5
        </Chip>
        {!!userLocation && (
          <>
            <Chip
              selected={maxDistance === 1}
              onPress={() => setMaxDistance(maxDistance === 1 ? null : 1)}
              style={styles.filterChip}
              compact
            >
              Within 1km
            </Chip>
            <Chip
              selected={maxDistance === 3}
              onPress={() => setMaxDistance(maxDistance === 3 ? null : 3)}
              style={styles.filterChip}
              compact
            >
              Within 3km
            </Chip>
          </>
        )}
        <Chip
          selected={followingOnly}
          onPress={() => setFollowingOnly((v) => !v)}
          style={styles.filterChip}
          compact
        >
          ❤️ Following
        </Chip>
      </ScrollView>

      {!!stallFilter && (
        <View style={styles.stallFilterBanner}>
          <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
            Viewing {stallFilter.stall || 'this stall'}
          </Text>
          <Button compact mode="text" onPress={onClearStallFilter}>
            Show all deals
          </Button>
        </View>
      )}

      <View style={styles.deckArea}>
        {isLoadingDeals ? (
          <ActivityIndicator size="large" style={{ marginTop: 40 }} />
        ) : !visibleDeal ? (
          <View style={styles.emptyDeck}>
            <Text variant="titleMedium" style={{ textAlign: 'center' }}>
              {stallFilter
                ? 'No live deals from this stall right now 🍽️'
                : foodDeals.length === 0
                  ? 'No deals nearby right now 🍽️'
                  : filteredDeals.length === 0 && cardIndex === 0
                    ? 'No deals match your filters 🔍'
                    : "You've seen everything! 🎉"}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>
              {stallFilter
                ? "You'll still be notified when they post something new."
                : foodDeals.length > 0 && filteredDeals.length === 0
                  ? 'Try clearing a filter or searching something else.'
                  : 'Check back soon for more surplus meals.'}
            </Text>
          </View>
        ) : (
          <SwipeDealCard
            key={visibleDeal.id}
            deal={visibleDeal}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
            isFollowing={followedEmails.has(visibleDeal.merchantEmail)}
            onToggleFollow={handleToggleFollow}
            followerCount={followerCounts.get(visibleDeal.merchantEmail) || 0}
            onShowReviews={handleShowReviews}
          />
        )}
      </View>

      {!!visibleDeal && (
        <View style={styles.actionRow}>
          <Button mode="outlined" onPress={handleSwipeLeft} textColor={theme.colors.error} style={styles.actionButton}>
            Skip
          </Button>
          <Button mode="contained" onPress={() => handleSwipeRight(visibleDeal)} style={styles.actionButton}>
            Reserve
          </Button>
        </View>
      )}

      <Portal>
        <Modal visible={ratingModalVisible} onDismiss={closeRatingModal} contentContainerStyle={styles.ratingModal}>
          <Text variant="titleLarge" style={{ textAlign: 'center' }}>Reserved! 🎉</Text>
          <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 4, marginBottom: 16, color: theme.colors.onSurfaceVariant }}>
            How was your experience with {ratingTarget?.stall}?
          </Text>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <StarRating value={selectedStars} onRate={setSelectedStars} size={36} />
          </View>
          <TextInput
            mode="outlined"
            placeholder="Say something about the food (optional)"
            value={reviewComment}
            onChangeText={setReviewComment}
            multiline
            numberOfLines={3}
            style={{ marginBottom: 16 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button mode="outlined" onPress={closeRatingModal} style={{ width: '48%' }}>
              Skip
            </Button>
            <Button
              mode="contained"
              onPress={handleSubmitRating}
              loading={isSubmittingRating}
              disabled={selectedStars === 0 || isSubmittingRating}
              style={{ width: '48%' }}
            >
              Submit
            </Button>
          </View>
        </Modal>

        <Modal visible={reviewsModalVisible} onDismiss={closeReviewsModal} contentContainerStyle={styles.ratingModal}>
          <Text variant="titleLarge" style={{ textAlign: 'center', marginBottom: 12 }}>
            {reviewsTarget?.stall || 'Reviews'}
          </Text>
          {isLoadingReviews ? (
            <ActivityIndicator size="large" style={{ marginVertical: 20 }} />
          ) : reviewsList.length === 0 ? (
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
              No reviews yet — be the first to leave one after your pickup!
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {reviewsList.map((r) => (
                <View key={r.id} style={styles.reviewRow}>
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
                </View>
              ))}
            </ScrollView>
          )}
          <Button mode="outlined" onPress={closeReviewsModal} style={{ marginTop: 12 }}>
            Close
          </Button>
        </Modal>
      </Portal>
    </View>
  );
}

function OrdersTab({ theme }) {
  const { user } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReservations(await fetchReservationsForCustomer(user.uid));
    } catch (err) {
      Alert.alert('Could not load your orders', err.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user.uid]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    load();
  }, [load]);

  const pending = reservations.filter((r) => r.status !== 'collected');
  const collected = reservations.filter((r) => r.status === 'collected');

  if (isLoading) {
    return (
      <View style={styles.tabContent}>
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (reservations.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[styles.tabContent, styles.emptyDeck]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        <Text variant="titleMedium" style={{ textAlign: 'center' }}>No orders yet 🍽️</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>
          Reserve a deal in Discover and it'll show up here.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.tabContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      {pending.length > 0 && (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Awaiting Pickup ({pending.length})
          </Text>
          {pending.map((r) => (
            <Card key={r.id} style={styles.orderCard} mode="elevated">
              <Card.Content>
                <Text variant="titleSmall">{r.item}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {r.stall || r.merchantEmail} · {formatRelativeTime(r.reservedAtMillis)}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.secondary, fontWeight: 'bold', marginTop: 4 }}>
                  ⏳ Awaiting pickup
                </Text>
              </Card.Content>
            </Card>
          ))}
        </>
      )}

      {collected.length > 0 && (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Collected ({collected.length})
          </Text>
          {collected.map((r) => (
            <Card key={r.id} style={[styles.orderCard, { opacity: 0.6 }]} mode="elevated">
              <Card.Content>
                <Text variant="titleSmall">{r.item}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {r.stall || r.merchantEmail} · {formatRelativeTime(r.reservedAtMillis)}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: 'bold', marginTop: 4 }}>
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

function ProfileTab({ theme, onViewStall }) {
  const { user, logout } = useAuth();
  const [followedStalls, setFollowedStalls] = useState([]);
  const [isLoadingFollows, setIsLoadingFollows] = useState(true);

  const loadFollowedStalls = useCallback(async () => {
    try {
      setFollowedStalls(await fetchFollowedStalls(user.uid));
    } catch (err) {
      setFollowedStalls([]);
    } finally {
      setIsLoadingFollows(false);
    }
  }, [user.uid]);

  useEffect(() => { loadFollowedStalls(); }, [loadFollowedStalls]);

  const handleUnfollow = useCallback(async (merchantEmail) => {
    try {
      await unfollowStall(user.uid, merchantEmail);
      setFollowedStalls((prev) => prev.filter((f) => f.merchantEmail !== merchantEmail));
    } catch (err) {
      Alert.alert('Could not unfollow', err.message || 'Please try again.');
    }
  }, [user.uid]);

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { alignItems: 'center', paddingTop: 40 }]}>
      <Avatar.Text size={80} label={user.name?.[0]?.toUpperCase() || '?'} style={{ backgroundColor: theme.colors.primary }} />
      <Text variant="titleLarge" style={{ marginTop: 12 }}>{user.name}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
        Customer • Kampong Eco Champion 🌿
      </Text>

      <View style={{ width: '100%', marginTop: 28 }}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Following ({followedStalls.length})
        </Text>
        {isLoadingFollows ? (
          <ActivityIndicator style={{ marginTop: 12 }} />
        ) : followedStalls.length === 0 ? (
          <Text style={styles.emptyText}>
            You&apos;re not following any stalls yet — tap the heart on a deal in Discover.
          </Text>
        ) : (
          followedStalls.map((f) => (
            <Card key={f.merchantEmail} style={styles.orderCard} mode="elevated">
              <Card.Content style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{f.stall || f.merchantEmail}</Text>
                </View>
                <Button compact mode="text" onPress={() => onViewStall(f.merchantEmail, f.stall)}>
                  View
                </Button>
                <Button compact mode="text" textColor={theme.colors.error} onPress={() => handleUnfollow(f.merchantEmail)}>
                  Unfollow
                </Button>
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

export default function CustomerScreen() {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [stallFilter, setStallFilter] = useState(null); // { merchantEmail, stall } | null
  const [routes] = useState([
    { key: 'discover', title: 'Discover', focusedIcon: 'food', unfocusedIcon: 'food-outline' },
    { key: 'orders', title: 'My Orders', focusedIcon: 'clipboard-list', unfocusedIcon: 'clipboard-list-outline' },
    { key: 'profile', title: 'Profile', focusedIcon: 'account', unfocusedIcon: 'account-outline' },
  ]);

  const handleViewStall = useCallback((merchantEmail, stall) => {
    setStallFilter({ merchantEmail, stall });
    setIndex(0);
  }, []);

  const renderScene = BottomNavigation.SceneMap({
    discover: () => (
      <DiscoverTab
        theme={theme}
        stallFilter={stallFilter}
        onClearStallFilter={() => setStallFilter(null)}
      />
    ),
    orders: () => <OrdersTab theme={theme} />,
    profile: () => <ProfileTab theme={theme} onViewStall={handleViewStall} />,
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <Surface style={styles.header} elevation={1}>
        <Text variant="titleLarge">♻️ KampongCycle</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Rescuing surplus hawker food
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
  deckArea: {
    flex: 1, position: 'relative', overflow: 'hidden',
  },
  emptyDeck: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, gap: 12,
  },
  actionButton: { flex: 1 },
  orderCard: { marginBottom: 10, borderRadius: 12 },
  sectionTitle: { marginBottom: 12, marginTop: 4, fontWeight: 'bold' },
  emptyText: { fontStyle: 'italic', marginBottom: 12, opacity: 0.7 },
  searchbar: { marginBottom: 8, borderRadius: 12 },
  filterRow: {
    marginBottom: 8, flexGrow: 0,
  },
  filterRowContent: {
    flexDirection: 'row', gap: 8, paddingRight: 8,
  },
  filterChip: {},
  stallFilterBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f0f0f0', borderRadius: 10, paddingLeft: 12, paddingVertical: 2, marginBottom: 8,
  },
  ratingModal: {
    backgroundColor: '#fff', margin: 24, padding: 24, borderRadius: 16,
  },
  reviewRow: {
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0',
  },
});
