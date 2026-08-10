// src/components/StarRating.js
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

/**
 * Read-only mode: pass `value` (0-5, can be fractional) and nothing else.
 * Interactive mode: pass `value` (current selection, 0 if none) and `onRate(n)`.
 * Pass `showCount` + `count` to append "4.2 (18)" style text after the stars.
 */
export default function StarRating({
  value = 0, onRate, size = 20, showCount = false, count = 0,
}) {
  const theme = useTheme();
  const interactive = typeof onRate === 'function';

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const Wrapper = interactive ? TouchableOpacity : View;
        return (
          <Wrapper
            key={n}
            onPress={interactive ? () => onRate(n) : undefined}
            style={interactive ? styles.interactiveStar : undefined}
          >
            <Text style={{ fontSize: size, color: filled ? '#f5a623' : theme.colors.outline }}>
              {filled ? '★' : '☆'}
            </Text>
          </Wrapper>
        );
      })}
      {showCount && (
        <Text variant="bodySmall" style={{ marginLeft: 4, color: theme.colors.onSurfaceVariant }}>
          {value ? value.toFixed(1) : 'No ratings yet'}
          {value ? ` (${count})` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  interactiveStar: { padding: 4 },
});
