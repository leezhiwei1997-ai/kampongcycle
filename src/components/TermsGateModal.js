// src/components/TermsGateModal.js
//
// Blocks the app behind a re-acceptance of the current terms — shown when
// a signed-in user's users/{uid}.termsVersion doesn't match
// utils/terms.js's CURRENT_TERMS_VERSION (first-time signup already
// collects agreement via LoginScreen; this is the re-prompt path for a
// version bump). Non-dismissable: there is no way past it except Accept or
// Log out, so `dismissable={false}` on the Modal is load-bearing, not
// decorative.
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, useTheme,
} from 'react-native-paper';
import { TERMS_TEXT } from '../utils/terms';
import { acceptTerms } from '../services/authService';

export default function TermsGateModal({ visible, uid, onSignOut }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    try {
      await acceptTerms(uid);
      // No local success handling needed — the live profile snapshot
      // (AuthContext.js) flips agreedToTerms/termsVersion and App.js's
      // gate re-renders past this modal automatically.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        dismissable={false}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <Text variant="titleMedium" style={styles.title}>Our terms have changed</Text>
        <Text variant="bodySmall" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Please review and accept to keep using KampongCycle.
        </Text>

        <ScrollView style={[styles.scroll, { borderColor: theme.colors.outline }]}>
          <Text variant="bodySmall">{TERMS_TEXT}</Text>
        </ScrollView>

        <Button mode="contained" onPress={handleAccept} loading={busy} disabled={busy} style={styles.accept}>
          Accept & Continue
        </Button>
        <Button mode="text" onPress={onSignOut} disabled={busy}>Log out instead</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20, padding: 20, borderRadius: 12, maxHeight: '85%',
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginTop: 4, marginBottom: 12 },
  scroll: {
    maxHeight: 320, borderWidth: 1, borderRadius: 8, padding: 12,
  },
  accept: { marginTop: 16, marginBottom: 6 },
});
