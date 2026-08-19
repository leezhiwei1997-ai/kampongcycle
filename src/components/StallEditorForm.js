// src/components/StallEditorForm.js
//
// Create/edit form for one stall (users/{ownerUid}/stalls/{stallId}). Used
// by both StoreSetup.js (owner, full CRUD) and directly from
// MerchantScreen.js's ProfileTab (staff, edit-only — allowDelete gates the
// Delete button, but the fields themselves are exactly the staff-editable
// allow-list from firestore.rules, so the rules do the rest of the gating).
import React, { useState } from 'react';
import {
  View, Image, ScrollView, StyleSheet,
} from 'react-native';
import {
  Portal, Modal, Text, Button, TextInput, Chip, useTheme,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { createStall, updateStall, deleteStall } from '../services/authService';

// A small fixed taxonomy — enough to be useful on Discover's filter chips
// without needing a moderated/growing category list.
export const STALL_CATEGORIES = [
  'Rice & Noodles', 'Soup', 'Dessert', 'Drinks', 'Halal', 'Vegetarian',
];

export default function StallEditorForm({
  visible, onDismiss, ownerUid, stall, onSaved, allowDelete = true,
}) {
  const theme = useTheme();
  const isEdit = !!stall;
  const [stallName, setStallName] = useState(stall?.stallName || '');
  const [hours, setHours] = useState(stall?.hours || '');
  const [address, setAddress] = useState(stall?.address || '');
  const [gps, setGps] = useState(stall?.gps || null);
  const [storefrontPhoto, setStorefrontPhoto] = useState(stall?.storefrontPhoto || null);
  const [categories, setCategories] = useState(stall?.categories || []);
  const [busy, setBusy] = useState(false);

  const toggleCategory = (cat) => {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, base64: false, quality: 0.5 });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      const resized = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 640 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setStorefrontPhoto(`data:image/jpeg;base64,${resized.base64}`);
    } catch {
      // Photo is optional — the form still works without it.
    }
  };

  const handleUseLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({});
      setGps({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      // Location is optional.
    }
  };

  const handleSave = async () => {
    if (!stallName.trim()) return;
    setBusy(true);
    try {
      const payload = {
        stallName: stallName.trim(), hours, address, gps, storefrontPhoto, categories,
      };
      if (isEdit) {
        await updateStall(ownerUid, stall.id, payload);
      } else {
        await createStall(ownerUid, payload);
      }
      onSaved?.();
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteStall(ownerUid, stall.id);
      onSaved?.();
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}>
        <ScrollView>
          <Text variant="titleMedium" style={styles.title}>{isEdit ? 'Edit stall' : 'Add a stall'}</Text>

          {storefrontPhoto && <Image source={{ uri: storefrontPhoto }} style={styles.photo} />}
          <Button mode="outlined" icon="camera" onPress={handlePickPhoto} style={styles.field} compact>
            {storefrontPhoto ? 'Retake photo' : 'Add a storefront photo'}
          </Button>

          <TextInput label="Stall name" value={stallName} onChangeText={setStallName} mode="outlined" style={styles.field} />
          <TextInput label="Hours (e.g. Mon–Fri 9am–3pm)" value={hours} onChangeText={setHours} mode="outlined" style={styles.field} />
          <TextInput label="Address" value={address} onChangeText={setAddress} mode="outlined" style={styles.field} />

          <Button mode="outlined" icon="map-marker" onPress={handleUseLocation} style={styles.field} compact>
            {gps ? 'Location saved ✓' : 'Use my current location'}
          </Button>

          <Text style={styles.label}>Categories</Text>
          <View style={styles.chipRow}>
            {STALL_CATEGORIES.map((cat) => (
              <Chip key={cat} selected={categories.includes(cat)} onPress={() => toggleCategory(cat)} style={styles.chip}>
                {cat}
              </Chip>
            ))}
          </View>

          <View style={styles.actions}>
            <Button mode="outlined" onPress={onDismiss} disabled={busy} style={{ width: isEdit && allowDelete ? '31%' : '48%' }}>
              Cancel
            </Button>
            {isEdit && allowDelete && (
              <Button mode="outlined" textColor={theme.colors.error} onPress={handleDelete} disabled={busy} style={{ width: '31%' }}>
                Delete
              </Button>
            )}
            <Button
              mode="contained"
              onPress={handleSave}
              loading={busy}
              disabled={busy || !stallName.trim()}
              style={{ width: isEdit && allowDelete ? '31%' : '48%' }}
            >
              Save
            </Button>
          </View>
        </ScrollView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20, padding: 20, borderRadius: 12, maxHeight: '85%',
  },
  title: { textAlign: 'center', marginBottom: 12 },
  photo: {
    width: 160, height: 120, borderRadius: 10, marginBottom: 8, alignSelf: 'center',
  },
  field: { marginBottom: 12 },
  label: {
    fontSize: 12, fontWeight: 'bold', marginTop: 4, marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  chip: { marginBottom: 4 },
  actions: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 8,
  },
});
