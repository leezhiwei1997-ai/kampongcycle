// src/services/appDataService.js
//
// Real backend: food deals and reservations live in Firestore, so
// they're actually shared across every user's device — not just stored
// locally like the old AsyncStorage version.

import {
  collection, addDoc, getDocs, deleteDoc, doc, query, where,
  orderBy, serverTimestamp, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const DEALS_COLLECTION = 'deals';
const RESERVATIONS_COLLECTION = 'reservations';

// ---- Food deals (Firestore) ----

function dealsRef() {
  return collection(db, DEALS_COLLECTION);
}

function docToDeal(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

/** All active deals — used by the customer browse view. */
export async function fetchFoodDeals() {
  const snap = await getDocs(query(dealsRef(), orderBy('createdAt', 'desc')));
  return snap.docs.map(docToDeal);
}

/** Only the deals a specific merchant listed — used by the merchant dashboard. */
export async function fetchDealsForMerchant(merchantEmail) {
  const snap = await getDocs(
    query(dealsRef(), where('merchantEmail', '==', merchantEmail)),
  );
  return snap.docs.map(docToDeal);
}

/** Admin-only: every listing currently live across all merchants. */
export async function fetchAllDealsForAdmin() {
  return fetchFoodDeals();
}

/** deal must include { stall, item, price, originalPrice, image, merchantEmail }. */
export async function publishFoodDeal(deal) {
  const docRef = await addDoc(dealsRef(), {
    ...deal,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, ...deal };
}

/** Merchant/admin moderation: pull a listing down without recording it as a "meal saved". */
export async function removeFoodDeal(dealId) {
  await deleteDoc(doc(db, DEALS_COLLECTION, dealId));
  return { success: true };
}

/** A customer claims/reserves a deal — this is what counts as a "meal saved". */
export async function reserveFoodDeal(dealId, deal) {
  await addDoc(collection(db, RESERVATIONS_COLLECTION), {
    dealId,
    merchantEmail: deal?.merchantEmail || null,
    item: deal?.item || null,
    reservedAt: serverTimestamp(),
  });
  await deleteDoc(doc(db, DEALS_COLLECTION, dealId));
  return { success: true, dealId };
}

/**
 * Impact stats. Pass a merchantEmail to scope it to one stall (merchant
 * dashboard); omit it for the platform-wide total (admin dashboard, or
 * the customer-facing impact banner).
 */
export async function getImpactStats(merchantEmail) {
  const reservationsRef = collection(db, RESERVATIONS_COLLECTION);
  const q = merchantEmail
    ? query(reservationsRef, where('merchantEmail', '==', merchantEmail))
    : reservationsRef;
  const snap = await getCountFromServer(q);
  return { mealsSaved: snap.data().count };
}
