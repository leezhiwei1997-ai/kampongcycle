// src/theme/paperTheme.js
import { MD3LightTheme } from 'react-native-paper';

export const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#2e7d32',
    onPrimary: '#ffffff',
    primaryContainer: '#a8f5aa',
    onPrimaryContainer: '#00210a',
    secondary: '#e17055',
    error: '#ba1a1a',
    errorContainer: '#ffdad6',
    onErrorContainer: '#410002',
    background: '#fbfdf8',
    surface: '#fbfdf8',
    surfaceVariant: '#dee5d9',
    onSurfaceVariant: '#414942',
    outline: '#717971',
  },
};
