// src/components/CollectByBadge.js
import React, { useState, useEffect } from 'react';
import { Text, useTheme } from 'react-native-paper';
import { formatCollectBy } from '../utils/time';

const TICK_MS = 30000; // re-render every 30s so the countdown stays fresh

export default function CollectByBadge({ collectByTimestamp, size = 'bodySmall' }) {
  const theme = useTheme();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const { label, urgency } = formatCollectBy(collectByTimestamp);
  if (!label) return null;

  const color = {
    normal: theme.colors.onSurfaceVariant,
    warning: theme.colors.secondary,
    urgent: theme.colors.error,
    expired: theme.colors.error,
  }[urgency];

  const bold = urgency === 'urgent' || urgency === 'expired';

  return (
    <Text variant={size} style={{ color, fontWeight: bold ? 'bold' : 'normal' }}>
      ⏰ {label}
    </Text>
  );
}
