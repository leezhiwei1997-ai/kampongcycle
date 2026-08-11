// src/utils/impact.js
//
// Customer impact and badge tiers. Pure — no React, no Firestore.

import { classifyReservation } from './reservations';
import { parsePriceCents } from './earnings';

/**
 * The badge used to be the hardcoded string "Kampong Eco Champion" on every
 * profile — the newest signup and someone who'd rescued fifty meals wore the
 * same one, so it said nothing. These tiers give it something to measure.
 *
 * Thresholds are a product decision, not a fact; change them freely.
 */
export const TIERS = [
  {
    key: 'new', min: 0, label: 'Kampong Newcomer', emoji: '🥢',
  },
  {
    key: 'sprout', min: 1, label: 'Kampong Sprout', emoji: '🌱',
  },
  {
    key: 'saver', min: 5, label: 'Kampong Saver', emoji: '🌿',
  },
  {
    key: 'champion', min: 15, label: 'Kampong Champion', emoji: '🏅',
  },
  {
    key: 'legend', min: 40, label: 'Kampong Legend', emoji: '🌏',
  },
];

export function tierFor(rescued = 0) {
  return [...TIERS].reverse().find((t) => rescued >= t.min) || TIERS[0];
}

export function nextTier(rescued = 0) {
  return TIERS.find((t) => t.min > rescued) || null;
}

/**
 * CO2 estimate.
 *
 * ~2.5 kg CO2e per meal rescued is the figure the surplus-food sector
 * generally uses (Too Good To Go publish this per "Surprise Bag"). It is an
 * ESTIMATE built on averages for portion weight and food type — it is not
 * measured, and a rescued coffee and a rescued chicken rice are counted the
 * same. Label it as an estimate wherever it's shown; don't put it in a
 * sustainability report.
 */
export const CO2_KG_PER_MEAL = 2.5;

export function computeImpact(reservations = [], now = Date.now()) {
  let rescued = 0;
  let spentCents = 0;
  let savedCents = 0;

  reservations.forEach((r) => {
    if (classifyReservation(r, now) !== 'collected') return;
    rescued += 1;

    const paid = parsePriceCents(r);
    spentCents += paid;

    // Only counts where the original price is actually known. Reservations
    // made before that field existed, whose deal has since been deleted,
    // contribute nothing rather than a guessed saving.
    const original = Number.isFinite(r.originalPriceCents) && r.originalPriceCents > 0
      ? r.originalPriceCents
      : parsePriceCents({ price: r.originalPrice });
    if (original > paid) savedCents += original - paid;
  });

  return {
    rescued,
    spentCents,
    savedCents,
    co2Kg: rescued * CO2_KG_PER_MEAL,
    tier: tierFor(rescued),
    next: nextTier(rescued),
  };
}

/**
 * Verb per state. The first version only checked `status === 'collected'`,
 * so an order mid-handover, a no-show and a stall shortfall all read
 * "Reserved" — the feed said nothing about what had actually happened.
 */
const ACTIVITY_VERB = {
  collected: 'Collected',
  handingOver: 'Collecting',
  awaiting: 'Reserved',
  needsReview: 'Missed',
  unconfirmed: 'Unconfirmed',
  noShow: 'Missed',
  merchantFault: 'Stall ran out of',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

/**
 * Most recent things the customer did, newest first.
 *
 * `repeatStall` marks a row whose stall is the same as the row above it, so
 * the caller can drop the repetition — three consecutive lines ending
 * "from Hawker Testing" is noise, not information.
 */
export function recentActivity(reservations = [], limit = 5, now = Date.now()) {
  const rows = [...reservations]
    .sort((a, b) => (b.reservedAtMillis ?? 0) - (a.reservedAtMillis ?? 0))
    .slice(0, limit)
    .map((r) => {
      const state = classifyReservation(r, now);
      return {
        id: r.id,
        item: r.item,
        stall: r.stall,
        price: r.price,
        orderId: r.orderId,
        state,
        atMillis: r.reservedAtMillis,
        verb: ACTIVITY_VERB[state] || 'Reserved',
      };
    });

  return rows.map((row, i) => ({
    ...row,
    repeatStall: i > 0 && rows[i - 1].stall === row.stall,
  }));
}

// ---- How to test ----
//   tierFor(0).label   // 'Kampong Newcomer'
//   tierFor(5).label   // 'Kampong Saver'
//   tierFor(99).label  // 'Kampong Legend'
//   nextTier(5).min    // 15
//   nextTier(99)       // null
//   computeImpact([{status:'collected', price:'$3.00', originalPriceCents:600}])
//     // rescued 1, spentCents 300, savedCents 300, co2Kg 2.5
