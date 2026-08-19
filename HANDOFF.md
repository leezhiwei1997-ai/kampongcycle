# KampongCycle — Handoff Brief

Read this first. It describes where the repo stands and what to rebuild.

## Repo state (as of 20 Aug 2026)

- Repo: `leezhiwei1997-ai/kampongcycle`, single branch `main`
- `main` HEAD: `4a9c308` "Discover card: aspect-ratio image, badge placement, cleanup"
- Working tree is clean and up to date with `origin/main`
- Context: the previous codespace ("friendly umbrella") was deleted while the
  GitHub account was suspended. Work committed before `4a9c308` survived.
  Work after it did not.

## Stack (what the repo actually is, not what the docs claim)

`CLAUDE.md` and `ROADMAP.md` describe TypeScript strict, React Navigation and
Zustand. **All three are wrong.** The repo is:

- Plain JavaScript — `App.js` + `index.js`, no `app/` dir, no Expo Router
- Routing is a `Router()` function in `App.js` doing conditional rendering
  (Login / Admin / Merchant / Customer) inside `PaperProvider > AuthProvider`
- Auth state in an `AuthProvider` context, not Zustand. No store exists.
- Navigation is React Native Paper `BottomNavigation`
- Firebase (Auth, Firestore, Storage); config from `EXPO_PUBLIC_*` env vars
- Firestore collections: `users`, `deals`, `reservations`, `ratings`, `follows`
- `deals` / `reservations` are keyed by `merchantEmail`, not merchant uid

## STEP 1 — Verify before rebuilding

Run these and report the output before writing any code:

```bash
ls src/theme/
ls src/components/
ls src/utils/
grep -n "approveMerchant\|revokeMerchant" src/services/authService.js
grep -rn "tokens" src/components/SwipeDealCard.js | head
ls ROADMAP.md 2>/dev/null || echo "ROADMAP.md missing"
```

## STEP 2 — Confirmed missing, rebuild these

### A. `src/utils/hours.js` + `src/components/StoreSetup.js` (store setup)

Merchant sets a stall name and per-weekday operating hours; customers see
open/closed on the Discover feed, Grab-style.

- `hours.js`: pure functions over a per-weekday shape
  `{ closed: bool, open: "HH:MM", close: "HH:MM" }`. Must handle windows that
  cross midnight (supper stalls). Exports `stallStatus`, `nextOpening`,
  `validateHours`. Local time vs device clock — single-city assumption.
- `StoreSetup.js`: lives in the **merchant Profile tab**.
- `authService.updateStoreProfile` writes `stallName`, `hours`, `pausedUntil`
  only. Do NOT touch `role` or `verified` — no firestore.rules change needed.
- `appDataService.attachStoreProfiles` reads hours LIVE per distinct merchant
  on the customer feed.
- `SwipeDealCard` shows "● Open until 8:00 PM" / "○ Closed · opens ..." and
  **disables Reserve when the stall is shut**.
- Stall name becomes a stored merchant property, read-only on the publish form
  (it used to be local state retyped every session).

### B. `approveMerchant` / `revokeMerchant` in `src/services/authService.js`

`AdminScreen.js` has always imported `approveMerchant`, but `authService`
never exported it. The Approve button throws "not a function", so no merchant
can be verified, so none can publish (`isVerifiedMerchant` gates deal creation).

**This is the highest-priority fix — the app is unusable for merchants without it.**

Both functions must write ONLY the `verified` field. The admin firestore rule
is `hasOnly(['verified'])` and will reject anything wider.

### C. `src/components/ProfilePanel.js` (Profile rebuild)

White container component wrapping Following and Recent activity. Part of the
Profile rebuild: three-across `ProfileStats` in one bordered card, tier badge
as a pill chip, neutral activity dots, outlined pill Log Out, notification bell
opening a Recent activity dialog (explicitly NOT a notification centre).

## STEP 3 — Verify only if STEP 1 shows them missing

### D. `src/theme/tokens.js` (design system)

Transcribes the supplied DESIGN.md:

- Canvas / nav lavender `#fef7ff`; cards WHITE (surface-container-lowest) with soft shadow
- Primary green `#0c6b24`
- Type scale: headline-md 22 / stat-number 28 / body-md 14 / label-md-bold 12
- Radius 8 small, 16 large, pill for chips and Reserve
- Shared `CARD` token: radius 24, 1px `#e3e6e3` border, 16 padding — used by
  Discover, My Orders and Profile so containers can't drift
- `paperTheme` must override `colors.elevation` to white and set
  `surfaceTint` transparent. The purple wash was MD3's elevation tint, not the
  theme surface colour.
- Fonts (Plus Jakarta Sans, Inter) are NOT loaded — sizes/weights only.

### E. Scroll / header fix

`BottomNavigation` renders OVER the scroll views, so Log Out (Profile) and the
last order card (My Orders) were unreachable. Add `paddingBottom: 120` to both
content containers. Header strip must be `<Surface elevation={0}>` with the
background colour — `elevation={1}` resolves to white via the theme override
and breaks the continuous lavender canvas.

### F. Final `SwipeDealCard` image sizing

Do NOT use `aspectRatio` + `flexShrink` — they do not cooperate in Yoga; the
ratio wins, the image keeps full height, and `overflow: hidden` clips the body.

Correct approach: measure deck space via `onLayout`, measure body height via
`Card.Content` `onLayout`, then `imageHeight = available - body`, clamped
between 90 and a 16:10 box. Settles in one extra render, no flex rules.

## Known traps

- `node --check` **cannot parse JSX**. Syntax checks are blind to JSX errors.
  Also scan for `{/* comment */}` in expression position — inside
  `{cond && ( ... )}` the `{` opens an object literal and it's a syntax error.
- Firestore user docs have `role` values with trailing newlines
  (`"customer\n\n"`) from console paste. `email` is likely mangled the same way
  and it's the `merchantEmail` key.
- `deals` store only `collectByTimestamp` (window END). There is no pickup
  window START in the schema.
- `deal.price` is a display string ("$3.50") from `toMoney()`.
- New deps already in use: `expo-camera`, `react-native-qrcode-svg`,
  `react-native-svg`.

## Working style

- Show only changed files
- Ask one clarifying question when genuinely ambiguous
- Surface the riskiest assumption proactively
- `MerchantScreen.js` and `CustomerScreen.js` are far over the 120-line rule
  in `CLAUDE.md` — don't make them worse
