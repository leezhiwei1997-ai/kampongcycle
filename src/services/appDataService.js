// src/services/appDataService.js
//
// Real backend: food deals and reservations live in Firestore, so
// they're actually shared across every user's device — not just stored
// locally like the old AsyncStorage version.

import {
  collection, addDoc, getDocs, getDoc, deleteDoc, doc, query, where,
  orderBy, serverTimestamp, getCountFromServer, setDoc, updateDoc, increment, limit,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { isListable } from '../utils/listings';
import {
  makeOrderId, makeNonce, decodeHandover, canHandOver, HANDOVER_TTL_MS, deadlineMillis, COLLECT_GRACE_MS,
} from '../utils/reservations';
import { getUserByEmail, incrementNoShowCount } from './authService';
import { sendPushNotification } from './notificationService';

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
  // Sold-out listings now stay in the collection instead of being deleted,
  // so the feed has to filter on quantity as well as the pickup window.
  return all.filter((d) => isListable(d, now));
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
    originalPrice: deal?.originalPrice || null,
    originalPriceCents: toCents(deal?.originalPrice),
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
 * Denormalizes a stall's categories onto a deal payload before
 * publish/update, so Discover's category filter doesn't need an extra read
 * per deal. Best-effort: if ownerUid/stallId aren't given, or the stall
 * doc can't be read, the payload is returned unchanged rather than
 * blocking the publish.
 */
export async function attachStallCategories(dealPayload, ownerUid, stallId) {
  if (!ownerUid || !stallId) return dealPayload;
  try {
    const snap = await getDoc(doc(db, 'users', ownerUid, 'stalls', stallId));
    if (!snap.exists()) return dealPayload;
    return { ...dealPayload, stallId, categories: snap.data().categories || [] };
  } catch {
    return dealPayload;
  }
}

/**
 * SOFT RESERVE: a customer claims a portion, but this no longer touches
 * deal quantity — a reservation is a promise to show up, not yet a
 * committed portion. The actual decrement happens in beginHandover, at the
 * moment a merchant commits a physical portion to this specific customer.
 * See firestore.rules' quantity-update rules for the enforcement; this
 * function just no longer needs to guard against negative quantity itself,
 * since it never writes to quantity at all.
 *
 * `customer` should be { uid, name, email } of the person reserving, so
 * the merchant can see who's coming to collect it.
 */
export async function reserveFoodDeal(dealId, deal, customer) {
  if ((deal?.quantity ?? 1) <= 0) {
    throw new Error('Sorry, that portion has just been taken.');
  }

  const docRef = await addDoc(collection(db, RESERVATIONS_COLLECTION), {
    dealId,
    merchantEmail: deal?.merchantEmail || null,
    stall: deal?.stall || null,
    item: deal?.item || null,
    price: deal?.price || null,
    // Copied, not referenced: the deal document is deleted when its last
    // portion goes, so a thumbnail looked up later would be a broken image.
    image: deal?.image || null,
    // Snapshotted onto the reservation, not looked up later: the deal
    // document is DELETED when its last portion goes, so anything the
    // earnings view needs has to be copied here at reservation time.
    priceCents: toCents(deal?.price),
    collectByTimestamp: deal?.collectByTimestamp ?? null,
    // Human-readable code shown to the customer and encoded in their pickup
    // QR. The Firestore doc ID is still the real key — this is for people.
    orderId: makeOrderId(),
    customerUid: customer?.uid || null,
    customerName: customer?.name || 'A customer',
    customerEmail: customer?.email || null,
    status: 'pending',
    merchantStatus: 'preparing',
    reservedAt: serverTimestamp(),
  });

  // Best-effort, never blocks the reservation itself. Deals/reservations are
  // always keyed by the OWNER's email regardless of who's staffing the
  // stall, so this is who gets notified — see reserveFoodDeal's caller
  // (CustomerScreen.js) for the device-local "reservation confirmed" toast,
  // which is a separate, always-fires notification to the customer.
  getUserByEmail(deal?.merchantEmail).then((merchant) => {
    if (merchant?.pushToken) {
      sendPushNotification(
        merchant.pushToken,
        'New reservation! 🍽️',
        `${customer?.name || 'A customer'} reserved ${deal?.item || 'a portion'}.`,
      );
    }
  }).catch(() => {});

  return { success: true, dealId, reservationId: docRef.id };
}

/** Every reservation for one merchant, newest first — used by the merchant's "Reservations" tab. */

/**
 * Fills in `image` for reservations made before it was snapshotted onto them.
 *
 * Since the archive change, sold-out deals stay in the collection at
 * quantity 0 instead of being deleted, so most historical dealIds still
 * resolve. Only listings a merchant explicitly removed are gone for good —
 * those keep the placeholder.
 *
 * One read per distinct missing deal, deduped, capped so a long order history
 * can't fan out into hundreds of reads.
 */
const IMAGE_HYDRATE_LIMIT = 25;

async function hydrateImages(reservations) {
  const missing = [...new Set(
    reservations.filter((r) => !r.image && r.dealId).map((r) => r.dealId),
  )].slice(0, IMAGE_HYDRATE_LIMIT);

  if (missing.length === 0) return reservations;

  const found = new Map();
  await Promise.all(missing.map(async (dealId) => {
    try {
      const snap = await getDoc(doc(db, DEALS_COLLECTION, dealId));
      if (snap.exists()) {
        const d = snap.data();
        if (d.image || d.originalPrice) {
          found.set(dealId, { image: d.image || null, originalPrice: d.originalPrice || null });
        }
      }
    } catch {
      // Deleted listing or denied read — placeholder is the correct outcome.
    }
  }));

  const withDealImages = reservations.map((r) => {
    const hit = found.get(r.dealId);
    if (!hit) return r;
    return {
      ...r,
      image: r.image || hit.image || null,
      originalPrice: r.originalPrice || hit.originalPrice || null,
    };
  });

  // Second pass, free: some deals were hard-deleted under the old
  // delete-on-sellout behaviour, so there's nothing left to read. But the same
  // stall usually relists the same dish with the same photo, and other rows in
  // this batch may already have it. Match on merchant + dish name.
  //
  // Best-guess, not fact: if a stall reused a dish name with a different photo,
  // this shows the newer one. That's a thumbnail, and the alternative is a grey
  // placeholder, so the trade is worth it — but don't build anything on this
  // field that needs to be exactly right.
  const byDish = new Map();
  withDealImages.forEach((r) => {
    if (!r.image || !r.item) return;
    const key = `${r.merchantEmail}|${r.item}`;
    if (!byDish.has(key)) byDish.set(key, r.image);
  });

  return withDealImages.map((r) => {
    if (r.image || !r.item) return r;
    const guess = byDish.get(`${r.merchantEmail}|${r.item}`);
    return guess ? { ...r, image: guess, imageIsGuess: true } : r;
  });
}

export async function fetchReservationsForMerchant(merchantEmail) {
  const snap = await getDocs(
    query(
      collection(db, RESERVATIONS_COLLECTION),
      where('merchantEmail', '==', merchantEmail),
      orderBy('reservedAt', 'desc'),
    ),
  );
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      reservedAtMillis: data.reservedAt?.toMillis ? data.reservedAt.toMillis() : null,
      collectedAtMillis: data.collectedAt?.toMillis ? data.collectedAt.toMillis() : null,
    };
  });
  return hydrateImages(rows);
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
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      reservedAtMillis: data.reservedAt?.toMillis ? data.reservedAt.toMillis() : null,
      collectedAtMillis: data.collectedAt?.toMillis ? data.collectedAt.toMillis() : null,
    };
  });
  return hydrateImages(rows);
}

