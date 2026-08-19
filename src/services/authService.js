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
  doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, collection, updateDoc, query, where, limit,
  onSnapshot, serverTimestamp, increment,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { CURRENT_TERMS_VERSION } from '../utils/terms';

function usersCollection() {
  return collection(db, 'users');
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

/**
 * role must be 'customer', 'owner', or 'staff'. Admin accounts are NOT
 * self-signed-up — create them by manually adding a `role: 'admin'`
 * field to a user's document in the Firestore console after they sign
 * up normally. This prevents anyone from granting themselves admin.
 *
 * Staff sign up under an existing owner by typing that owner's email
 * (assignedOwnerEmail) — the only piece of identity a staff member
 * unambiguously knows. It's resolved to assignedOwnerUid and validated
 * BEFORE creating the Firebase Auth account, not after: the profile write
 * happens second (same as before), and firestore.rules will reject a
 * staff profile whose assignedOwnerUid doesn't point at a real role:'owner'
 * account — checking that ourselves first avoids stranding an Auth-only
 * account with no profile behind it over a typo'd owner email.
 */
export async function signUp({
  name, email, password, role, agreedToTerms, assignedOwnerEmail,
}) {
  if (!name?.trim() || !email?.trim() || !password) {
    throw new Error('Please fill in all fields.');
  }
  if (!['customer', 'owner', 'staff'].includes(role)) {
    throw new Error('Please choose an account type.');
  }
  if (!agreedToTerms) {
    throw new Error('Please agree to the terms to continue.');
  }

  let staffFields = {};
  if (role === 'staff') {
    const trimmedOwnerEmail = assignedOwnerEmail?.trim();
    if (!trimmedOwnerEmail) {
      throw new Error("Please enter your stall owner's email.");
    }
    const owner = await getUserByEmail(trimmedOwnerEmail);
    if (!owner || owner.role !== 'owner') {
      throw new Error("We couldn't find a stall owner with that email.");
    }
    staffFields = {
      assignedOwnerUid: owner.uid,
      assignedOwnerEmail: owner.email,
    };
  }

  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const profile = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role,
    // firestore.rules requires exactly this relationship on create:
    //   verified == (role != 'owner')   [for customer/owner]
    //   verified == false               [for staff — the field is unused]
    // Omitting the field makes the rule comparison fail and the write
    // is rejected, leaving an Auth account with no profile document.
    verified: role === 'customer',
    agreedToTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
    createdAt: Date.now(),
    ...staffFields,
  };
  await setDoc(doc(db, 'users', credential.user.uid), profile);
  // Best-effort — a lost audit entry shouldn't block a successful signup.
  await writeTermsAudit(credential.user.uid, CURRENT_TERMS_VERSION).catch(() => {});
  return { uid: credential.user.uid, ...profile };
}

/**
 * Re-accept the current terms version (TermsGateModal, after a
 * CURRENT_TERMS_VERSION bump). Self-service — matches firestore.rules'
 * self-update rule, which allows agreedToTerms/termsVersion to move as
 * long as the new version is a real non-empty string.
 */
export async function acceptTerms(uid) {
  await updateDoc(doc(db, 'users', uid), {
    agreedToTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
  });
  await writeTermsAudit(uid, CURRENT_TERMS_VERSION).catch(() => {});
}

