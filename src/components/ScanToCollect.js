// src/components/ScanToCollect.js
//
// Merchant scans the customer's pickup QR (or types the code) to mark an
// order collected.
//
// Requires: npx expo install expo-camera
import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, TextInput, ActivityIndicator, useTheme,
} from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function ScanToCollect({ visible, onDismiss, onCode }) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async (raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code || busy) return;
    setBusy(true);
    setError('');
    try {
      const message = await onCode(code);
      if (message) setError(message);
      else {
        setManual('');
        onDismiss();
      }
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
        <Text variant="titleMedium" style={{ marginBottom: 10 }}>Scan pickup code</Text>

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

        <TextInput
          mode="outlined"
          label="Or enter the code"
          value={manual}
          onChangeText={setManual}
          autoCapitalize="characters"
          placeholder="KC-260811-7F4Q"
          style={{ marginTop: 12 }}
        />

        {!!error && (
          <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
            {error}
          </Text>
        )}

        {busy && <ActivityIndicator style={{ marginTop: 10 }} />}

        <View style={styles.row}>
          <Button mode="text" onPress={onDismiss}>Cancel</Button>
          <Button mode="contained" onPress={() => submit(manual)} disabled={!manual || busy}>
            Collect
          </Button>
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
