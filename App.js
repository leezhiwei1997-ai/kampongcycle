import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider, ActivityIndicator } from 'react-native-paper';
import * as Sentry from '@sentry/react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { paperTheme } from './src/theme/paperTheme';
import { registerForPushNotifications } from './src/services/notificationService';
import { updatePushToken } from './src/services/authService';
import { hasAcceptedCurrentTerms } from './src/utils/terms';
import { SENTRY_DSN } from './src/config/env';
import ProblemView from './src/components/ProblemView';
import TermsGateModal from './src/components/TermsGateModal';
import LoginScreen from './src/screens/LoginScreen';
import CustomerScreen from './src/screens/CustomerScreen';
import MerchantScreen from './src/screens/MerchantScreen';
import AdminScreen from './src/screens/AdminScreen';

// Running under Expo Go (not a custom dev client) means the native crash
// handler / session tracking never activate — the SDK detects that itself
// and degrades gracefully. JS-level error/exception capture still works.
// No-op (undefined dsn) rather than throwing if EXPO_PUBLIC_SENTRY_DSN is
// ever missing from a contributor's local .env — this app should still run
// without error tracking configured, same as it runs without Gemini's key.
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
    debug: __DEV__,
  });
}

function Router() {
  const {
    status, user, error, logout,
  } = useAuth();

  // Depend on the uid, NOT the whole user object. The profile is now a live
  // onSnapshot, so `user` is a new object on every document change — and
  // updatePushToken() below writes to that same document. Keying this effect
  // on `user` would make it: write token -> snapshot -> effect reruns ->
  // write token -> ... a self-feeding write loop. The uid only changes on a
  // real login/logout, which is when this should actually run.
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    registerForPushNotifications().then((token) => {
      if (token) updatePushToken(uid, token).catch(() => {});
    });
  }, [uid]);

  // Attaches which account hit an error, without which every report is
  // anonymous and unreproducible. Cleared on sign-out so a shared device
  // doesn't misattribute the next person's errors to the previous account.
  useEffect(() => {
    Sentry.setUser(uid ? { id: uid, role: user?.role } : null);
  }, [uid, user?.role]);

  if (status === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (status === 'signedOut') return <LoginScreen />;

  if (status === 'error') {
    return (
      <ProblemView
        message="Couldn't read your profile from Firestore."
        detail={error}
        onSignOut={logout}
      />
    );
  }

  if (status === 'noProfile') {
    return (
      <ProblemView
        message="You're signed in, but there's no users/ document for this account."
        onSignOut={logout}
      />
    );
  }

  // Blocks everything below until the current terms are accepted (first
  // acceptance happens at signup — see LoginScreen.js — so this only ever
  // fires as a re-prompt after a CURRENT_TERMS_VERSION bump).
  if (!hasAcceptedCurrentTerms(user)) {
    return <TermsGateModal visible uid={user.uid} onSignOut={logout} />;
  }

  // No default fallthrough to CustomerScreen. An unrecognised role now shows
  // itself on screen instead of silently rendering the customer app.
  // The `key` forces a remount on role change so mount effects re-run.
  switch (user.role) {
    case 'admin':
      return <AdminScreen key="admin" />;
    case 'owner':
      return <MerchantScreen key="owner" />;
    case 'staff':
      return <MerchantScreen key="staff" />;
    case 'customer':
      return <CustomerScreen key="customer" />;
    default:
      return (
        <ProblemView
          message="This account has a role the app doesn't handle."
          detail={`role = ${JSON.stringify(user.role)} · type ${typeof user.role} · len ${String(user.role).length}`}
          onSignOut={logout}
        />
      );
  }
}

function App() {
  return (
    <PaperProvider theme={paperTheme}>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </PaperProvider>
  );
}

export default Sentry.wrap(App);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: paperTheme.colors.background,
  },
});