/** Append-only trail in users/{uid}/auditLog — mirrors appDataService.js's writeAudit. */
export async function writeTermsAudit(uid, termsVersion) {
  await addDoc(collection(db, 'users', uid, 'auditLog'), {
    actor: uid,
    action: 'terms_accepted',
    termsVersion,
    at: serverTimestamp(),
  });
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
        callback({
          status: 'ready',
          user: { uid: firebaseUser.uid, ...snap.data() },
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

/**
 * Saves this user's Expo push token to their profile so others can be
 * notified. Returns a result instead of throwing, but NEVER fails silently
 * — a swallowed permission error here is exactly why "push doesn't work"
 * is so hard to diagnose: the send side looks fine, the token was just
 * never stored.
 *
 * Most common failure: the users/{uid} document has no `verified` field, so
 * the rules' `request.resource.data.verified == resource.data.verified`
 * comparison fails and the whole update is denied.
 */
export async function updatePushToken(uid, pushToken) {
  try {
    await updateDoc(doc(db, 'users', uid), { pushToken });
    return { success: true };
  } catch (err) {
    const code = err?.code || String(err);
    console.warn(`[push] could not save token for ${uid}: ${code}`);
    return { success: false, error: code };
  }
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

/** Admin-only: flip a pending owner account to verified. */
export async function approveOwner(uid) {
  await updateDoc(doc(db, 'users', uid), { verified: true });
}

/**
 * Self-reported anti-griefing counter (see appDataService.js's
 * reconcileCustomerNoShows, which calls this once per unresolved expiry).
 * Never throws — a failed write here shouldn't block the customer's own
 * screen from loading, same pattern as updatePushToken above.
 *
 * noShowCount only ever increases (enforced by firestore.rules too); every
 * 3rd increment also pushes cooldownUntil a day forward, so an occasional
 * miss doesn't cost anything but a pattern of them does.
 */
export async function incrementNoShowCount(uid, currentCount = 0) {
  const nextCount = currentCount + 1;
  const updates = { noShowCount: increment(1) };
  if (nextCount % 3 === 0) {
    updates.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
  }
  try {
    await updateDoc(doc(db, 'users', uid), updates);
    return { success: true };
  } catch (err) {
    const code = err?.code || String(err);
    console.warn(`[no-show] could not update counter for ${uid}: ${code}`);
    return { success: false, error: code };
  }
}

function stallsCollection(ownerUid) {
  return collection(db, 'users', ownerUid, 'stalls');
}

/** Owner-only: add a stall. stallName is the only required field. */
export async function createStall(ownerUid, data) {
  const payload = {
    stallName: data.stallName?.trim(),
    hours: data.hours ?? null,
    address: data.address ?? null,
    gps: data.gps ?? null,
    storefrontPhoto: data.storefrontPhoto ?? null,
    categories: data.categories ?? [],
    pausedUntil: null,
    createdAt: Date.now(),
  };
  const ref = await addDoc(stallsCollection(ownerUid), payload);
  return { id: ref.id, ...payload };
}

export async function listStalls(ownerUid) {
  const snap = await getDocs(stallsCollection(ownerUid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Owner or their staff (the caller decides which one — firestore.rules
 * enforces the field-level split between them, see the stalls/{stallId}
 * rules). Callers should only pass the fields they mean to change.
 */
export async function updateStall(ownerUid, stallId, updates) {
  await updateDoc(doc(db, 'users', ownerUid, 'stalls', stallId), updates);
}

export async function deleteStall(ownerUid, stallId) {
  await deleteDoc(doc(db, 'users', ownerUid, 'stalls', stallId));
}

/**
 * Staff self-service: pick which of their owner's stalls they belong to,
 * exactly once. firestore.rules only allows this self-update path when
 * assignedStallId is currently null — after that it's admin/owner-only
 * (see setStaffStall below).
 */
export async function pickOwnStall(staffUid, stallId) {
  await updateDoc(doc(db, 'users', staffUid), { assignedStallId: stallId });
}

/** Owner-only: list staff currently assigned to them. */
export async function listStaffForOwner(ownerUid) {
  const snap = await getDocs(
    query(usersCollection(), where('role', '==', 'staff'), where('assignedOwnerUid', '==', ownerUid)),
  );
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Owner (or admin) reassigning/clearing which stall a staff member is linked to. */
export async function setStaffStall(staffUid, stallId) {
  await updateDoc(doc(db, 'users', staffUid), { assignedStallId: stallId ?? null });
}
