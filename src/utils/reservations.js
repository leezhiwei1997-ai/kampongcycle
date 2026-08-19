// src/utils/reservations.js
//
// Reservation lifecycle. Pure — no React, no Firestore.
//
// STORED statuses (what's in the document):
//   'pending'             — reserved, not yet resolved
//   'awaiting_handover'   — merchant started a handover, waiting on the customer
//   'collected'           — customer picked it up
//   'no_show'             — customer never came        (merchant attributed)
//   'merchant_shortfall'  — stall couldn't fulfil it   (merchant attributed)
//   'disputed'            — either side flagged it, waiting on an admin
//   'cancelled'           — called off before pickup, by the customer
//   'expired'             — a 'pending' reservation nobody acted on within
//                            the grace period (see appDataService.js's
//                            autoExpireReservation) — the pending-side
//                            counterpart to 'unconfirmed' below.
//
// DERIVED state adds one more: a still-'pending' reservation whose pickup
// window has passed, but the grace period hasn't yet, is 'needsReview' —
// same label as 'expired' gets once it's actually written, since by the
// time autoExpireReservation writes it the human-judgement question is the
// same either way. Whose fault it was is a human judgement — the app can
// tell that something went wrong, but not who it went wrong for. So it
// surfaces the question and the merchant answers it.

const DAY_MS = 24 * 60 * 60 * 1000;
export const FALLBACK_WINDOW_MS = DAY_MS;

// No 0/O/1/I/L — these get read aloud across a noisy hawker centre and
// written on receipts. Ambiguous glyphs cost more than the extra entropy.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Human-readable order code: KC-260811-7F4Q
 *
 * The date prefix makes it sortable and scannable by eye; the 4 random
 * chars disambiguate within a day. This is NOT globally unique — roughly
 * a million combinations per day, which is ample at hawker-stall volume
 * but is a birthday-problem gamble, not a guarantee. The Firestore
 * document ID remains the real key; this is for humans.
 */
export function makeOrderId(now = Date.now()) {
  const d = new Date(now);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `KC-${yy}${mm}${dd}-${randomChars(4)}`;
}

export function reservationMillis(r) {
  if (Number.isFinite(r?.reservedAtMillis)) return r.reservedAtMillis;
  if (r?.reservedAt?.toMillis) return r.reservedAt.toMillis();
  return null;
}

export function deadlineMillis(r) {
  if (Number.isFinite(r?.collectByTimestamp)) return r.collectByTimestamp;
  const start = reservationMillis(r);
  return start == null ? null : start + FALLBACK_WINDOW_MS;
}

/**
 * How long after the pickup window a merchant can still mark something
 * collected.
 *
 * Not zero: a stall handing over food at 19:59 and tapping the button at
 * 20:03 did nothing wrong, and blocking that would just teach merchants to
 * mark orders collected in advance — which destroys the meaning of the
 * whole field. Not unbounded either: yesterday's order being closed today
 * is either a mistake or a merchant tidying up their fulfilment rate, and
 * neither should be possible. Two hours splits it.
 */
/**
 * How long a handover QR stays valid once the merchant taps "Hand over".
 *
 * Short on purpose: the QR only proves the customer was standing at the
 * stall when it was shown. A long-lived code could be screenshotted and
 * confirmed later from anywhere, which is the thing this whole flow exists
 * to prevent.
 */
export const HANDOVER_TTL_MS = 5 * 60 * 1000;

/**
 * After the pickup window closes, how long before an unconfirmed handover
 * becomes the merchant's to account for.
 */
/**
 * How long after issuing a QR before "Refresh" becomes tappable.
 *
 * Guards against a double-tap invalidating the code the customer is halfway
 * through scanning — the old nonce dies the instant a new one is written, so
 * an accidental refresh is worse than a slow one.
 */
export const REFRESH_COOLDOWN_MS = 30 * 1000;

