// src/components/ReservationCard.js
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import {
  Text, Card, Button, Chip, useTheme,
} from 'react-native-paper';
import {
  classifyReservation, STATUS_LABEL, statusTone, canHandOver, needsMerchantResolution,
} from '../utils/reservations';
import { withAlpha } from '../utils/color';
import { formatRelativeTime } from '../utils/time';

// Semantic tone -> theme colour, resolved once here so no card hardcodes hex.
function toneColor(tone, theme) {
  switch (tone) {
    case 'success': return theme.colors.primary;
    case 'warning': return theme.colors.secondary;
    case 'info': return theme.colors.tertiary || theme.colors.primary;
    case 'danger': return theme.colors.error;
    default: return theme.colors.outline;
  }
}

const KITCHEN_STATUSES = [
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready at counter' },
  { value: 'completed', label: 'Completed' },
];

export default function ReservationCard({
  reservation: r, onHandOver, onShowCode, onResolve, onDispute, onSetMerchantStatus, onMessage,
}) {
  const theme = useTheme();
  const state = classifyReservation(r);
  const accent = toneColor(statusTone(state), theme);
  const actionable = needsMerchantResolution(r);
  const showKitchenStatus = state === 'awaiting' || state === 'handingOver';

  return (
    <Card style={[styles.card, { borderLeftColor: accent }]} mode={actionable ? 'outlined' : 'elevated'}>
      <Card.Content>
        <View style={styles.top}>
          {r.image ? (
            <Image source={{ uri: r.image }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: withAlpha(accent, 0.18) }]}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: accent }}>
                {(r.item || '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.body}>
            <View style={[styles.pill, { backgroundColor: withAlpha(accent) }]}>
              <Text style={[styles.pillText, { color: accent }]}>{STATUS_LABEL[state]}</Text>
            </View>
            <Text variant="titleSmall" style={{ marginTop: 6 }}>{r.item}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {r.customerName || 'Customer'}
              {r.price ? ` · ${r.price}` : ''}
              {` · ${formatRelativeTime(r.reservedAtMillis)}`}
            </Text>
            {/* Orders predating pickup codes have no orderId. Showing the raw
                Firestore document id instead was noise the merchant can't use
                for anything — no code is better than a fake one. */}
            {r.orderId ? (
              <Text variant="bodySmall" style={{ color: theme.colors.outline, letterSpacing: 1, marginTop: 2 }}>
                {r.orderId}
              </Text>
            ) : null}
          </View>
        </View>

        {showKitchenStatus && (
          <View style={[styles.wrapRow, { marginTop: 10 }]}>
            {KITCHEN_STATUSES.map((s) => (
              <Chip
                key={s.value}
                compact
                selected={r.merchantStatus === s.value}
                onPress={() => onSetMerchantStatus(r.id, s.value)}
              >
                {s.label}
              </Chip>
            ))}
          </View>
        )}

        {state === 'awaiting' && canHandOver(r) && (
          <View style={styles.actions}>
            <Button mode="text" icon="message-text-outline" onPress={() => onMessage(r)} compact>
              Message
            </Button>
            <Button mode="contained" icon="qrcode" onPress={() => onHandOver(r)} compact>
              Hand over
            </Button>
          </View>
        )}

        {state === 'handingOver' && (
          <View style={styles.actions}>
            <Button mode="text" icon="message-text-outline" onPress={() => onMessage(r)} compact>
              Message
            </Button>
            <Button mode="outlined" icon="qrcode" onPress={() => onShowCode(r)} compact>
              Show code
            </Button>
          </View>
        )}

        {actionable && (
          <View style={{ marginTop: 10 }}>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
              {state === 'unconfirmed'
                ? 'You started a handover but the customer never confirmed.'
                : 'The pickup window closed without a handover.'}
            </Text>
            <View style={styles.wrapRow}>
              <Button mode="outlined" compact onPress={() => onResolve(r.id, 'no_show')}>
                Customer no-show
              </Button>
              <Button mode="outlined" compact onPress={() => onResolve(r.id, 'merchant_shortfall')}>
                We ran out
              </Button>
              <Button mode="text" compact onPress={() => onDispute(r)}>
                I handed it over
              </Button>
            </View>
          </View>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, borderLeftWidth: 4 },
  top: { flexDirection: 'row' },
  thumb: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pillText: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  actions: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 10,
  },
  wrapRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
