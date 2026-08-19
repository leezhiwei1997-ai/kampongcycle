// src/utils/permissions.js
//
// Client-side mirror of the role/ownership checks in firestore.rules. These
// gate UI ONLY — the rules are the real enforcement (a user could always
// bypass this file and call the SDK directly). Pure functions, no React, no
// Firestore, same style as utils/reservations.js.

export function isOwner(user) {
  return user?.role === 'owner';
}

export function isStaff(user) {
  return user?.role === 'staff';
}

export function isCustomer(user) {
  return user?.role === 'customer';
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

/**
 * The email deals/reservations for this account should be scoped by.
 * Staff act on their assigned owner's behalf — every deal/reservation a
 * staff member touches is keyed by the OWNER's email, never their own (see
 * isStallMember() in firestore.rules).
 */
export function stallEmailFor(user) {
  if (isStaff(user)) return user.assignedOwnerEmail || null;
  return user?.email || null;
}

/**
 * Earnings and bank details are the owner's business finances — staff, even
 * active ones in good standing, never see them. Matches the NOTE in
 * firestore.rules reserved for when earnings/bank data moves server-side.
 */
export function canViewEarnings(user) {
  return isOwner(user);
}

export function canEditBank(user) {
  return isOwner(user);
}

export function canManageStalls(user) {
  return isOwner(user);
}

export function canManageStaff(user) {
  return isOwner(user);
}

/** Anti-griefing cooldown — blocks new reservations, not existing ones. */
export function isInNoShowCooldown(user, now = Date.now()) {
  const until = user?.cooldownUntil;
  return Number.isFinite(until) && now < until;
}
