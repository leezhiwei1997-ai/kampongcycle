// src/components/EcoBadge.js
//
// Tappable tier badge. The tap is the point: a badge nobody can interrogate
// is decoration, and this one used to be a hardcoded string identical on
// every profile.
import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Text, Portal, Dialog, Button, ProgressBar, useTheme,
} from 'react-native-paper';
import { TIERS } from '../utils/impact';

export default function EcoBadge({ role = 'Customer', impact }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { tier, next, rescued } = impact;

  const toNext = next ? next.min - rescued : 0;
  const progress = next
    ? Math.min(1, (rescued - tier.min) / Math.max(1, next.min - tier.min))
    : 1;

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {role} • {tier.label} {tier.emoji}
          <Text style={{ color: theme.colors.primary }}>  ⓘ</Text>
        </Text>
      </TouchableOpacity>

      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)}>
          <Dialog.Title>{tier.label} {tier.emoji}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Your tier comes from meals you&apos;ve actually collected — {rescued} so far.
              Reserving doesn&apos;t count until you pick it up.
            </Text>

            {next ? (
              <>
                <Text variant="bodyMedium" style={{ marginTop: 12, fontWeight: '600' }}>
                  {toNext} more to reach {next.label} {next.emoji}
                </Text>
                <ProgressBar progress={progress} style={styles.bar} />
              </>
            ) : (
              <Text variant="bodyMedium" style={{ marginTop: 12, fontWeight: '600' }}>
                Top tier — nothing left to climb.
              </Text>
            )}

            <View style={styles.tierList}>
              {TIERS.map((t) => (
                <Text
                  key={t.key}
                  variant="bodySmall"
                  style={{
                    color: t.key === tier.key ? theme.colors.primary : theme.colors.onSurfaceVariant,
                    fontWeight: t.key === tier.key ? '700' : '400',
                    marginTop: 4,
                  }}
                >
                  {t.emoji} {t.label} — {t.min === 0 ? 'to start' : `${t.min}+ meals`}
                </Text>
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)}>Got it</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, marginTop: 8 },
  tierList: { marginTop: 16 },
});
