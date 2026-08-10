// src/services/authService.js
//
// Real, server-backed auth via Firebase. Firebase Auth handles the
// account/password/session itself; we additionally store a profile
// document in Firestore (users/{uid}) for fields Firebase Auth doesn't
// know about, like `role` and `name`.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc, setDoc, getDoc, getDocs, collection,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

function usersCollection() {
  return collection(db, 'users');
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

/**
 * role must be 'customer' or 'merchant'. Admin accounts are NOT
 * self-signed-up — create them by manually adding a `role: 'admin'`
 * field to a user's document in the Firestore console after they sign
 * up normally. This prevents anyone from granting themselves admin.
 */
export async function signUp({
  name, email, password, role,
}) {
  if (!name?.trim() || !email?.trim() || !password) {
    throw new Error('Please fill in all fields.');
  }
  if (role !== 'customer' && role !== 'merchant') {
    throw new Error('Please choose an account type.');
  }

  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const profile = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role,
    createdAt: Date.now(),
  };
  await setDoc(doc(db, 'users', credential.user.uid), profile);
  return { uid: credential.user.uid, ...profile };
}

export async function logIn({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const profile = await getUserProfile(credential.user.uid);
  if (!profile) {
    throw new Error('Account found but profile is missing. Contact support.');
  }
  return { uid: credential.user.uid, ...profile };
}

export async function logOut() {
  await firebaseSignOut(auth);
}

/**
 * Subscribes to Firebase's live auth state. Fires immediately with the
 * current state, then again on every login/logout/signup. Returns an
 * unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribeToAuthChanges(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    const profile = await getUserProfile(firebaseUser.uid);
    callback(profile ? { uid: firebaseUser.uid, ...profile } : null);
  });
}

/** Admin-only helper: list all registered accounts. */
export async function listUsers() {
  const snap = await getDocs(usersCollection());
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
