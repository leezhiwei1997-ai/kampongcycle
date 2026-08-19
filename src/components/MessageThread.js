// src/components/MessageThread.js
//
// Per-reservation quick messages ("Still available?" / "Running 5 min
// late") — the in-app substitute for texting a stall's WhatsApp. Used
// identically from both MerchantScreen.js (senderRole: 'owner'|'staff')
// and CustomerScreen.js (senderRole: 'customer').
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  Portal, Modal, Text, Button, TextInput, useTheme,
} from 'react-native-paper';
import { subscribeToMessages, sendReservationMessage } from '../services/appDataService';
import { withAlpha } from '../utils/color';

export default function MessageThread({
  visible, onDismiss, reservationId, currentUid, senderRole, item, notifyTarget,
}) {
  const theme = useTheme();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible || !reservationId) return undefined;
    return subscribeToMessages(reservationId, setMessages);
  }, [visible, reservationId]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendReservationMessage(
        reservationId,
        { senderUid: currentUid, senderRole, text },
        notifyTarget,
      );
      setDraft('');
    } finally {
      setSending(false);
    }
  }, [draft, sending, reservationId, currentUid, senderRole, notifyTarget]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <Text variant="titleMedium" style={styles.title}>{item ? `About ${item}` : 'Messages'}</Text>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            style={styles.list}
            renderItem={({ item: m }) => {
              const own = m.senderUid === currentUid;
              return (
                <View style={[styles.bubbleRow, own && styles.bubbleRowOwn]}>
                  <View
                    style={[
                      styles.bubble,
                      { backgroundColor: own ? withAlpha(theme.colors.primary, 0.16) : theme.colors.surfaceVariant },
                    ]}
                  >
                    <Text variant="bodySmall">{m.text}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={(
              <Text variant="bodySmall" style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>
                No messages yet — say hello.
              </Text>
            )}
          />

          <View style={styles.composer}>
            <TextInput
              mode="outlined"
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              maxLength={200}
              style={styles.input}
              dense
            />
            <Button mode="contained" onPress={handleSend} disabled={sending || !draft.trim()} compact>
              Send
            </Button>
          </View>
        </KeyboardAvoidingView>

        <Button mode="text" onPress={onDismiss} style={{ marginTop: 6 }}>Close</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20, padding: 20, borderRadius: 12, maxHeight: '80%',
  },
  title: { textAlign: 'center', marginBottom: 10 },
  list: { maxHeight: 320 },
  empty: { textAlign: 'center', paddingVertical: 24 },
  bubbleRow: { flexDirection: 'row', marginVertical: 4 },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10,
  },
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
  },
  input: { flex: 1 },
});