/** Merchant confirms a customer actually picked up their reserved portion. */
/**
 * Every status change writes here. Append-only by rule — nobody can edit or
 * delete an entry, including admins. A dispute is only worth reviewing if the
 * trail behind it can't be rewritten by either party.
 */
async function writeAudit(reservationId, entry) {
  await addDoc(collection(db, RESERVATIONS_COLLECTION, reservationId, 'auditLog'), {
    ...entry,
    at: serverTimestamp(),
  });
}

/**
 * MERCHANT (owner or staff): start a handover, or re-issue the QR
 * ("Refresh") on one already in progress. Writes a short-lived nonce onto
 * the reservation and returns it for the QR. Does NOT mark anything
 * collected — the merchant is not permitted to do that, here or in the
 * rules.
 *
 * This is where the soft-reserve quantity decrement actually happens (see
 * reserveFoodDeal) — but only the FIRST time a handover starts on this
 * reservation (reservation.status === 'pending'), not on a QR refresh,
 * which re-calls this same function against an already-'awaiting_handover'
 * reservation and must not decrement again. Wrapped in try/catch: a deal a
 * merchant already removed shouldn't block the handover itself, it just
 * means there's no listing left to decrement.
 */
export async function beginHandover(reservationId, reservation, actorUid) {
  if (reservation && !canHandOver(reservation)) {
    throw new Error('That pickup window has closed. Record what happened instead.');
  }
  const nonce = makeNonce();
  const handoverExpiresAt = Date.now() + HANDOVER_TTL_MS;
  const isFirstStart = reservation?.status === 'pending';

  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: 'awaiting_handover',
    handoverNonce: nonce,
    handoverExpiresAt,
  });

  if (isFirstStart && reservation?.dealId) {
    try {
      await updateDoc(doc(db, DEALS_COLLECTION, reservation.dealId), { quantity: increment(-1) });
    } catch {
      // Deal already removed by the merchant — nothing left to decrement.
    }
  }

  await writeAudit(reservationId, { actor: actorUid, action: 'handover_started' });

  return { nonce, handoverExpiresAt };
}

