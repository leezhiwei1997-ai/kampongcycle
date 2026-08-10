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
  doc, setDoc, getDoc, getDocs, collection, updateDoc, query, where, limit,
  onSnapshot,
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
    // firestore.rules requires exactly this relationship on create:
    //   verified == (role != 'merchant')
    // Omitting the field makes the rule comparison fail and the write
    // is rejected, leaving an Auth account with no profile document.
    verified: role !== 'merchant',
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
 * Subscribes to auth state AND to the user's Firestore profile document.
 *
 * Why two listeners: onAuthStateChanged only fires on login/logout/token
 * refresh. Editing users/{uid}.role in the Firestore console is not an
 * auth event, so a one-shot getDoc here would capture the role once and
 * never update it. onSnapshot makes role changes propagate live.
 *
 * The callback is deliberately NOT async. An async callback here means
 * overlapping in-flight reads on token refresh, and whichever resolves
 * last wins — which is how state ends up depending on network timing
 * rather than on what Firestore currently holds.
 *
 * Emits: { status, user, error }
 *   'loading'   — waiting for auth or the first profile snapshot
 *   'signedOut' — no Firebase Auth user
 *   'noProfile' — signed in, but users/{uid} does not exist
 *   'error'     — the profile listener failed (error holds the code)
 *   'ready'     — user is populated and current
 *
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribeToAuthChanges(callback) {
  let unsubProfile = null;
  const stopProfile = () => {
    if (unsubProfile) {
      unsubProfile();
      unsubProfile = null;
    }
  };

  const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
    // Always tear down the previous uid's listener before attaching a new
    // one, or listeners stack across logins and race each other.
    stopProfile();

    if (!firebaseUser) {
      callback({ status: 'signedOut', user: null, error: null });
      return;
    }

    callback({ status: 'loading', user: null, error: null });

    unsubProfile = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (!snap.exists()) {
          callback({ status: 'noProfile', user: null, error: null });
          return;
        }
    const data = snap.data();
        callback({
          status: 'ready',
          user: {
            uid: firebaseUser.uid,
            ...data,
            // Values typed or pasted into the Firestore console routinely
            // carry stray whitespace and newlines. Normalise on read so a
            // paste artefact can't change which screen someone lands on.
            role: typeof data.role === 'string' ? data.role.trim() : data.role,
            email: typeof data.email === 'string' ? data.email.trim().toLowerCase() : data.email,
          },
          error: null,
        });
      },
      (err) => {
        callback({ status: 'error', user: null, error: err.code || String(err) });
      },
    );
  });

  return () => {
    stopProfile();
    unsubAuth();
  };
}

/** Admin-only helper: list all registered accounts. */
export async function listUsers() {
  const snap = await getDocs(usersCollection());
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Saves this user's Expo push token to their profile so others can be notified. */
export async function updatePushToken(uid, pushToken) {
  await updateDoc(doc(db, 'users', uid), { pushToken });
  return { success: true };
}

/** Looks up a user's profile (including pushToken) by email — used to notify a merchant. */
export async function getUserByEmail(email) {
  const snap = await getDocs(
    query(usersCollection(), where('email', '==', email.toLowerCase()), limit(1)),
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

/** Looks up a user's profile (including pushToken) by uid — used to notify a customer. */
export async function getUserById(uid) {
  return getUserProfile(uid);
}
