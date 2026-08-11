// src/components/ProfileStats.js
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { formatCents } from '../utils/earnings';

function Stat({ label, value, theme }) {
  return (
    <View style={styles.stat}>
      <Text variant="titleLarge" style={{ color: theme.colors.primary }}>{value}</Text>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
    </View>
  );
}

export default function ProfileStats({ impact }) {
  const theme = useTheme();

  return (
    <Card style={styles.card} mode="contained">
      <Card.Content>
        <View style={styles.row}>
          <Stat label="MEALS RESCUED" value={impact.rescued} theme={theme} />
          <Stat label="SAVED" value={formatCents(impact.savedCents)} theme={theme} />
          <Stat label="CO₂ AVOIDED" value={`${impact.co2Kg.toFixed(1)}kg`} theme={theme} />
        </View>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          vs. usual prices · CO₂ estimated at ~2.5kg per meal
        </Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', marginTop: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
});
