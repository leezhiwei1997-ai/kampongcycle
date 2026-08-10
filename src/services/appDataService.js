// src/services/appDataService.js
//
// Real backend: food deals and reservations live in Firestore, so
// they're actually shared across every user's device — not just stored
// locally like the old AsyncStorage version.

import {
  collection, addDoc, getDocs, deleteDoc, doc, query, where,
  orderBy, serverTimestamp, getCountFromServer, setDoc, updateDoc, increment,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const DEALS_COLLECTION = 'deals';
const RESERVATIONS_COLLECTION = 'reservations';
const RATINGS_COLLECTION = 'ratings';
const FOLLOWS_COLLECTION = 'follows';

// ---- Food deals (Firestore) ----

function dealsRef() {
  return collection(db, DEALS_COLLECTION);
}

function docToDeal(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

async function fetchAllDealsRaw() {
  const snap = await getDocs(query(dealsRef(), orderBy('createdAt', 'desc')));
  return snap.docs.map(docToDeal);
}

/** All active, still-in-collection-window deals — used by the customer browse view. */
export async function fetchFoodDeals() {
  const now = Date.now();
  const all = await fetchAllDealsRaw();
  return all.filter((d) => !d.collectByTimestamp || d.collectByTimestamp > now);
}

/** Only the deals a specific merchant listed — used by the merchant dashboard. Includes expired ones so merchants can clean them up. */
export async function fetchDealsForMerchant(merchantEmail) {
  const snap = await getDocs(
    query(dealsRef(), where('merchantEmail', '==', merchantEmail)),
  );
  return snap.docs.map(docToDeal);
}

/** Admin-only: every listing currently live across all merchants, including expired ones. */
export async function fetchAllDealsForAdmin() {
  return fetchAllDealsRaw();
}

/**
 * `price` is a display string ("$3.50"). Money that has to be summed can't
 * live in a string, so we store an integer cents field alongside it and
 * leave the display string untouched for the UI.
 */
function toCents(price) {
  const n = parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** deal must include { stall, item, price, originalPrice, image, merchantEmail, quantity, collectByTimestamp }. */
export async function publishFoodDeal(deal) {
  const payload = {
    ...deal,
    priceCents: toCents(deal?.price),
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(dealsRef(), payload);
  return { id: docRef.id, ...deal };
}

/** Merchant edits their own listing — price, quantity, collect-by time, etc. */
export async function updateFoodDeal(dealId, updates) {
  await updateDoc(doc(db, DEALS_COLLECTION, dealId), updates);
  return { success: true };
}

/** Merchant/admin moderation: pull a listing down without recording it as a "meal saved". */
export async function removeFoodDeal(dealId) {
  await deleteDoc(doc(db, DEALS_COLLECTION, dealId));
  return { success: true };
}

/**
 * A customer claims/reserves ONE portion — this is what counts as a
 * "meal saved". Decrements quantity; once the last portion is taken,
 * the listing is removed entirely.
 *
 * `customer` should be { uid, name, email } of the person reserving, so
 * the merchant can see who's coming to collect it.
 *
 * Note: this reads the deal's quantity from the client's local state
 * (the `deal` object passed in) rather than a fresh server read, so it's
 * a best-effort approach appropriate for small-scale hawker use — not
 * bulletproof against two customers reserving the exact last portion in
 * the same instant. A production version would move this into a Cloud
 * Function using a Firestore transaction for true atomicity.
 */
export async function reserveFoodDeal(dealId, deal, customer) {
  await addDoc(collection(db, RESERVATIONS_COLLECTION), {
    dealId,
    merchantEmail: deal?.merchantEmail || null,
    stall: deal?.stall || null,
    item: deal?.item || null,
    price: deal?.price || null,
    // Snapshotted onto the reservation, not looked up later: the deal
    // document is DELETED when its last portion goes, so anything the
    // earnings view needs has to be copied here at reservation time.
    priceCents: toCents(deal?.price),
    collectByTimestamp: deal?.collectByTimestamp ?? null,
    customerUid: customer?.uid || null,
    customerName: customer?.name || 'A customer',
    customerEmail: customer?.email || null,
    status: 'pending',
    reservedAt: serverTimestamp(),
  });

  const dealRef = doc(db, DEALS_COLLECTION, dealId);
  const currentQuantity = deal?.quantity ?? 1;

  if (currentQuantity <= 1) {
    await deleteDoc(dealRef);
  } else {
    await updateDoc(dealRef, { quantity: increment(-1) });
  }

  return { success: true, dealId };
}

/** Every reservation for one merchant, newest first — used by the merchant's "Reservations" tab. */
export async function fetchReservationsForMerchant(merchantEmail) {
  const snap = await getDocs(
    query(
      collection(db, RESERVATIONS_COLLECTION),
      where('merchantEmail', '==', merchantEmail),
      orderBy('reservedAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      reservedAtMillis: data.reservedAt?.toMillis ? data.reservedAt.toMillis() : null,
    };
  });
}

/** Every reservation a customer has made, newest first — used by their "My Orders" tab. */
export async function fetchReservationsForCustomer(customerUid) {
  const snap = await getDocs(
    query(
      collection(db, RESERVATIONS_COLLECTION),
      where('customerUid', '==', customerUid),
      orderBy('reservedAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      reservedAtMillis: data.reservedAt?.toMillis ? data.reservedAt.toMillis() : null,
    };
  });
}

/** Merchant confirms a customer actually picked up their reserved portion. */
export async function markReservationCollected(reservationId) {
  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: 'collected',
    collectedAt: serverTimestamp(),
  });
  return { success: true };
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

// ---- Stall ratings (Firestore) ----
//
// One rating doc per (customer, merchant) pair, keyed by a deterministic
// ID so a customer re-rating the same stall updates their existing rating
// instead of creating duplicates. Average is computed client-side after
// fetching all of a merchant's ratings — simplest reliable approach given
// hawker-stall rating volumes are small (tens, not millions).

function ratingDocId(customerUid, merchantEmail) {
  return `${customerUid}__${merchantEmail}`;
}

/**
 * Customer rates a stall 1-5, with an optional written comment about the
 * food they received. Re-rating the same stall overwrites the previous
 * rating+comment (one review per customer per stall, most recent wins) —
 * same trade-off as before, just extended to cover the comment text too.
 */
export async function submitRating({
  merchantEmail, customerUid, customerName, rating, comment, item,
}) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be a whole number from 1 to 5.');
  }
  const trimmedComment = (comment || '').trim();
  await setDoc(
    doc(db, RATINGS_COLLECTION, ratingDocId(customerUid, merchantEmail)),
    {
      merchantEmail,
      customerUid,
      customerName: customerName || 'Anonymous',
      rating,
      comment: trimmedComment,
      item: item || null,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { success: true };
}

/**
 * Recent written reviews for a stall (ratings that include a comment),
 * newest first. Sorted client-side after fetching so no new composite
 * Firestore index is required beyond the existing merchantEmail filter.
 */
export async function getReviewsForMerchant(merchantEmail, max = 20) {
  const snap = await getDocs(
    query(collection(db, RATINGS_COLLECTION), where('merchantEmail', '==', merchantEmail)),
  );
  const reviews = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
      };
    })
    .filter((r) => r.comment && r.comment.length > 0)
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  return reviews.slice(0, max);
}

