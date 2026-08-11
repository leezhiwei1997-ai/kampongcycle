// src/components/MyOrdersSummary.js
//
// Customer counterpart to the merchant's Fulfilment card. Deliberately not
// the same numbers: fulfilment is a merchant's performance metric and would
// mean nothing to a customer. What a customer wants to know is what they've
// rescued and whether anything needs them right now.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { classifyReservation, canConfirmPickup } from '../utils/reservations';
import { parsePriceCents, formatCents } from '../utils/earnings';

export function summariseOrders(reservations = [], now = Date.now()) {
  let rescued = 0;
  let spentCents = 0;
  let awaiting = 0;
  let readyToConfirm = 0;

  reservations.forEach((r) => {
    const state = classifyReservation(r, now);
    if (state === 'collected') {
      rescued += 1;
      spentCents += parsePriceCents(r);
    }
    if (state === 'awaiting' || state === 'handingOver') awaiting += 1;
    if (canConfirmPickup(r, now)) readyToConfirm += 1;
  });

  return {
    rescued, spentCents, awaiting, readyToConfirm,
  };
}

export default function MyOrdersSummary({ reservations }) {
  const theme = useTheme();
  const s = summariseOrders(reservations);

  return (
    <Card style={styles.card} mode="contained">
      <Card.Content>
        <View style={styles.row}>
          <View>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              MEALS RESCUED
            </Text>
            <Text variant="headlineSmall" style={{ color: theme.colors.primary }}>
              {s.rescued}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              SPENT
            </Text>
            <Text variant="headlineSmall" style={{ color: theme.colors.primary }}>
              {formatCents(s.spentCents)}
            </Text>
          </View>
        </View>

        {s.readyToConfirm > 0 ? (
          <Text variant="bodySmall" style={{ color: theme.colors.secondary, marginTop: 8, fontWeight: '600' }}>
            {s.readyToConfirm} order{s.readyToConfirm === 1 ? '' : 's'} ready to confirm — scan the stall&apos;s code
          </Text>
        ) : s.awaiting > 0 ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {s.awaiting} order{s.awaiting === 1 ? '' : 's'} waiting to be picked up
          </Text>
        ) : (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            Nothing waiting on you.
          </Text>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
});
