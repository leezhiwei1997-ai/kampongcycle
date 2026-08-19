// src/utils/terms.js
//
// Terms & Community Guidelines copy, plus the version gate. Bump
// CURRENT_TERMS_VERSION whenever TERMS_TEXT changes materially — every
// signed-in account then gets re-prompted via TermsGateModal until they
// re-accept, and the new acceptance is written to users/{uid} and audited
// in users/{uid}/auditLog (see authService.js's acceptTerms/writeTermsAudit).
//
// Deliberately NOT checked against a specific value in firestore.rules —
// the rules only validate the SHAPE (a real, non-empty string was
// recorded), so this file is the one place "current" is decided, and
// changing it never needs a rules deploy.

export const CURRENT_TERMS_VERSION = '2026-08-19';

export const TERMS_TEXT = `KampongCycle connects hawker stalls with surplus food to nearby customers. Please read before continuing:

1. No money changes hands in this app. Payment is cash or PayNow, directly between you and the stall, at pickup. KampongCycle does not process, hold, or refund payments.

2. A reservation is a promise to show up. Repeated no-shows may temporarily cool down your account from reserving again — this protects stalls from portions held for people who never collect them.

3. Pickup windows are set by the stall and are final once they close. If something goes wrong — the stall ran out, you couldn't make it, or the handover didn't go as expected — use the in-app dispute or cancel options rather than a chargeback, since none exists here.

4. Be respectful in messages with stalls and other customers. Threats, harassment, or fraud will get an account removed.

5. Stalls are responsible for the accuracy of their own listings (price, quantity, pickup window, dietary claims). KampongCycle does not inspect food safety or verify claims beyond checking that a stall account is real.

By continuing, you agree to these terms and to the community guidelines above.`;

export function hasAcceptedCurrentTerms(user) {
  return !!user
    && user.agreedToTerms === true
    && user.termsVersion === CURRENT_TERMS_VERSION;
}