/** Average rating + count for one stall. Returns { average: null, count: 0 } if unrated. */
export async function getMerchantRatingStats(merchantEmail) {
  const snap = await getDocs(
    query(collection(db, RATINGS_COLLECTION), where('merchantEmail', '==', merchantEmail)),
  );
  if (snap.empty) return { average: null, count: 0 };
  let sum = 0;
  snap.forEach((d) => { sum += d.data().rating || 0; });
  return { average: sum / snap.size, count: snap.size };
}

/**
 * Batched version for a list of deals — fetches rating stats for every
 * unique merchant in one Promise.all instead of one call at a time.
 * Returns a Map keyed by merchantEmail.
 */
export async function getRatingStatsForMerchants(merchantEmails) {
  const unique = [...new Set(merchantEmails.filter(Boolean))];
  const results = await Promise.all(
    unique.map(async (email) => [email, await getMerchantRatingStats(email)]),
  );
  return new Map(results);
}

// ---- Stall follows/favorites (Firestore) ----
//
// One follow doc per (customer, merchant) pair, keyed deterministically
// so following twice is a no-op and unfollowing is a direct delete —
// same pattern as ratings above.

function followDocId(customerUid, merchantEmail) {
  return `${customerUid}__${merchantEmail}`;
}

/** Customer follows a stall. `stall` is the display name, stored for convenience. */
export async function followStall(customerUid, merchantEmail, stall) {
  await setDoc(
    doc(db, FOLLOWS_COLLECTION, followDocId(customerUid, merchantEmail)),
    {
      customerUid, merchantEmail, stall: stall || null, createdAt: serverTimestamp(),
    },
  );
  return { success: true };
}

/** Customer unfollows a stall. */
export async function unfollowStall(customerUid, merchantEmail) {
  await deleteDoc(doc(db, FOLLOWS_COLLECTION, followDocId(customerUid, merchantEmail)));
  return { success: true };
}

/** Every merchantEmail one customer follows — used to drive the heart icon state and the "Following" filter. */
export async function fetchFollowedMerchants(customerUid) {
  const snap = await getDocs(
    query(collection(db, FOLLOWS_COLLECTION), where('customerUid', '==', customerUid)),
  );
  return snap.docs.map((d) => d.data().merchantEmail);
}

/** Full follow records (with stall name) for one customer, newest first — used by the Profile "Following" list. */
export async function fetchFollowedStalls(customerUid) {
  const snap = await getDocs(
    query(collection(db, FOLLOWS_COLLECTION), where('customerUid', '==', customerUid)),
  );
  return snap.docs
    .map((d) => {
      const data = d.data();
      return { ...data, createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0 };
    })
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
}

/** How many customers follow one stall — shown on the merchant's profile. */
export async function getFollowerCount(merchantEmail) {
  const snap = await getCountFromServer(
    query(collection(db, FOLLOWS_COLLECTION), where('merchantEmail', '==', merchantEmail)),
  );
  return snap.data().count;
}

/**
 * Batched follower counts for a list of deals — same shape as
 * getRatingStatsForMerchants, one Promise.all instead of one call at a time.
 * Returns a Map keyed by merchantEmail.
 */
export async function getFollowerCountsForMerchants(merchantEmails) {
  const unique = [...new Set(merchantEmails.filter(Boolean))];
  const results = await Promise.all(
    unique.map(async (email) => [email, await getFollowerCount(email)]),
  );
  return new Map(results);
}
