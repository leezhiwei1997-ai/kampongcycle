// src/components/SwipeDealCard.js
import React, { useRef, useState } from 'react';
import {
  Animated, PanResponder, StyleSheet, View, Image, Dimensions, TouchableOpacity,
} from 'react-native';
import {
  Text, Card, Button, Divider, useTheme,
} from 'react-native-paper';
import StarRating from './StarRating';
import ImageZoomViewer from './ImageZoomViewer';
import { formatCollectByParts } from '../utils/time';
import { withAlpha } from '../utils/color';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
// The image area is a fixed 16:10 box, not a pixel height and not flex.
//
// flex:1 was the wrong tool: with the card also flexing, the image claimed
// space the body needed and the two ended up drawn over each other. A ratio
// is deterministic, scales with card width rather than screen height, and
// behaves the same on every viewport — including Safari.
const IMAGE_ASPECT = 16 / 10;

// Stock is not a warning, so it gets a neutral slate rather than a status hue.
const STOCK_COLOR = '#2d3436';

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

  const { endLabel, leftLabel, urgency } = formatCollectByParts(deal.collectByTimestamp);
  const timeColor = {
    ok: theme.colors.primary,
    warning: theme.colors.secondary,
    urgent: theme.colors.error,
    expired: theme.colors.error,
  }[urgency] || theme.colors.onSurfaceVariant;

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
        <View style={styles.imageWrap}>
          {deal.image ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setZoomVisible(true)} style={styles.imageFill}>
              {/* "cover", not "contain". Letterboxing was what produced the
                  coloured bars around portrait photos. A crop shows less of
                  the picture but all of the card. */}
              <Image source={{ uri: deal.image }} style={styles.image} resizeMode="cover" />
            </TouchableOpacity>
          ) : (
            <View style={[styles.imageFill, styles.imagePlaceholder, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Text variant="displaySmall">🍲</Text>
            </View>
          )}

          {/* Time pressure and scarcity ride on the photo, where they read
              before anything else. Colour still comes from the urgency
              thresholds, so "4 hr left" is green and "10 min left" is red. */}
          <View style={styles.overlayColumn} pointerEvents="none">
            {!!leftLabel && (
              <View style={[styles.overlayPill, { borderColor: timeColor }]}>
                <Text style={[styles.overlayText, { color: timeColor }]} numberOfLines={1}>
                  ⏱ {leftLabel}
                </Text>
              </View>
            )}
            {typeof deal.quantity === 'number' && (
              // Slate, never the urgency colour. Time and stock are different
              // facts; when both pills were green they read as one block, and
              // colour should mean exactly one thing here — how long you have.
              <View style={[styles.overlayPill, { borderColor: STOCK_COLOR }]}>
                <Text style={[styles.overlayText, { color: STOCK_COLOR }]} numberOfLines={1}>
                  🍴 {deal.quantity} portion{deal.quantity === 1 ? '' : 's'} left
                </Text>
              </View>
            )}
          </View>
        </View>

        <Animated.View style={[styles.badge, styles.likeBadge, { opacity: likeOpacity }]}>
          <Text style={[styles.badgeText, { color: theme.colors.primary }]}>RESERVE</Text>
        </Animated.View>
        <Animated.View style={[styles.badge, styles.skipBadge, { opacity: skipOpacity }]}>
          <Text style={[styles.badgeText, { color: theme.colors.error }]}>SKIP</Text>
        </Animated.View>

        <Card.Content style={styles.content}>
          <Text variant="headlineSmall" style={{ fontWeight: '700' }}>{deal.item}</Text>

          <Text variant="bodyMedium" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {deal.stall}
            {deal.distanceLabel ? ` · ${deal.distanceLabel}` : ''}
          </Text>

          <View style={styles.priceRow}>
            <Text variant="displaySmall" style={{ color: theme.colors.primary, fontWeight: '800' }}>
              {deal.price}
            </Text>
            {!!deal.originalPrice && (
              <Text
                variant="titleMedium"
                style={{ textDecorationLine: 'line-through', color: theme.colors.outline, marginLeft: 10 }}
              >
                {deal.originalPrice}
              </Text>
            )}
          </View>

          {!!endLabel && (
            <View style={[styles.pickupPill, { backgroundColor: withAlpha(timeColor, 0.14) }]}>
              <Text style={{ color: timeColor, fontWeight: '600' }}>🕐 {endLabel}</Text>
            </View>
          )}

          <Divider style={{ marginTop: 14 }} />

          <View style={styles.socialRow}>
            {!!deal.merchantRating?.average && (
              <StarRating
                value={deal.merchantRating.average}
                size={16}
                showCount
                count={deal.merchantRating.count}
              />
            )}

            {/* The heart moved off the photo and onto this row, where it sits
                beside the number it changes. One control, one place. */}
            {typeof onToggleFollow === 'function' && (
              <TouchableOpacity
                onPress={() => onToggleFollow(deal)}
                style={styles.followInline}
                hitSlop={{
                  top: 10, bottom: 10, left: 10, right: 10,
                }}
              >
                <Text style={{ fontSize: 16 }}>{isFollowing ? '❤️' : '🤍'}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 4 }}>
                  {typeof followerCount === 'number' ? `${followerCount} following` : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}

            {typeof onShowReviews === 'function' && (
              <Button mode="text" compact onPress={() => onShowReviews(deal)} labelStyle={{ fontSize: 12 }}>
                Reviews
              </Button>
            )}
          </View>

          {/* Buttons live inside the card now. They belong to this deal, and
              the card is what swipes away when one is pressed. */}
          <View style={styles.actionRow}>
            <Button
              mode="outlined"
              onPress={onSwipeLeft}
              style={styles.skipButton}
              contentStyle={{ height: 48 }}
              textColor={theme.colors.onSurfaceVariant}
            >
              Skip
            </Button>
            <Button
              mode="contained"
              onPress={() => onSwipeRight(deal)}
              style={styles.reserveButton}
              contentStyle={{ height: 48 }}
              labelStyle={{ fontSize: 16, fontWeight: 'bold' }}
            >
              Reserve
            </Button>
          </View>
        </Card.Content>
      </Card>

      <ImageZoomViewer
        visible={zoomVisible}
        uri={deal.image}
        title={deal.item}
        onDismiss={() => setZoomVisible(false)}
      />

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Natural height — the card is as tall as its content and no taller. Not
  // absolute (only one is ever mounted) and not flex (that let the image
  // fight the body for space).
  card: { width: SCREEN_WIDTH - 40, alignSelf: 'center' },
  cardInner: { borderRadius: 20, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  imageWrap: { width: '100%', aspectRatio: IMAGE_ASPECT },
  imageFill: { width: '100%', height: '100%' },
  content: { paddingVertical: 12 },
  // Inset from the top-right corner, stacked with a gap so the two can never
  // sit on top of each other. Near-opaque white behind coloured text: legible
  // over any photo, unlike a translucent tint.
  overlayColumn: {
    position: 'absolute', top: 8, right: 8, alignItems: 'flex-end', gap: 6,
  },
  overlayPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  overlayText: { fontSize: 12, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 10 },
  pickupPill: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginTop: 10,
  },
  socialRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 12,
  },
  followInline: { flexDirection: 'row', alignItems: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  skipButton: { flex: 1, marginRight: 10, borderRadius: 24 },
  reserveButton: { flex: 2, borderRadius: 24 },
  badge: {
    position: 'absolute', top: 20, padding: 8, borderWidth: 3, borderRadius: 8,
  },
  likeBadge: { left: 20, borderColor: '#2e7d32', transform: [{ rotate: '-15deg' }] },
  skipBadge: { right: 20, borderColor: '#ba1a1a', transform: [{ rotate: '15deg' }] },
  badgeText: { fontWeight: 'bold', fontSize: 18, letterSpacing: 1 },
});
