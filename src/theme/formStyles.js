// src/theme/formStyles.js
import { StyleSheet } from 'react-native';
import { COLORS } from './colors';

export const formStyles = StyleSheet.create({
  label: {
    fontSize: 12, fontWeight: 'bold', color: COLORS.textMuted, marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
    fontSize: 14,
    backgroundColor: COLORS.card,
  },
  errorText: {
    fontSize: 12, color: COLORS.red, fontWeight: 'bold', marginBottom: 8, textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.green, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 16,
  },
  secondaryButton: {
    backgroundColor: COLORS.textFaint, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 10,
  },
  dangerButton: {
    backgroundColor: COLORS.red, padding: 10, borderRadius: 8, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  roleRow: { flexDirection: 'row', marginTop: 6 },
  roleChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginRight: 8,
  },
  roleChipActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  roleChipText: { color: COLORS.textDark, fontWeight: '600' },
  roleChipTextActive: { color: '#fff' },
});
