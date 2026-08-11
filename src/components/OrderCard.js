// src/components/OrderCard.js
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import {
  Text, Card, Button, useTheme,
} from 'react-native-paper';
import {
  classifyReservation, statusTone, canConfirmPickup, customerStatusLabel,
  canReview, reviewAvailableAt,
} from '../utils/reservations';
import { withAlpha } from '../utils/color';
import { formatRelativeTime } from '../utils/time';

function toneColor(tone, theme) {
  switch (tone) {
    case 'success': return theme.colors.primary;
    case 'warning': return theme.colors.secondary;
    case 'info': return theme.colors.tertiary || theme.colors.primary;
    case 'danger': return theme.colors.error;
    default: return theme.colors.outline;
  }
}

export default function OrderCard({ reservation: r, onConfirm, onReview }) {
  const theme = useTheme();
  const state = classifyReservation(r);
  const accent = toneColor(statusTone(state), theme);

  return (
    <Card style={[styles.card, { borderLeftColor: accent }]} mode="elevated">
      <Card.Content>
        <View style={styles.top}>
          {r.image ? (
            <Image source={{ uri: r.image }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: withAlpha(accent, 0.18) }]}>
              <Text style={{ fontSize: 28, fontWeight: '700', color: accent }}>
                {(r.item || '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.body}>
            <View style={[styles.pill, { backgroundColor: withAlpha(accent) }]}>
              <Text style={[styles.pillText, { color: accent }]}>{customerStatusLabel(r)}</Text>
            </View>
            <Text variant="titleSmall" style={{ marginTop: 6 }}>{r.item}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {r.stall || r.merchantEmail}
              {r.price ? ` · ${r.price}` : ''}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.outline, marginTop: 2 }}>
              {r.orderId ? `${r.orderId} · ` : ''}{formatRelativeTime(r.reservedAtMillis)}
            </Text>
          </View>
        </View>

        {canConfirmPickup(r) && (
          <Button mode="contained" icon="qrcode-scan" onPress={onConfirm} style={styles.cta}>
            Confirm pickup
          </Button>
        )}

        {state === 'awaiting' && (
          <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            Head to the stall — you can confirm once they hand it over and show their code.
          </Text>
        )}

        {/* Handover started but the 5-minute code lapsed. Without this the
            card sits there with a status and no button and no explanation. */}
        {state === 'handingOver' && !canConfirmPickup(r) && (
          <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            The stall&apos;s code expired. Ask them to tap Hand over again.
          </Text>
        )}

        {state === 'collected' && (canReview(r) ? (
          <Button mode="outlined" icon="star" onPress={() => onReview(r)} style={styles.cta}>
            Rate this meal
          </Button>
        ) : (
          <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            You can rate this from{' '}
            {new Date(reviewAvailableAt(r)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            {' '}— once you&apos;ve eaten it.
          </Text>
        ))}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, borderLeftWidth: 4 },
  top: { flexDirection: 'row' },
  thumb: { width: 80, height: 80, borderRadius: 10, marginRight: 12 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pillText: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  cta: { marginTop: 12 },
  hint: { marginTop: 8 },
});
