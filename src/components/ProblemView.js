// src/components/ProblemView.js
//
// Shown when the auth/role state is something the router can't map to a
// screen. Its whole job is to print the actual value so this class of
// bug reports itself instead of silently falling through to a default.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';

export default function ProblemView({ message, detail, onSignOut }) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="titleMedium" style={styles.title}>
        Something is off with this account
      </Text>

      <Text variant="bodyMedium" style={[styles.message, { color: theme.colors.onSurfaceVariant }]}>
        {message}
      </Text>

      {detail ? (
        <Text
          variant="bodySmall"
          style={[styles.detail, {
            backgroundColor: theme.colors.errorContainer,
            color: theme.colors.onErrorContainer,
          }]}
        >
          {detail}
        </Text>
      ) : null}

      {onSignOut ? (
        <Button mode="outlined" onPress={onSignOut} style={styles.button}>
          Sign out
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  title: { marginBottom: 8, textAlign: 'center' },
  message: { textAlign: 'center', marginBottom: 12 },
  detail: {
    fontFamily: 'monospace', padding: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 16,
  },
  button: { marginTop: 4 },
});