export const UNCONFIRMED_GRACE_MS = 24 * 60 * 60 * 1000;

/** Unguessable-enough nonce. Not a secret (see firestore.rules) — a freshness token. */
export function makeNonce() {
  return `${Date.now().toString(36)}${randomChars(10)}`;
}

/** Payload encoded in the merchant's handover QR. */
export function encodeHandover(reservationId, nonce) {
  return `KCH:${reservationId}:${nonce}`;
}

export function decodeHandover(scanned) {
  const parts = String(scanned || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'KCH') return null;
  return { reservationId: parts[1], nonce: parts[2] };
}

export function handoverIsLive(r, now = Date.now()) {
  return r?.status === 'awaiting_handover'
    && Number.isFinite(r?.handoverExpiresAt)
    && now <= r.handoverExpiresAt;
}

export const COLLECT_GRACE_MS = 2 * 60 * 60 * 1000;

/** Wait before a customer can review — they should have eaten it first. */
export const REVIEW_DELAY_MS = 60 * 60 * 1000;

export function collectedMillis(r) {
  if (Number.isFinite(r?.collectedAtMillis)) return r.collectedAtMillis;
  if (r?.collectedAt?.toMillis) return r.collectedAt.toMillis();
  return null;
}

const CLOSED = ['collected', 'no_show', 'merchant_shortfall', 'cancelled', 'disputed', 'expired'];

/**
 * Can the merchant start a handover on this? Note what this is NOT: there is
 * no "can the merchant mark it collected" any more. The merchant is the party
 * that benefits from a false confirmation — fulfilment rate, and money once
 * payment lands — so the merchant is not allowed to be the one confirming.
 * Enforced in firestore.rules, not just here.
 */
export function canHandOver(r, now = Date.now()) {
  if (!r || CLOSED.includes(r.status)) return false;
  const deadline = deadlineMillis(r);
  if (deadline == null) return true;
  return now <= deadline + COLLECT_GRACE_MS;
}

/** Can the CUSTOMER confirm receipt right now? */
export function canConfirmPickup(r, now = Date.now()) {
  return handoverIsLive(r, now);
}

/** Merchant must account for this one: no-show, ran out, or dispute. */
export function needsMerchantResolution(r, now = Date.now()) {
  const state = classifyReservation(r, now);
  return state === 'needsReview' || state === 'unconfirmed';
}

/** A review is about the food, so it waits until they've had time to eat it. */
export function reviewAvailableAt(r) {
  const at = collectedMillis(r);
  return at == null ? null : at + REVIEW_DELAY_MS;
}

export function canReview(r, now = Date.now()) {
  if (r?.status !== 'collected') return false;
  const at = reviewAvailableAt(r);
  // Older reservations have no collectedAt — don't lock them out forever.
  if (at == null) return true;
  return now >= at;
}

/** 'collected' | 'cancelled' | 'noShow' | 'merchantFault' | 'needsReview' | 'awaiting' */
export function classifyReservation(r, now = Date.now()) {
  switch (r?.status) {
    case 'collected': return 'collected';
    case 'cancelled': return 'cancelled';
    case 'no_show': return 'noShow';
    case 'merchant_shortfall': return 'merchantFault';
    case 'disputed': return 'disputed';
    // Written after the grace period by autoExpireReservation — same bucket
    // a not-yet-swept-but-overdue 'pending' reservation already falls into
    // below, so nothing downstream (STATUS_LABEL, fulfilmentSummary, ...)
    // needs to know the difference between "overdue" and "swept overdue".
    case 'expired': return 'needsReview';
    default: break;
  }

  const deadline = deadlineMillis(r);
  const expired = deadline != null && now > deadline;

  if (r?.status === 'awaiting_handover') {
    // Handed over but never confirmed by the customer. It only becomes the
    // merchant's problem to resolve after the grace period — before that it
    // is simply in progress.
    if (expired && deadline != null && now > deadline + UNCONFIRMED_GRACE_MS) {
      return 'unconfirmed';
    }
    return 'handingOver';
  }

  if (expired) return 'needsReview';
  return 'awaiting';
}

