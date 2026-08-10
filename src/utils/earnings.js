// src/utils/earnings.js
//
// Pure logic: no React, no Firestore. Everything here is a function of
// (reservations array, clock), so it can be tested by calling it with a
// hand-written array and a fixed `now`. See the note at the bottom.

const DAY_MS = 24 * 60 * 60 * 1000;

// Reservations written before `collectByTimestamp` was stored on them have
// no pickup deadline. For those we assume a portion left uncollected a day
// after it was reserved was a no-show. Only affects historical rows.
export const NO_SHOW_GRACE_MS = DAY_MS;

/**
 * Money is stored twice on a reservation: `price` as a display string
 * ("$3.50") and `priceCents` as an integer. Older rows only have the
 * string, so fall back to parsing it. Integer cents throughout — never
 * sum floats for money.
 */
export function parsePriceCents(reservation) {
  if (Number.isFinite(reservation?.priceCents)) return reservation.priceCents;
  const n = parseFloat(String(reservation?.price ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** reservedAt arrives as a Firestore Timestamp or a pre-converted millis field. */
export function reservationMillis(r) {
  if (Number.isFinite(r?.reservedAtMillis)) return r.reservedAtMillis;
  if (r?.reservedAt?.toMillis) return r.reservedAt.toMillis();
  return null;
}

/** When this portion stopped being collectable. */
export function deadlineMillis(r) {
  if (Number.isFinite(r?.collectByTimestamp)) return r.collectByTimestamp;
  const start = reservationMillis(r);
  return start == null ? null : start + NO_SHOW_GRACE_MS;
}

/**
 * 'collected' | 'cancelled' | 'noShow' | 'awaiting'
 *
 * The distinction that matters: an uncollected reservation is only a
 * no-show once its pickup window has passed. Before that it's simply
 * still open, and counting it against the merchant would be wrong.
 */
export function classify(r, now = Date.now()) {
  if (r?.status === 'collected') return 'collected';
  if (r?.status === 'cancelled') return 'cancelled';
  const deadline = deadlineMillis(r);
  if (deadline != null && now > deadline) return 'noShow';
  return 'awaiting';
}

/** Local-time boundaries for today / this week (Mon start) / this month. */
export function periodStarts(now = Date.now()) {
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const mondayOffset = (new Date(day).getDay() + 6) % 7;
  return {
    day,
    week: day - mondayOffset * DAY_MS,
    month: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
  };
}

/**
 * Revenue counts COLLECTED reservations only. A reservation that was never
 * picked up earned the merchant nothing, and showing it as revenue would
 * make the dashboard lie in the merchant's favour.
 */
export function computeEarnings(reservations = [], now = Date.now()) {
  const starts = periodStarts(now);
  const revenueCents = {
    today: 0, week: 0, month: 0, all: 0,
  };
  const counts = {
    collected: 0, awaiting: 0, noShow: 0, cancelled: 0,
  };
  const byDish = new Map();

  reservations.forEach((r) => {
    const state = classify(r, now);
    counts[state] += 1;
    if (state !== 'collected') return;

    const cents = parsePriceCents(r);
    const at = reservationMillis(r);
    revenueCents.all += cents;
    if (at != null) {
      if (at >= starts.month) revenueCents.month += cents;
      if (at >= starts.week) revenueCents.week += cents;
      if (at >= starts.day) revenueCents.today += cents;
    }

    const key = r.item || 'Unnamed dish';
    const entry = byDish.get(key) || { item: key, count: 0, revenueCents: 0 };
    entry.count += 1;
    entry.revenueCents += cents;
    byDish.set(key, entry);
  });

  // Denominator is RESOLVED reservations only. Including still-open ones
  // would drag the rate down every time a new order comes in, which would
  // make the number useless as a signal.
  const resolved = counts.collected + counts.noShow;

  return {
    revenueCents,
    counts,
    resolved,
    mealsSaved: counts.collected,
    fulfilmentRate: resolved === 0 ? null : counts.collected / resolved,
    topDishes: [...byDish.values()]
      .sort((a, b) => b.count - a.count || b.revenueCents - a.revenueCents)
      .slice(0, 3),
  };
}

export function formatCents(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export function formatRate(rate) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

// ---- How to test ----
//
// No jest in this project, so the quickest check is plain node. Copy this
// file to earnings.mjs and append:
//
//   const NOW = new Date('2026-08-11T12:00:00').getTime();
//   const rows = [
//     { status: 'collected', price: '$3.50', item: 'Nasi Lemak', reservedAtMillis: NOW - 1000 },
//     { status: 'collected', price: '$3.50', item: 'Nasi Lemak', reservedAtMillis: NOW - 1000 },
//     { status: 'pending', price: '$4.00', item: 'Mee Goreng', reservedAtMillis: NOW - 1000 },
//     { status: 'pending', price: '$4.00', item: 'Mee Goreng', reservedAtMillis: NOW - 5 * 86400000 },
//   ];
//   const s = computeEarnings(rows, NOW);
//   console.log(formatCents(s.revenueCents.today));  // $7.00
//   console.log(s.counts);                            // collected 2, awaiting 1, noShow 1
//   console.log(formatRate(s.fulfilmentRate));        // 67%  (2 of 3 resolved)
//
// then `node earnings.mjs`. The fourth row is the case worth keeping: it's
// still 'pending' but five days old, so it counts against the rate while
// the fresh pending one does not.
