// src/screens/CustomerScreen.js
import React, {
  useState, useCallback, useEffect, useMemo,
} from 'react';
import {
  View, SafeAreaView, StatusBar, Alert, StyleSheet, RefreshControl, ScrollView, Dimensions,
} from 'react-native';
import {
  Text, Button, Card, Surface, ActivityIndicator, Avatar, useTheme, BottomNavigation, Portal, Modal,
  Searchbar, Chip, TextInput, Divider, Dialog,
} from 'react-native-paper';
import * as Location from 'expo-location';

const SCREEN_W = Dimensions.get('window').width;

import {
  fetchFoodDeals, reserveFoodDeal,
  getRatingStatsForMerchants, submitRating, fetchReservationsForCustomer,
  fetchFollowedMerchants, followStall, unfollowStall, getFollowerCountsForMerchants,
  getReviewsForMerchant, fetchFollowedStalls, confirmPickupByScan,
} from '../services/appDataService';
import { distanceKm, formatDistance } from '../utils/geo';
import { formatRelativeTime } from '../utils/time';
import { scheduleLocalNotification, sendPushNotification } from '../services/notificationService';
import { getUserByEmail } from '../services/authService';
import SwipeDealCard from '../components/SwipeDealCard';
import ConfirmPickupScanner from '../components/ConfirmPickupScanner';
import OrderCard from '../components/OrderCard';
import MyOrdersSummary from '../components/MyOrdersSummary';
import EcoBadge from '../components/EcoBadge';
import ProfileStats from '../components/ProfileStats';
import { computeImpact, recentActivity } from '../utils/impact';
import { statusTone } from '../utils/reservations';
import { withAlpha } from '../utils/color';
import {
  classifyReservation, STATUS_LABEL, canReview, reviewAvailableAt, canConfirmPickup,
  groupByDay, isResolvedState, openCount,
} from '../utils/reservations';
import StarRating from '../components/StarRating';
import { useAuth } from '../context/AuthContext';

function timeOfDayGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 18) return 'Good Afternoon';
  return 'Good Evening';
}