/**
 * Merchant-facing wording. Kept as STATUS_LABEL for compatibility.
 */
export const STATUS_LABEL = {
  awaiting: 'Awaiting pickup',
  handingOver: 'Waiting for customer to confirm',
  unconfirmed: 'Never confirmed — what happened?',
  needsReview: 'Expired — what happened?',
  collected: 'Collected',
  noShow: 'Customer no-show',
  merchantFault: 'We couldn\u2019t fulfil it',
  disputed: 'Under review',
  cancelled: 'Cancelled',
};

/**
 * Customer-facing wording for the same states.
 *
 * These are NOT translations of the merchant labels — the same state means
 * something different depending on who's looking. "Waiting for customer to
 * confirm" is accurate on the merchant's screen and nonsense on the
 * customer's, where the customer IS the one who has to act.
 */
export const CUSTOMER_STATUS_LABEL = {
  awaiting: 'Awaiting pickup',
  handingOver: 'Ready — confirm pickup',
  unconfirmed: 'Not confirmed',
  needsReview: 'Pickup window closed',
  collected: 'Collected',
  noShow: 'Marked as no-show',
  merchantFault: 'Stall couldn\u2019t fulfil it',
  disputed: 'Under review',
  cancelled: 'Cancelled',
};

/**
 * The label a customer should see, accounting for one case a bare state
 * can't express: the merchant started a handover but the 5-minute code has
 * since expired. The customer can't do anything until the stall re-issues
 * it, so telling them to "confirm pickup" would be sending them to a button
 * that isn't there.
 */
export function customerStatusLabel(r, now = Date.now()) {
  const state = classifyReservation(r, now);
  if (state === 'handingOver' && !handoverIsLive(r, now)) {
    return 'Ask the stall to show the code again';
  }
  return CUSTOMER_STATUS_LABEL[state];
}

/** Open items a customer or merchant still has to act on, for day headers. */
export function openCount(items = [], now = Date.now()) {
  return items.filter((r) => {
    const state = classifyReservation(r, now);
    return state === 'awaiting' || state === 'handingOver';
  }).length;
}

/** Local midnight for a timestamp — the grouping key for "the day itself". */
export function dayKey(millis) {
  if (millis == null) return null;
  const d = new Date(millis);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayLabel(millis, now = Date.now()) {
  const key = dayKey(millis);
  if (key == null) return 'Unknown date';
  const today = dayKey(now);
  if (key === today) return 'Today';
  if (key === today - DAY_MS) return 'Yesterday';
  return new Date(key).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/**
 * Groups reservations into days, newest day first, newest order first
 * within each day. Returns [{ key, label, items, collected, total }].
 */
export function groupByDay(reservations = [], now = Date.now()) {
  const buckets = new Map();

  reservations.forEach((r) => {
    const key = dayKey(reservationMillis(r));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  });

  return [...buckets.entries()]
    .sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0))
    .map(([key, items]) => {
      const sorted = [...items].sort(
        (a, b) => (reservationMillis(b) ?? 0) - (reservationMillis(a) ?? 0),
      );
      return {
        key: String(key),
        label: dayLabel(key, now),
        items: sorted,
        total: sorted.length,
        collected: sorted.filter((r) => r.status === 'collected').length,
      };
    });
}

/** Anything the merchant still has to act on, oldest first. */
export function needsAction(reservations = [], now = Date.now()) {
  return reservations.filter((r) => {
    const state = classifyReservation(r, now);
    return state === 'awaiting' || state === 'needsReview';
  });
}

