// src/context/AuthContext.js
import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // subscribeToAuthChanges fires immediately with the current state,
    // then again automatically after login/signup/logout — so we don't
    // need to manually setUser() inside login/signUp/logout below.
    const unsubscribe = authService.subscribeToAuthChanges((nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    });
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

  return (
    <AuthContext.Provider value={{
      user, isLoading, login, signUp, logout,
    }}
    >
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
