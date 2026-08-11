// src/components/ImageZoomViewer.js
//
// Full-screen image viewer: pinch, pan, double-tap to toggle zoom, swipe down
// to dismiss, share.
//
// Built on Animated + PanResponder rather than a library, for two reasons.
// The previous implementation used ScrollView's maximumZoomScale, which is
// iOS-only — Android users have never been able to zoom at all. And
// react-native-image-zoom-viewer, the usual suggestion, has been effectively
// unmaintained since 2021 and depends on react-native-image-pan-zoom, which
// uses lifecycle APIs that warn on modern React Native. Adding an abandoned
// dependency to fix a 120-line problem is a bad trade.
import React, { useRef, useState, useCallback } from 'react';
import {
  Modal, View, Image, Animated, PanResponder, StyleSheet, Dimensions,
  TouchableOpacity, Share, Alert,
} from 'react-native';
import { Text } from 'react-native-paper';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const ZOOMED = 2.5;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;
const DISMISS_DY = 120;

function distance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export default function ImageZoomViewer({
  visible, uri, title, onDismiss,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const backdrop = useRef(new Animated.Value(1)).current;

  // Animated.Value has no readable getter mid-gesture, so the current values
  // are mirrored here.
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const pinchStart = useRef(null);
  const lastTap = useRef(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const springTo = useCallback((nextScale, x = 0, y = 0) => {
    scaleRef.current = nextScale;
    offsetRef.current = { x, y };
    setIsZoomed(nextScale > 1.05);
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, bounciness: 4 }),
      Animated.spring(translate, { toValue: { x, y }, useNativeDriver: true, bounciness: 4 }),
      Animated.timing(backdrop, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [scale, translate, backdrop]);

  const close = useCallback(() => {
    springTo(1);
    onDismiss();
  }, [springTo, onDismiss]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,

      onPanResponderGrant: (e) => {
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          // Double tap: toggle. Zooming out always recentres, otherwise you
          // can end up zoomed out and panned off into empty space.
          lastTap.current = 0;
          springTo(scaleRef.current > 1.05 ? 1 : ZOOMED);
          return;
        }
        lastTap.current = now;
        pinchStart.current = e.nativeEvent.touches.length === 2
          ? { dist: distance(e.nativeEvent.touches), scale: scaleRef.current }
          : null;
      },

      onPanResponderMove: (e, g) => {
        const { touches } = e.nativeEvent;

        if (touches.length === 2) {
          if (!pinchStart.current) {
            pinchStart.current = { dist: distance(touches), scale: scaleRef.current };
            return;
          }
          const ratio = distance(touches) / pinchStart.current.dist;
          const next = Math.min(MAX_SCALE, Math.max(1, pinchStart.current.scale * ratio));
          scale.setValue(next);
          scaleRef.current = next;
          return;
        }

        if (scaleRef.current > 1.05) {
          // Zoomed in: one finger pans the image.
          translate.setValue({
            x: offsetRef.current.x + g.dx,
            y: offsetRef.current.y + g.dy,
          });
          return;
        }

        // At 1x a downward drag dismisses, with the backdrop fading as it goes
        // so the gesture feels attached to something.
        if (g.dy > 0) {
          translate.setValue({ x: 0, y: g.dy });
          backdrop.setValue(Math.max(0.4, 1 - g.dy / (SCREEN_H * 0.6)));
        }
      },

      onPanResponderRelease: (e, g) => {
        pinchStart.current = null;

        if (scaleRef.current <= 1.05) {
          if (g.dy > DISMISS_DY) { close(); return; }
          springTo(1);
          return;
        }
        // Keep whatever pan the user landed on; just commit the offset.
        offsetRef.current = {
          x: offsetRef.current.x + g.dx,
          y: offsetRef.current.y + g.dy,
        };
        setIsZoomed(true);
        translate.setValue(offsetRef.current);
      },

      onPanResponderTerminate: () => springTo(scaleRef.current > 1.05 ? scaleRef.current : 1),
    }),
  ).current;

  const handleShare = useCallback(async () => {
    try {
      // The image lives in Firebase Storage, so what's shared is its URL.
      // Sharing the bitmap itself would mean downloading to a local file
      // first (expo-file-system + expo-sharing) — worth doing if you want
      // it, but it's a bigger change than a share button.
      await Share.share({
        message: title ? `${title} — ${uri}` : uri,
        url: uri,
        title: title || 'Shared from KampongCycle',
      });
    } catch (err) {
      Alert.alert('Could not share', err.message || 'Please try again.');
    }
  }, [uri, title]);

  if (!uri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]} />

      <View style={styles.container} {...panResponder.panHandlers}>
        <View style={styles.header} pointerEvents="box-none">
          <Text numberOfLines={1} style={styles.caption}>{title || 'Photo'}</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.iconButton}
              hitSlop={{
                top: 12, bottom: 12, left: 12, right: 12,
              }}
            >
              <Text style={styles.iconText}>⤴</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={close}
              style={styles.iconButton}
              hitSlop={{
                top: 12, bottom: 12, left: 12, right: 12,
              }}
            >
              <Text style={styles.iconText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={[
            styles.image,
            { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
          ]}
        />

        <Text style={styles.hint}>
          {isZoomed ? 'Double-tap to zoom out · drag to pan' : 'Double-tap or pinch to zoom · swipe down to close'}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  caption: {
    flex: 1, color: '#fff', fontSize: 17, fontWeight: '600', marginRight: 12,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  image: { width: SCREEN_W, height: SCREEN_H * 0.7 },
  hint: {
    position: 'absolute',
    bottom: 40,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    textAlign: 'center',
  },
});