// ---- How to test ----
//
//   const NOW = Date.now();
//   classifyReservation({ status: 'pending', collectByTimestamp: NOW + 6e4 }, NOW) // 'awaiting'
//   classifyReservation({ status: 'pending', collectByTimestamp: NOW - 6e4 }, NOW) // 'needsReview'
//   classifyReservation({ status: 'no_show' }, NOW)                                // 'noShow'
//   makeOrderId(new Date('2026-08-11').getTime())  // 'KC-260811-XXXX'
//   groupByDay([{ reservedAtMillis: NOW }, { reservedAtMillis: NOW - 2*864e5 }], NOW)
//     // two groups: 'Today' then the dated label

/**
 * Merchant-facing fulfilment summary. Same denominator rule as
 * utils/earnings.js: customer no-shows are excluded because they aren't
 * something the stall controls, but unresolved expiries are included so
 * that ignoring them can't hold the rate at 100%.
 */
export function fulfilmentSummary(reservations = [], now = Date.now()) {
  const counts = {
    collected: 0,
    awaiting: 0,
    handingOver: 0,
    unconfirmed: 0,
    needsReview: 0,
    noShow: 0,
    merchantFault: 0,
    disputed: 0,
    cancelled: 0,
  };
  reservations.forEach((r) => { counts[classifyReservation(r, now)] += 1; });

  // 'disputed' is deliberately absent from both sides: it's with an admin, and
  // scoring it either way would prejudge the outcome.
  const denom = counts.collected + counts.merchantFault + counts.needsReview + counts.unconfirmed;
  return {
    counts,
    rate: denom === 0 ? null : counts.collected / denom,
    open: counts.awaiting + counts.handingOver + counts.needsReview + counts.unconfirmed,
  };
}

/**
 * Semantic tone per state. Returns a name, not a hex value, so the card maps
 * it onto the Paper theme rather than hardcoding colours that would break the
 * moment the theme changes.
 */
export function statusTone(state) {
  switch (state) {
    case 'collected': return 'success';
    case 'handingOver': return 'warning';
    case 'awaiting': return 'info';
    case 'needsReview':
    case 'unconfirmed':
    case 'merchantFault': return 'danger';
    case 'disputed': return 'warning';
    default: return 'muted';
  }
}

/** States the merchant has nothing left to do about. */
export function isResolvedState(state) {
  return ['collected', 'noShow', 'merchantFault', 'cancelled', 'disputed'].includes(state);
}

/** A customer can cancel any time before a handover is actually confirmed. */
export function canCustomerCancel(r) {
  return ['pending', 'awaiting_handover'].includes(r?.status);
}

/**
 * A customer can raise a dispute from almost any state — including after
 * 'collected' ("I paid but didn't get what was promised") — the one thing
 * that can't be re-disputed is a reservation that's already disputed or
 * already cancelled. Mirrors firestore.rules' customer-dispute rule exactly.
 */
export function canCustomerDispute(r) {
  return !['disputed', 'cancelled'].includes(r?.status);
}

const ACTIVE_STATUSES = ['pending', 'awaiting_handover'];

/** Anti-griefing cap: at most 5 reservations open at once, one per deal. */
export const MAX_ACTIVE_RESERVATIONS = 5;

/**
 * Client-side pre-check before calling reserveFoodDeal — best-effort only,
 * same trust level as the rest of this app's anti-griefing measures (see
 * firestore.rules' NOTE on this same cap: it can't be enforced server-side
 * without a Cloud Function, which this app doesn't have).
 */
export function canCustomerReserve(reservations = [], dealId) {
  const active = reservations.filter((r) => ACTIVE_STATUSES.includes(r?.status));
  if (active.some((r) => r.dealId === dealId)) {
    return { ok: false, reason: 'You already have an open reservation for this deal.' };
  }
  if (active.length >= MAX_ACTIVE_RESERVATIONS) {
    return { ok: false, reason: `You can only have ${MAX_ACTIVE_RESERVATIONS} open reservations at once.` };
  }
  return { ok: true, reason: null };
}
