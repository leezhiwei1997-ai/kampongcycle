// src/components/ConfirmPickupScanner.js
//
// CUSTOMER-side scanner. The customer scans the QR the merchant is holding
// up to confirm they actually received the food.
//
// There is no manual-entry fallback here, and that's deliberate: typing a
// code you were told over the counter proves nothing about whether food
// changed hands, which is exactly what this step exists to establish. If the
// scan genuinely can't happen, the merchant raises a dispute and an admin
// looks at it.
//
// Requires: npx expo install expo-camera
import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, ActivityIndicator, useTheme,
} from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function ConfirmPickupScanner({ visible, onDismiss, onCode }) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busy) return;
    setBusy(true);
    setError('');
    try {
      const message = await onCode(code);
      if (message) setError(message);
      else onDismiss();
    } catch (err) {
      setError(err.message || 'Could not find that order.');
    } finally {
      setBusy(false);
    }
  }, [busy, onCode, onDismiss]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <Text variant="titleMedium" style={{ marginBottom: 4 }}>Confirm pickup</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>
          Scan the code the stall is showing you.
        </Text>

        {!permission?.granted ? (
          <View style={styles.permission}>
            <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 12 }}>
              Camera access is needed to scan pickup codes. You can still type the
              code in below.
            </Text>
            <Button mode="contained" onPress={requestPermission}>Allow camera</Button>
          </View>
        ) : (
          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : ({ data }) => submit(data)}
            />
          </View>
        )}

        {!!error && (
          <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
            {error}
          </Text>
        )}

        {busy && <ActivityIndicator style={{ marginTop: 10 }} />}

        <View style={styles.row}>
          <Button mode="text" onPress={onDismiss}>Cancel</Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { margin: 20, padding: 18, borderRadius: 12 },
  cameraBox: { height: 220, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' },
  permission: { paddingVertical: 20, alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 8 },
});
