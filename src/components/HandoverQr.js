// src/components/HandoverQr.js
//
// Merchant-side handover code. The customer scans this to confirm receipt.
import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, ActivityIndicator, useTheme,
} from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { encodeHandover, REFRESH_COOLDOWN_MS } from '../utils/reservations';
import { subscribeToReservation } from '../services/appDataService';

function tick(target) {
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export default function HandoverQr({
  visible, onDismiss, reservationId, nonce, expiresAt, issuedAt, item, onRefresh,
}) {
  const theme = useTheme();
  const [left, setLeft] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // One interval drives both counters — two would drift apart visibly.
  useEffect(() => {
    if (!visible) return undefined;
    const update = () => {
      setLeft(tick(expiresAt || 0));
      setCooldown(tick((issuedAt || 0) + REFRESH_COOLDOWN_MS));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [visible, expiresAt, issuedAt]);

  // The reason the merchant doesn't have to do anything after the scan.
  useEffect(() => {
    if (!visible || !reservationId) return undefined;
    setConfirmed(false);
    const unsub = subscribeToReservation(reservationId, (r) => {
      if (r?.status === 'collected') setConfirmed(true);
    });
    return unsub;
  }, [visible, reservationId]);

  useEffect(() => {
    if (!confirmed) return undefined;
    const t = setTimeout(onDismiss, 1600);
    return () => clearTimeout(t);
  }, [confirmed, onDismiss]);

  const handleRefresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [busy, onRefresh]);

  const expired = left <= 0;

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <Text variant="titleMedium" style={styles.center}>
          {confirmed ? 'Collected' : `Handing over ${item || ''}`.trim()}
        </Text>

        <View style={styles.qrBox}>
          {confirmed ? (
            <Text variant="headlineSmall" style={{ color: theme.colors.primary }}>✓</Text>
          ) : expired ? (
            <Text style={[styles.center, { color: theme.colors.error }]}>
              This code expired.
            </Text>
          ) : (
            <QRCode value={encodeHandover(reservationId, nonce)} size={190} backgroundColor="#ffffff" />
          )}
        </View>

        {!confirmed && (
          <>
            <Text variant="titleSmall" style={styles.center}>
              {expired ? 'Tap refresh for a new one' : `Expires in ${mmss(left)}`}
            </Text>

            {busy ? (
              <ActivityIndicator style={{ marginTop: 12 }} />
            ) : (
              <Button
                mode={expired ? 'contained' : 'outlined'}
                icon="refresh"
                onPress={handleRefresh}
                disabled={!expired && cooldown > 0}
                style={{ marginTop: 12 }}
              >
                {!expired && cooldown > 0 ? `Refresh QR (${cooldown}s)` : 'Refresh QR'}
              </Button>
            )}
          </>
        )}

        <Text
          variant="bodySmall"
          style={[styles.center, styles.quiet, { color: theme.colors.onSurfaceVariant }]}
        >
          {confirmed
            ? 'The customer confirmed it.'
            : 'Ask the customer to scan this from My Orders. This updates by itself.'}
        </Text>

        <Button mode="text" onPress={onDismiss} style={{ marginTop: 6 }}>Close</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { margin: 20, padding: 20, borderRadius: 12 },
  center: { textAlign: 'center' },
  quiet: { marginTop: 10, fontSize: 11 },
  qrBox: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 222,
    marginTop: 14,
  },
});