function DiscoverTab({ theme, stallFilter, onClearStallFilter }) {
  const { user } = useAuth();
  const [foodDeals, setFoodDeals] = useState([]);
  const [isLoadingDeals, setIsLoadingDeals] = useState(true);
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
  // Drives the "›" affordance on the filter row — hidden once there's
  // nothing further right to reach.
  const [filtersAtEnd, setFiltersAtEnd] = useState(false);
  const greeting = timeOfDayGreeting();

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
    loadLocation();
    loadFollows();
  }, [loadDeals, loadLocation, loadFollows]);

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
      // Deliberately NOT opening the rating modal here. At this point the
      // customer has reserved food they have not collected, let alone eaten
      // — any stars they give would be rating the app, not the meal. The
      // prompt now lives in My Orders, an hour after collection.

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
      {/* The big green "18 meals saved" slab was the loudest thing on the
          screen and told the customer nothing they could act on. The number
          still exists — it's on Profile, next to their own contribution,
          where it means something. */}
      <Text variant="headlineSmall" style={{ fontWeight: '700' }}>
        {greeting}, {user.name || 'there'}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>
        Rescue these before they go!
      </Text>

      <Searchbar
        placeholder="Search dishes or stalls"
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.searchbar}
        elevation={0}
      />

      <View style={styles.filterWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent: e }) => {
          const remaining = e.contentSize.width - e.layoutMeasurement.width - e.contentOffset.x;
          setFiltersAtEnd(remaining <= 8);
        }}
        onContentSizeChange={(w) => setFiltersAtEnd(w <= SCREEN_W - 24)}
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
        {!filtersAtEnd && (
          <View pointerEvents="none" style={[styles.filterHint, { backgroundColor: theme.colors.background }]}>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 18, fontWeight: '600' }}>›</Text>
          </View>
        )}
      </View>

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

      {filteredDeals.length - cardIndex > 1 && (
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {filteredDeals.length - cardIndex - 1} more to browse
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 18, marginTop: 2 }}>⌄</Text>
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

  // Reviews live here, not in Discover: a review is about food that has been
  // collected and eaten, so this is the only screen where the customer is in
  // a position to write one honestly.
  const [scanVisible, setScanVisible] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [reviewTarget, setReviewTarget] = useState(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Returns an error string to show inside the scanner, or null on success.
  const handleScan = useCallback(async (payload) => {
    try {
      const res = await confirmPickupByScan(payload, user.uid);
      setReservations((prev) => prev.map(
        (r) => (r.id === res.reservationId ? { ...r, status: 'collected', collectedAtMillis: Date.now() } : r),
      ));
      return null;
    } catch (err) {
      return err.message || 'Could not confirm that pickup.';
    }
  }, [user.uid]);

  const closeReview = useCallback(() => {
    setReviewTarget(null);
    setStars(0);
    setComment('');
  }, []);

  const openReview = useCallback((r) => {
    setStars(0);
    setComment('');
    setReviewTarget(r);
  }, []);

  const handleSubmitReview = useCallback(async () => {
    if (!reviewTarget || stars === 0) return;
    setIsSubmitting(true);
    try {
      await submitRating({
        merchantEmail: reviewTarget.merchantEmail,
        customerUid: user.uid,
        customerName: user.name,
        rating: stars,
        comment,
        item: reviewTarget.item,
      });
      closeReview();
    } catch (err) {
      Alert.alert('Could not submit review', err.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [reviewTarget, stars, comment, user, closeReview]);

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

  // Orders are now grouped by day rather than split pending/collected — the
  // day header carries the collected count for that day.

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
      <MyOrdersSummary reservations={reservations} />

      {groupByDay(reservations).map((day) => {
        const open = day.items.filter((r) => !isResolvedState(classifyReservation(r)));
        const done = day.items.filter((r) => isResolvedState(classifyReservation(r)));
        const showDone = collapsed[day.key];

        return (
          <View key={day.key}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {day.label}
            </Text>
            {/* Both totals in the header: what still needs doing, and what's
                already done. "Show N finished" answers only the second. */}
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
              {openCount(day.items) > 0
                ? `${openCount(day.items)} awaiting pickup · ${day.collected}/${day.total} collected`
                : `${day.collected}/${day.total} collected`}
            </Text>

            {open.map((r) => (
              <OrderCard
                key={r.id}
                reservation={r}
                onConfirm={() => setScanVisible(true)}
                onReview={openReview}
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
                  <OrderCard
                    key={r.id}
                    reservation={r}
                    onConfirm={() => setScanVisible(true)}
                    onReview={openReview}
                  />
                ))}
              </>
            )}
            <Divider style={{ marginTop: 4, marginBottom: 14 }} />
          </View>
        );
      })}

      <ConfirmPickupScanner
        visible={scanVisible}
        onDismiss={() => setScanVisible(false)}
        onCode={handleScan}
      />

      <Portal>
        <Modal visible={!!reviewTarget} onDismiss={closeReview} contentContainerStyle={styles.ratingModal}>
          <Text variant="titleMedium" style={{ textAlign: 'center' }}>
            How was the {reviewTarget?.item}?
          </Text>
          <Text variant="bodySmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            {reviewTarget?.stall || reviewTarget?.merchantEmail}
          </Text>
          <View style={{ alignItems: 'center', marginVertical: 16 }}>
            <StarRating value={stars} onRate={setStars} size={36} />
          </View>
          <TextInput
            mode="outlined"
            label="Anything to add? (optional)"
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
            <Button mode="outlined" onPress={closeReview} style={{ width: '48%' }}>Not now</Button>
            <Button
              mode="contained"
              onPress={handleSubmitReview}
              style={{ width: '48%' }}
              disabled={stars === 0 || isSubmitting}
            >
              Submit
            </Button>
          </View>
        </Modal>
      </Portal>
    </ScrollView>
  );
}

