// src/components/StoreSetup.js
//
// Owner-only: list, add, edit, delete stalls. Models AdminScreen.js's
// list-of-cards-with-actions pattern.
import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, Card, ActivityIndicator, useTheme,
} from 'react-native-paper';
import { listStalls } from '../services/authService';
import StallEditorForm from './StallEditorForm';

export default function StoreSetup({ visible, onDismiss, ownerUid }) {
  const theme = useTheme();
  const [stalls, setStalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorStall, setEditorStall] = useState(undefined); // undefined = closed, null = create, object = edit

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStalls(await listStalls(ownerUid));
    } finally {
      setLoading(false);
    }
  }, [ownerUid]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium" style={styles.title}>Your stalls</Text>

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : stalls.length === 0 ? (
          <Text style={styles.empty}>No stalls yet — add your first one below.</Text>
        ) : (
          stalls.map((s) => (
            <Card key={s.id} style={styles.card} mode="outlined">
              <Card.Content style={styles.cardContent}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{s.stallName}</Text>
                  {!!s.address && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{s.address}</Text>
                  )}
                </View>
                <Button mode="outlined" compact onPress={() => setEditorStall(s)}>Edit</Button>
              </Card.Content>
            </Card>
          ))
        )}

        <Button mode="contained" icon="plus" onPress={() => setEditorStall(null)} style={{ marginTop: 12 }}>
          Add a stall
        </Button>
        <Button mode="text" onPress={onDismiss} style={{ marginTop: 10 }}>Close</Button>
      </Modal>

      <StallEditorForm
        visible={editorStall !== undefined}
        onDismiss={() => setEditorStall(undefined)}
        ownerUid={ownerUid}
        stall={editorStall}
        onSaved={load}
        allowDelete
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20, padding: 20, borderRadius: 12, maxHeight: '85%',
  },
  title: { textAlign: 'center', marginBottom: 12 },
  empty: { fontStyle: 'italic', opacity: 0.7, textAlign: 'center', marginVertical: 12 },
  card: { marginBottom: 10 },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
});
