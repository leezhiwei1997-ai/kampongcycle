// src/utils/listings.js
//
// Listing lifecycle, derived rather than stored.
//
// There is no backend and no Cloud Functions, so nothing can run on a timer
// to flip an "expired" flag at the moment a pickup window closes. Anything
// written by a client would be wrong until that client next happened to open
// the app. So the state is computed from data the listing already carries:
// `quantity` and `collectByTimestamp`. Zero writes, always correct, and it
// works offline.

/** Legacy listings predate the quantity field; the UI has always treated those as 1. */
export function portionsLeft(deal) {
  return Number.isFinite(deal?.quantity) ? deal.quantity : 1;
}

export function isExpired(deal, now = Date.now()) {
  return Number.isFinite(deal?.collectByTimestamp) && now > deal.collectByTimestamp;
}

/** 'active' | 'soldOut' | 'expired' */
export function classifyListing(deal, now = Date.now()) {
  if (portionsLeft(deal) <= 0) return 'soldOut';
  if (isExpired(deal, now)) return 'expired';
  return 'active';
}

/** Should this appear in the customer browse feed? */
export function isListable(deal, now = Date.now()) {
  return classifyListing(deal, now) === 'active';
}

/** Splits a merchant's listings into what's live and what's done. */
export function splitListings(deals = [], now = Date.now()) {
  const active = [];
  const archived = [];
  deals.forEach((d) => {
    if (classifyListing(d, now) === 'active') active.push(d);
    else archived.push(d);
  });
  return { active, archived };
}

/** Short label for why a listing is in the archived pile. */
export function archiveReason(deal, now = Date.now()) {
  return classifyListing(deal, now) === 'soldOut' ? 'Sold out' : 'Window closed';
}

// ---- How to test ----
//
//   const NOW = Date.now();
//   classifyListing({ quantity: 2, collectByTimestamp: NOW + 60000 }, NOW) // 'active'
//   classifyListing({ quantity: 0, collectByTimestamp: NOW + 60000 }, NOW) // 'soldOut'
//   classifyListing({ quantity: 2, collectByTimestamp: NOW - 60000 }, NOW) // 'expired'
//   classifyListing({ quantity: 0, collectByTimestamp: NOW - 60000 }, NOW) // 'soldOut' (sold out wins)
//   classifyListing({ collectByTimestamp: NOW + 60000 }, NOW)             // 'active' (legacy, no quantity)
