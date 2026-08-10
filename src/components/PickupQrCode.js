// src/components/PickupQrCode.js
//
// Shown on the customer's order card. The merchant scans it to close the
// order out.
//
// The order code is printed under the QR on purpose. Hawker centres are
// bright, phone screens are cracked, batteries die, and cameras fail — when
// the scan doesn't work the merchant types four characters instead and the
// queue keeps moving. A pickup flow that only works when the technology
// cooperates isn't a pickup flow.
//
// Requires: npx expo install react-native-qrcode-svg react-native-svg
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';

export default function PickupQrCode({ orderId, collapsed = true }) {
  const theme = useTheme();
  const [open, setOpen] = useState(!collapsed);

  if (!orderId) {
    return (
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
        No pickup code on this order — show the stall your name instead.
      </Text>
    );
  }

  if (!open) {
    return (
      <Button mode="outlined" compact icon="qrcode" onPress={() => setOpen(true)} style={styles.button}>
        Show pickup code
      </Button>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.qrBox}>
        <QRCode value={orderId} size={144} backgroundColor="#ffffff" />
      </View>
      <Text variant="titleMedium" style={styles.code}>{orderId}</Text>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
        Show this at the stall. If the scan won&apos;t work, read out the code.
      </Text>
      <Button mode="text" compact onPress={() => setOpen(false)}>Hide</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 12 },
  qrBox: { backgroundColor: '#ffffff', padding: 12, borderRadius: 8 },
  code: { letterSpacing: 2, marginTop: 8, fontWeight: 'bold' },
  button: { marginTop: 8, alignSelf: 'flex-start' },
});