/**
 * CUSTOMER: confirm receipt by scanning the merchant's QR.
 *
 * The verification that matters lives in firestore.rules — this function can
 * be bypassed by anyone with the SDK, the rule cannot. What's checked there:
 * the caller is the reservation's own customer, the nonce matches, and it
 * hasn't expired.
 */
export async function confirmPickupByScan(scannedPayload, customerUid) {
  const parsed = decodeHandover(scannedPayload);
  if (!parsed) throw new Error('That doesn\u2019t look like a pickup code.');

  const ref = doc(db, RESERVATIONS_COLLECTION, parsed.reservationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('That order no longer exists.');

  const data = snap.data();
  if (data.customerUid !== customerUid) throw new Error('That code is for a different customer.');
  if (data.status === 'collected') throw new Error('That order is already confirmed.');
  if (data.status !== 'awaiting_handover') throw new Error('The stall hasn\u2019t started the handover yet.');
  if (!Number.isFinite(data.handoverExpiresAt) || Date.now() > data.handoverExpiresAt) {
    throw new Error('That code expired. Ask the stall to show it again.');
  }

  await updateDoc(ref, {
    status: 'collected',
    collectedAt: serverTimestamp(),
    collectedBy: customerUid,
    scannedNonce: parsed.nonce,
  });
  await writeAudit(parsed.reservationId, { actor: customerUid, action: 'collection_confirmed' });

  return { success: true, reservationId: parsed.reservationId, item: data.item };
}

/**
 * Closes out a reservation that was never collected, recording WHY.
 *
 * The app can tell that a pickup window passed with the food uncollected;
 * it cannot tell whether the customer failed to show or the stall ran out.
 * That's a human judgement, so it's stored rather than derived — and it
 * matters, because a no-show shouldn't count against the merchant's
 * fulfilment rate while a shortfall should.
 *
 * outcome: 'no_show' | 'merchant_shortfall'
 */
export async function resolveReservation(reservationId, outcome, { actorUid, reason } = {}) {
  const allowed = ['no_show', 'merchant_shortfall', 'disputed'];
  if (!allowed.includes(outcome)) {
    throw new Error(`Outcome must be one of ${allowed.join(', ')}.`);
  }
  if (outcome === 'disputed' && !String(reason || '').trim()) {
    throw new Error('A dispute needs a reason — an admin has to read it.');
  }

  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: outcome,
    resolvedAt: serverTimestamp(),
    handledByUid: actorUid || null,
    ...(outcome === 'disputed' ? { disputeReason: String(reason).trim(), disputedBy: 'merchant' } : {}),
  });
  await writeAudit(reservationId, { actor: actorUid, action: outcome, reason: reason || null });
  return { success: true };
}

