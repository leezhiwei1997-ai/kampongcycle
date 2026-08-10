# Reservation lifecycle patch — order IDs, QR pickup, fault attribution, day grouping

Apply on top of the earnings + archive patches.

| File | Status |
|---|---|
| `src/utils/reservations.js` | new — lifecycle + order IDs + day grouping, pure |
| `src/components/PickupQrCode.js` | new — customer's QR |
| `src/components/ScanToCollect.js` | new — merchant's scanner |
| `src/utils/earnings.js` | replaces yours |
| `src/services/appDataService.js` | replaces yours |
| `src/screens/MerchantScreen.js` | replaces yours |
| `src/screens/CustomerScreen.js` | replaces yours |
| `firestore.rules` | replaces yours — **must be deployed** |

## STEP 1 — install two dependencies FIRST

This is a stack change, so flagging it rather than assuming: the QR needs
libraries. **Do this before starting Metro or the bundle will fail on a
missing module** — a `try/catch` around the import wouldn't help, Metro
resolves at build time.

```bash
cd /workspaces/kampongcycle
npx expo install expo-camera react-native-qrcode-svg react-native-svg
```

All three work in Expo Go. If you'd rather not add them, say so and I'll ship
a code-only version — the order code alone is typed in about four seconds.

## STEP 2 — unzip

```bash
cd /workspaces/kampongcycle
unzip -o kampongcycle-reservations.zip -d .
```

## STEP 3 — check it landed

```bash
git status --short
```

Expect: `M firestore.rules`, `M src/screens/CustomerScreen.js`,
`M src/screens/MerchantScreen.js`, `M src/services/appDataService.js`,
`M src/utils/earnings.js`, and three `??` new files under `src/`.

## STEP 4 — check the code changed

```bash
grep -n "makeOrderId" src/services/appDataService.js      # want 2 lines
grep -n "groupByDay" src/screens/MerchantScreen.js        # want 2 lines
grep -n "PickupQrCode" src/screens/CustomerScreen.js      # want 2 lines
grep -n "resolvedAt" firestore.rules                      # want 2 lines
grep -c "merchantFault" src/utils/earnings.js             # want 3
```

## STEP 5 — deploy the rules

```bash
firebase deploy --only firestore:rules
```

Or paste `firestore.rules` into Firebase Console → Firestore → Rules →
Publish. **Without this, fault attribution fails with permission-denied** —
`resolvedAt` isn't in your deployed allowlist yet.

## STEP 6 — run

```bash
pkill -f "expo start"
npx expo start --tunnel -c
```

Swipe Expo Go fully closed, reopen, enter the fresh `exp://...exp.direct` URL.

## STEP 7 — test

| Do | Expect |
|---|---|
| Reserve something as a customer | Order card shows a code like `KC-260811-7F4Q` and a **Show pickup code** button |
| Tap it | QR plus the code in text underneath |
| Merchant → Reservations → **Scan pickup code** | Camera opens; scan the customer's QR |
| — | Order flips to Collected on both sides, customer gets a push |
| Type the code manually instead | Same result |
| Scan the same code twice | "That order was already collected." — sheet stays open |
| Let a pickup window pass on an uncollected order | Card turns outlined: "Expired — what happened?" with three buttons |
| Tap **Customer no-show** | Closes out; fulfilment rate unaffected |
| Tap **We ran out** | Closes out; fulfilment rate drops |

Reservations are now grouped by day, newest first, each header showing
`Today · 3/5 collected`.

## Design notes

**Expiry is derived, fault is stored.** The app can tell a pickup window
passed with food uncollected. It cannot tell whether the customer failed to
show or the stall ran out — that's a human judgement, so it's written down
rather than guessed. `classifyReservation` returns `needsReview` for the gap
between the two.

**No-shows don't count against the merchant.** Fulfilment is now
`collected / (collected + merchant shortfall + unresolved)`. Penalising a
stall because a customer didn't turn up would make the number something to
resent instead of act on. Unresolved expiries DO count, otherwise never
attributing anything would pin the rate at 100% forever. A separate
`noShowRate` tracks customer behaviour.

**The order code is always shown as text.** Hawker centres are bright, screens
crack, batteries die. When the scan fails the merchant types four characters
and the queue keeps moving.

**Order codes aren't globally unique.** `KC-YYMMDD-XXXX` gives about a million
combinations per day — ample at this volume, but a birthday-problem gamble,
not a guarantee. The Firestore document ID is still the real key; lookup
fetches up to 5 matches and filters by merchant.

**Existing reservations have no `orderId`.** They fall back to displaying the
document ID and can still be collected with the button. Only new reservations
get scannable codes.
