// src/components/EarningsTab.js
import React, {
  useState, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, ScrollView, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import {
  Text, Card, ActivityIndicator, ProgressBar, useTheme,
} from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import { fetchReservationsForMerchant } from '../services/appDataService';
import { computeEarnings, formatCents, formatRate } from '../utils/earnings';

function RevenueCell({ label, value, theme }) {
  return (
    <View style={styles.cell}>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
      <Text variant="titleMedium" style={{ color: theme.colors.primary }}>{value}</Text>
    </View>
  );
}

export default function EarningsTab() {
  const theme = useTheme();
  const { user } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReservations(await fetchReservationsForMerchant(user.email));
    } catch (err) {
      Alert.alert('Could not load earnings', err.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user.email]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(() => { setIsRefreshing(true); load(); }, [load]);

  // Recomputed only when the rows change — the clock is captured per render,
  // which is fine because pull-to-refresh is how this screen updates.
  const stats = useMemo(() => computeEarnings(reservations, Date.now()), [reservations]);

  if (isLoading) return <ActivityIndicator size="large" style={{ marginTop: 40 }} />;

  const { revenueCents, counts, topDishes } = stats;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleMedium">Revenue collected</Text>
          <View style={styles.row}>
            <RevenueCell label="TODAY" value={formatCents(revenueCents.today)} theme={theme} />
            <RevenueCell label="THIS WEEK" value={formatCents(revenueCents.week)} theme={theme} />
            <RevenueCell label="THIS MONTH" value={formatCents(revenueCents.month)} theme={theme} />
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            Counts portions actually picked up. Cash is collected at your stall.
          </Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleMedium">Fulfilment rate</Text>
          <Text variant="displaySmall" style={{ color: theme.colors.primary, marginVertical: 4 }}>
            {formatRate(stats.fulfilmentRate)}
          </Text>
          <ProgressBar progress={stats.fulfilmentRate || 0} style={styles.bar} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {counts.collected} collected · {counts.noShow} not picked up · {counts.awaiting} still open
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            Open reservations aren&apos;t counted until their pickup window closes.
          </Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleMedium">Top dishes</Text>
          {topDishes.length === 0 ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
              Nothing collected yet.
            </Text>
          ) : topDishes.map((d, i) => (
            <View key={d.item} style={styles.dishRow}>
              <Text variant="bodyMedium" style={{ flex: 1 }}>{i + 1}. {d.item}</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {d.count} · {formatCents(d.revenueCents)}
              </Text>
            </View>
          ))}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cell: { flex: 1 },
  bar: { height: 8, borderRadius: 4, marginTop: 6 },
  dishRow: { flexDirection: 'row', marginTop: 8 },
});
