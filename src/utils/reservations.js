// src/utils/reservations.js
//
// Reservation lifecycle. Pure — no React, no Firestore.
//
// STORED statuses (what's in the document):
//   'pending'             — reserved, not yet resolved
//   'collected'           — customer picked it up
//   'no_show'             — customer never came        (merchant attributed)
//   'merchant_shortfall'  — stall couldn't fulfil it   (merchant attributed)
//   'cancelled'           — called off before pickup
//
// DERIVED state adds one more: a 'pending' reservation whose pickup window
// has passed is 'needsReview'. It isn't written anywhere, because whose
// fault it was is a human judgement — the app can tell that something went
// wrong, but not who it went wrong for. So it surfaces the question and the
// merchant answers it.

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

/** 'collected' | 'cancelled' | 'noShow' | 'merchantFault' | 'needsReview' | 'awaiting' */
export function classifyReservation(r, now = Date.now()) {
  switch (r?.status) {
    case 'collected': return 'collected';
    case 'cancelled': return 'cancelled';
    case 'no_show': return 'noShow';
    case 'merchant_shortfall': return 'merchantFault';
    default: break;
  }
  const deadline = deadlineMillis(r);
  if (deadline != null && now > deadline) return 'needsReview';
  return 'awaiting';
}

export const STATUS_LABEL = {
  awaiting: 'Awaiting pickup',
  needsReview: 'Expired — what happened?',
  collected: 'Collected',
  noShow: 'Customer no-show',
  merchantFault: 'We couldn\u2019t fulfil it',
  cancelled: 'Cancelled',
};

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
