// src/context/AuthContext.js
import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo,
} from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

const INITIAL = { status: 'loading', user: null, error: null };

export function AuthProvider({ children }) {
  // One state object rather than separate user/isLoading, so the two can
  // never disagree — e.g. isLoading false while user is still stale.
  const [authState, setAuthState] = useState(INITIAL);

  useEffect(() => {
    // subscribeToAuthChanges now emits {status, user, error} and keeps a
    // live onSnapshot on users/{uid}, so a role edit in the Firestore
    // console reaches the app without a reload. It returns its own
    // cleanup, which tears down both listeners.
    const unsubscribe = authService.subscribeToAuthChanges(setAuthState);
    return unsubscribe;
  }, []);

  const login = useCallback(async (email, password) => {
    await authService.logIn({ email, password });
  }, []);

  const signUp = useCallback(async ({
    name, email, password, role,
  }) => {
    await authService.signUp({
      name, email, password, role,
    });
  }, []);

  const logout = useCallback(async () => {
    await authService.logOut();
  }, []);

  const value = useMemo(() => ({
    ...authState,
    // Derived, so existing consumers that read isLoading keep working.
    isLoading: authState.status === 'loading',
    login,
    signUp,
    logout,
  }), [authState, login, signUp, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return ctx;
}
