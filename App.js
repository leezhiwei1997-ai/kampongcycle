import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider, ActivityIndicator } from 'react-native-paper';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { paperTheme } from './src/theme/paperTheme';
import LoginScreen from './src/screens/LoginScreen';
import CustomerScreen from './src/screens/CustomerScreen';
import MerchantScreen from './src/screens/MerchantScreen';
import AdminScreen from './src/screens/AdminScreen';

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) return <LoginScreen />;
  if (user.role === 'admin') return <AdminScreen />;
  if (user.role === 'merchant') return <MerchantScreen />;
  return <CustomerScreen />;
}

export default function App() {
  return (
    <PaperProvider theme={paperTheme}>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: paperTheme.colors.background,
  },
});
