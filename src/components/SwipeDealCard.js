// src/components/SwipeDealCard.js
import React, { useRef, useState } from 'react';
import {
  Animated, PanResponder, StyleSheet, View, Image, Dimensions, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import StarRating from './StarRating';
import CollectByBadge from './CollectByBadge';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
const IMAGE_HEIGHT = Math.min(190, SCREEN_HEIGHT * 0.2);

export default function SwipeDealCard({
  deal, onSwipeRight, onSwipeLeft, isFollowing, onToggleFollow, followerCount, onShowReviews,
}) {
  const theme = useTheme();
  const [zoomVisible, setZoomVisible] = useState(false);
  const position = useRef(new Animated.ValueXY()).current;

  const resetPosition = () => {
    Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
  };

  const forceSwipe = (direction) => {
    const x = direction === 'right' ? SCREEN_WIDTH * 1.5 : -SCREEN_WIDTH * 1.5;
    Animated.timing(position, {
      toValue: { x, y: 0 }, duration: 220, useNativeDriver: false,
    }).start(() => {
      position.setValue({ x: 0, y: 0 });
      if (direction === 'right') onSwipeRight(deal);
      else onSwipeLeft(deal);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6,
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          forceSwipe('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          forceSwipe('left');
        } else {
          resetPosition();
        }
      },
    }),
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-12deg', '0deg', '12deg'],
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [20, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp',
  });
  const skipOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, -20], outputRange: [1, 0], extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.card,
        { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] },
      ]}
      {...panResponder.panHandlers}
    >
      <Card style={styles.cardInner} mode="elevated">
        {deal.image ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setZoomVisible(true)}
            style={[styles.image, styles.imageFrame, { backgroundColor: theme.colors.primaryContainer }]}
          >
            <Image source={{ uri: deal.image }} style={styles.imageInner} resizeMode="contain" />
          </TouchableOpacity>
        ) : (
          <View style={[styles.image, styles.imagePlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text variant="displaySmall">🍲</Text>
          </View>
        )}

        <Animated.View style={[styles.badge, styles.likeBadge, { opacity: likeOpacity }]}>
          <Text style={[styles.badgeText, { color: theme.colors.primary }]}>RESERVE</Text>
        </Animated.View>
        <Animated.View style={[styles.badge, styles.skipBadge, { opacity: skipOpacity }]}>
          <Text style={[styles.badgeText, { color: theme.colors.error }]}>SKIP</Text>
        </Animated.View>

        {typeof onToggleFollow === 'function' && (
          <TouchableOpacity
            style={styles.followHeart}
            onPress={() => onToggleFollow(deal)}
            hitSlop={{
              top: 10, bottom: 10, left: 10, right: 10,
            }}
          >
            <Text style={{ fontSize: 26 }}>{isFollowing ? '❤️' : '🤍'}</Text>
          </TouchableOpacity>
        )}

        <Card.Content style={styles.content}>
          <Text variant="titleLarge">{deal.item}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{deal.stall}</Text>
            {typeof onToggleFollow === 'function' && (
              <TouchableOpacity
                onPress={() => onToggleFollow(deal)}
                style={[
                  styles.followTextButton,
                  { borderColor: isFollowing ? theme.colors.error : theme.colors.outline },
                ]}
              >
                <Text
                  variant="labelSmall"
                  style={{ color: isFollowing ? theme.colors.error : theme.colors.onSurfaceVariant, fontWeight: 'bold' }}
                >
                  {isFollowing ? '❤️ Following' : '🤍 Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            {!!deal.merchantRating?.average && (
              <StarRating
                value={deal.merchantRating.average}
                size={16}
                showCount
                count={deal.merchantRating.count}
              />
            )}
            {typeof followerCount === 'number' && followerCount > 0 && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 8 }}>
                ❤️ {followerCount} following
              </Text>
            )}
            {typeof onShowReviews === 'function' && (
              <TouchableOpacity onPress={() => onShowReviews(deal)}>
                <Text variant="bodySmall" style={{ color: theme.colors.primary, marginLeft: 8, textDecorationLine: 'underline' }}>
                  Reviews
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {!!deal.distanceLabel && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              📍 {deal.distanceLabel}
            </Text>
          )}
          {typeof deal.quantity === 'number' && (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              🍽️ {deal.quantity} portion{deal.quantity === 1 ? '' : 's'} left
            </Text>
          )}
          {!!deal.collectByTimestamp && (
            <View style={{ marginTop: 2 }}>
              <CollectByBadge collectByTimestamp={deal.collectByTimestamp} />
            </View>
          )}
          <Text variant="headlineSmall" style={{ color: theme.colors.secondary, fontWeight: 'bold', marginTop: 8 }}>
            {deal.price}
            {' '}
            <Text style={{ textDecorationLine: 'line-through', color: theme.colors.outline, fontSize: 14 }}>
              {deal.originalPrice}
            </Text>
          </Text>
        </Card.Content>
      </Card>

      {!!deal.image && (
        <Modal visible={zoomVisible} transparent animationType="fade" onRequestClose={() => setZoomVisible(false)}>
          <View style={styles.zoomOverlay}>
            <TouchableOpacity
              style={styles.zoomCloseButton}
              onPress={() => setZoomVisible(false)}
              hitSlop={{
                top: 12, bottom: 12, left: 12, right: 12,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>✕ Close</Text>
            </TouchableOpacity>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.zoomScrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              bouncesZoom
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
              <Image source={{ uri: deal.image }} style={styles.zoomImage} resizeMode="contain" />
            </ScrollView>
            <Text style={styles.zoomHint}>Pinch to zoom in on labels or text</Text>
          </View>
        </Modal>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', width: SCREEN_WIDTH - 40, alignSelf: 'center' },
  cardInner: { borderRadius: 20, overflow: 'hidden' },
  image: { width: '100%', height: IMAGE_HEIGHT },
  imageFrame: { alignItems: 'center', justifyContent: 'center' },
  imageInner: { width: '100%', height: '100%' },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  zoomOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', paddingTop: 50,
  },
  zoomCloseButton: {
    position: 'absolute', top: 50, right: 20, zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
  },
  zoomScrollContent: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
  },
  zoomImage: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.75 },
  zoomHint: {
    color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingVertical: 16, fontSize: 13,
  },
  followTextButton: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  content: { paddingVertical: 10 },
  badge: {
    position: 'absolute', top: 20, padding: 8, borderWidth: 3, borderRadius: 8,
  },
  likeBadge: { left: 20, borderColor: '#2e7d32', transform: [{ rotate: '-15deg' }] },
  skipBadge: { right: 20, borderColor: '#ba1a1a', transform: [{ rotate: '15deg' }] },
  badgeText: { fontWeight: 'bold', fontSize: 18, letterSpacing: 1 },
  followHeart: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