/**
 * Watches a single reservation. Used by the merchant's handover modal so it
 * reacts the moment the customer scans — without this, "the order updates by
 * itself" was simply untrue and the merchant had to back out and refresh.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToReservation(reservationId, callback) {
  return onSnapshot(
    doc(db, RESERVATIONS_COLLECTION, reservationId),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    () => callback(null),
  );
}

/**
 * CUSTOMER: cancel their own reservation before it's collected. Gives back
 * the quantity a handover had already taken from the deal — but only if a
 * handover had actually started (status was 'awaiting_handover'); a
 * still-'pending' cancel never touched quantity in the first place under
 * the soft-reserve model, so there's nothing to give back.
 */
export async function cancelReservationAsCustomer(reservationId, reservation, customerUid) {
  const hadDecremented = reservation?.status === 'awaiting_handover';

  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: 'cancelled',
    resolvedAt: serverTimestamp(),
  });

  if (hadDecremented && reservation?.dealId) {
    try {
      await updateDoc(doc(db, DEALS_COLLECTION, reservation.dealId), { quantity: increment(1) });
    } catch {
      // Deal already removed by the merchant — nothing to give back to.
    }
  }

  await writeAudit(reservationId, { actor: customerUid, action: 'cancelled' });
  return { success: true };
}

/**
 * CUSTOMER: "Something went wrong" — mirrors the merchant's dispute path in
 * resolveReservation, but from the other side. Available from almost any
 * status (see canCustomerDispute in utils/reservations.js) — including
 * after 'collected', for a stall that shorted the order.
 */
export async function raiseDisputeAsCustomer(reservationId, customerUid, reason) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) throw new Error('A dispute needs a reason — an admin has to read it.');

  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: 'disputed',
    resolvedAt: serverTimestamp(),
    disputeReason: trimmed,
    disputedBy: 'customer',
  });
  await writeAudit(reservationId, { actor: customerUid, action: 'disputed', reason: trimmed });
  return { success: true };
}

/**
 * MERCHANT (owner or staff): sweep pending reservations whose grace period
 * (pickup deadline + COLLECT_GRACE_MS, same window canHandOver uses) has
 * passed, and flip them to 'expired'. No Cloud Functions in this app, so
 * this runs opportunistically from whichever stall member's device has the
 * Reservations tab open — see MerchantScreen.js's ReservationsTab.load().
 * Capped per call so a long-neglected tab can't fan out into a write storm.
 */
const AUTO_EXPIRE_SWEEP_LIMIT = 25;

export async function autoExpireReservation(reservations, actorUid) {
  const now = Date.now();
  const overdue = reservations.filter((r) => {
    if (r.status !== 'pending') return false;
    const deadline = deadlineMillis(r);
    return deadline != null && now > deadline + COLLECT_GRACE_MS;
  }).slice(0, AUTO_EXPIRE_SWEEP_LIMIT);

  await Promise.all(overdue.map(async (r) => {
    try {
      await updateDoc(doc(db, RESERVATIONS_COLLECTION, r.id), {
        status: 'expired',
        resolvedAt: serverTimestamp(),
      });
      await writeAudit(r.id, { actor: actorUid, action: 'expired' });
    } catch {
      // Best-effort sweep — one failed write shouldn't stop the rest.
    }
  }));

  return overdue.map((r) => r.id);
}

/**
 * CUSTOMER: idempotency bookkeeping — marks one of the customer's OWN
 * expired reservations as already counted toward noShowCount, then bumps
 * the counter (authService.js's incrementNoShowCount). Split into two
 * writes because they're two different documents under two different
 * rules; this function just sequences them from one call site
 * (CustomerScreen.js's OrdersTab.load()).
 */
export async function reconcileCustomerNoShows(reservationId, customerUid, currentNoShowCount) {
  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), { noShowCounted: true });
  await incrementNoShowCount(customerUid, currentNoShowCount);
}

