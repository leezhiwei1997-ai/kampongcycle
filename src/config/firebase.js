// src/config/firebase.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth, getReactNativePersistence, getAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Avoids "Firebase app already initialized" errors during Fast Refresh.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// On native (iOS/Android) auth needs to be told explicitly to persist
// sessions in AsyncStorage, or users get logged out every app restart.
// initializeAuth() also throws if it's ever called a second time (which
// Fast Refresh can trigger), so we fall back to getAuth() if that happens.
let auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err) {
    auth = getAuth(app);
  }
}

export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