function ProfileTab({ theme, onViewStall }) {
  const { user, logout } = useAuth();
  const [followedStalls, setFollowedStalls] = useState([]);
  const [isLoadingFollows, setIsLoadingFollows] = useState(true);
  const [orders, setOrders] = useState([]);
  const [confirmUnfollow, setConfirmUnfollow] = useState(null);

  useEffect(() => {
    fetchReservationsForCustomer(user.uid).then(setOrders).catch(() => setOrders([]));
  }, [user.uid]);

  const impact = useMemo(() => computeImpact(orders), [orders]);
  const activity = useMemo(() => recentActivity(orders), [orders]);

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

  // Confirmed, not one-tap. Unfollowing is instant and silent, and the
  // button sits directly beside "View" — an easy misfire that costs the
  // customer a stall they were tracking.
  const handleUnfollow = useCallback(async () => {
    if (!confirmUnfollow) return;
    try {
      await unfollowStall(user.uid, confirmUnfollow.merchantEmail);
      setFollowedStalls((prev) => prev.filter(
        (f) => f.merchantEmail !== confirmUnfollow.merchantEmail,
      ));
    } catch (err) {
      Alert.alert('Could not unfollow', err.message || 'Please try again.');
    } finally {
      setConfirmUnfollow(null);
    }
  }, [user.uid, confirmUnfollow]);

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { alignItems: 'center', paddingTop: 40 }]}>
      <Avatar.Text size={80} label={user.name?.[0]?.toUpperCase() || '?'} style={{ backgroundColor: theme.colors.primary }} />
      <Text variant="titleLarge" style={{ marginTop: 12 }}>{user.name}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
      <EcoBadge role="Customer" impact={impact} />

      <ProfileStats impact={impact} />

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
          /* Plain rows, not a Card each. One followed stall in an elevated
             card was taking a quarter of the screen to say one thing. */
          followedStalls.map((f) => (
            <View key={f.merchantEmail} style={styles.followRow}>
              <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1 }}>
                {f.stall || f.merchantEmail}
              </Text>
              <Button compact mode="text" onPress={() => onViewStall(f.merchantEmail, f.stall)}>
                View
              </Button>
              <Button compact mode="text" textColor={theme.colors.error} onPress={() => setConfirmUnfollow(f)}>
                Unfollow
              </Button>
            </View>
          ))
        )}
      </View>

      {activity.length > 0 && (
        <View style={{ width: '100%', marginTop: 24 }}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Recent activity</Text>
          {activity.map((a) => {
            const tone = {
              success: theme.colors.primary,
              warning: theme.colors.secondary,
              danger: theme.colors.error,
            }[statusTone(a.state)] || theme.colors.outline;

            return (
              <View key={a.id} style={styles.activityRow}>
                <View style={[styles.activityDot, { backgroundColor: tone }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    <Text style={{ color: tone, fontWeight: '600' }}>{a.verb}</Text>
                    {` ${a.item}`}
                    {/* Stall dropped when it's the same as the row above —
                        three lines ending "from Hawker Testing" is noise. */}
                    {a.stall && !a.repeatStall ? ` from ${a.stall}` : ''}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {a.price ? `${a.price} · ` : ''}
                    {formatRelativeTime(a.atMillis)}
                    {a.orderId ? ` · ${a.orderId}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Button mode="text" textColor={theme.colors.error} onPress={logout} style={{ marginTop: 28 }}>
        Log Out
      </Button>

      <Portal>
        <Dialog visible={!!confirmUnfollow} onDismiss={() => setConfirmUnfollow(null)}>
          <Dialog.Title>Unfollow {confirmUnfollow?.stall || 'this stall'}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              You&apos;ll stop seeing their surplus first. You can follow again any time.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmUnfollow(null)}>Cancel</Button>
            <Button textColor={theme.colors.error} onPress={handleUnfollow}>Unfollow</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
  tabContent: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  impactBanner: { borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center' },
  impactCount: { color: '#fff', fontWeight: 'bold' },
  impactLabel: { color: '#fff', marginTop: 2, textAlign: 'center' },
  // flex:1 to claim the remaining height, but the card inside sits at its
  // natural size at the top — matching the target, where there's breathing
  // room under the card rather than a stretched one.
  deckArea: { flex: 1, justifyContent: 'flex-start' },
  emptyDeck: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, gap: 12,
  },
  skipButton: { minWidth: 90 },
  reserveButton: { flex: 1, marginLeft: 12, borderRadius: 25 },
  orderCard: { marginBottom: 10, borderRadius: 12 },
  sectionTitle: { marginBottom: 12, marginTop: 4, fontWeight: 'bold' },
  emptyText: { fontStyle: 'italic', marginBottom: 12, opacity: 0.7 },
  searchbar: {
    marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: '#e3e6e3', backgroundColor: '#fff',
  },
  filterWrap: { position: 'relative' },
  followRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10,
  },
  activityDot: {
    width: 8, height: 8, borderRadius: 4, marginTop: 7, marginRight: 10,
  },
  filterRow: {
    marginBottom: 6, flexGrow: 0,
  },
  filterRowContent: {
    flexDirection: 'row', gap: 8, paddingRight: 26,
  },
  filterChip: {},
  filterHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 8,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