/** CUSTOMER: an optional note for the stall, editable any time, not gated to a status. */
export async function setReservationNotes(reservationId, customerNotes) {
  const trimmed = String(customerNotes || '').slice(0, 200);
  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), { customerNotes: trimmed });
  return { success: true };
}

/**
 * MERCHANT (owner or staff): the one-tap kitchen-progress label shown to
 * the customer. Its own narrow write, touching ONLY merchantStatus, so it
 * can never be combined with a write that also sets `status` — see
 * firestore.rules' comment on why that separation matters.
 */
export async function setMerchantStatus(reservationId, merchantStatus) {
  const allowed = ['preparing', 'ready', 'completed'];
  if (!allowed.includes(merchantStatus)) throw new Error('Invalid kitchen status.');
  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), { merchantStatus });
  return { success: true };
}

/**
 * Per-reservation quick messages — the in-app substitute for texting a
 * stall's WhatsApp. notifyTarget is the OTHER party's push token (looked up
 * by the caller, since the caller already knows who they are); notifying is
 * best-effort and never blocks the send.
 */
export async function sendReservationMessage(reservationId, { senderUid, senderRole, text }, notifyTarget) {
  const trimmed = String(text || '').trim().slice(0, 200);
  if (!trimmed) throw new Error('Message can’t be empty.');

  await addDoc(collection(db, RESERVATIONS_COLLECTION, reservationId, 'messages'), {
    senderUid,
    senderRole,
    text: trimmed,
    createdAt: serverTimestamp(),
  });

  if (notifyTarget) {
    sendPushNotification(notifyTarget, 'New message', trimmed).catch(() => {});
  }

  return { success: true };
}

/** Live message thread for one reservation, oldest first. Returns an unsubscribe function. */
export function subscribeToMessages(reservationId, callback) {
  return onSnapshot(
    query(collection(db, RESERVATIONS_COLLECTION, reservationId, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => callback(snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now() };
    })),
    () => callback([]),
  );
}

/** ADMIN: every reservation waiting on a human decision. */
export async function fetchDisputedReservations() {
  const snap = await getDocs(
    query(collection(db, RESERVATIONS_COLLECTION), where('status', '==', 'disputed')),
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

/**
 * ADMIN: settle a dispute one way or the other. refundAgreedOffline is
 * optional and purely an admin note-to-self — this app moves no money at
 * all (v1/beta payment model is cash/PayNow directly to the hawker), so it
 * is never proof a refund actually happened.
 */
export async function resolveDispute(reservationId, outcome, { actorUid, resolution, refundAgreedOffline } = {}) {
  const allowed = ['collected', 'no_show', 'merchant_shortfall'];
  if (!allowed.includes(outcome)) throw new Error('Invalid dispute outcome.');

  await updateDoc(doc(db, RESERVATIONS_COLLECTION, reservationId), {
    status: outcome,
    resolvedAt: serverTimestamp(),
    ...(refundAgreedOffline != null ? { refundAgreedOffline } : {}),
  });
  await writeAudit(reservationId, {
    actor: actorUid, action: `dispute_resolved_${outcome}`, resolution: resolution || null,
  });
  return { success: true };
}

/**
 * Looks up a reservation by its human/QR order code.
 *
 * Deliberately a single equality filter: adding `where('merchantEmail')`
 * alongside it would need a composite index. The merchant check happens
 * client-side below instead, which costs one extra document read and no
 * index maintenance.
 *
 * Order codes are not guaranteed unique (see makeOrderId), so this fetches
 * a handful and picks the one belonging to this merchant.
 */
export async function findReservationByOrderId(orderId, merchantEmail) {
  const code = String(orderId || '').trim().toUpperCase();
  if (!code) return null;

  const snap = await getDocs(
    query(collection(db, RESERVATIONS_COLLECTION), where('orderId', '==', code), limit(5)),
  );
  const matches = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.merchantEmail === merchantEmail);

  if (matches.length === 0) return null;
  // Prefer one that still needs collecting over an already-closed duplicate.
  return matches.find((r) => r.status === 'pending') || matches[0];
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
