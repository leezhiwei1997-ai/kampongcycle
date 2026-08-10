// src/components/ImpactBanner.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';
import { getImpactStats } from '../services/appDataService';

/** Pass merchantEmail to scope this to one stall; omit for platform-wide. */
export default function ImpactBanner({ merchantEmail, label }) {
  const [mealsSaved, setMealsSaved] = useState(null);

  const load = useCallback(async () => {
    try {
      const stats = await getImpactStats(merchantEmail);
      setMealsSaved(stats.mealsSaved);
    } catch (err) {
      setMealsSaved(0);
    }
  }, [merchantEmail]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.banner}>
      <Text style={styles.count}>{mealsSaved === null ? '—' : mealsSaved}</Text>
      <Text style={styles.label}>{label || 'meals saved from going to waste 🌍'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  count: { fontSize: 30, fontWeight: 'bold', color: '#fff' },
  label: { fontSize: 12, color: '#fff', marginTop: 2, textAlign: 'center' },
});
