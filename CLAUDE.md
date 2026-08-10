# CLAUDE.md — Project Brief for AI Coding Assistant

You are helping me build a cross-platform mobile app (iOS + Android) using **Expo Go**.  
Read this file first on every session. Follow the conventions below exactly.

---

## 1. Tech Stack (do not deviate without asking)

- **Expo (Expo Go)** + **React Native**, written in **TypeScript (strict mode)**
- **React Native Paper** for UI components and theming (Material Design)
- **React Navigation** (stack + bottom-tab navigators) for routing
- **Firebase** for backend:
  - Firebase Auth (email/password + Anonymous as fallback)
  - Cloud Firestore (primary database)
  - Firebase Storage (listing photos)
  - (optional later) Cloud Messaging for push
- **Zustand** for lightweight client-side state
- **TanStack Query (React Query)** for server state / Firestore fetching & caching

## 2. What This App Is

A **hawker / street-food surplus marketplace**. Merchants photograph leftover  
food, set a price + pickup window, and list it. Customers browse, reserve, and  
collect. The merchant side has **3 core screens**:

1. **Listings** — create ("Snap & List" photo flow), view, edit, remove listings
2. **Reservations** — incoming customer reservations with pickup codes
3. **Profile** — merchant info, verification, followers, ratings, settings

The hero action is **"Snap & List"**: take a photo → set price + portions +  
pickup window → post.

## 3. Project Structure Conventions

```
app/ or src/
  navigation/        # React Navigation stacks & tabs
  screens/merchant/  # Listings, Reservations, Profile screens
  components/merchant/# Reusable merchant UI (ReservationCard, ListingCard, etc.)
  store/             # Zustand stores
  lib/firebase.ts    # Firebase init + exports
  lib/mockData.ts    # Mock data so it runs in Expo Go WITHOUT a backend
  types/             # TypeScript types for Listing, Reservation, Merchant, etc.
```

Rules:

- One screen = one file.
- Components stay small (< 120 lines). Split if larger.
- Always define a TypeScript **type/interface** for every data model before use.
- Use mock data with a clear `// TODO: replace with Firestore` comment so the  
  app runs immediately in Expo Go without Firebase configured.
- Keep pure logic (reducers, calculators) separate from UI so it's testable.

## 4. Coding Style

- TypeScript strict mode. No `any` unless unavoidable (then comment why).
- Explain *why* you chose an approach in 1–2 lines, then show the code.
- Prefer small, composable components over large monoliths.
- Use React Native Paper components (Appbar, Card, Button, FAB, Dialog,  
  Snackbar, Badge) — don't hand-roll Material UI.
- Use React Navigation's themed props; don't hardcode navigation logic in screens.
- Don't use deprecated Expo APIs. Target **Expo SDK 51+**.

## 5. Known Improvement Backlog (priorities)

When I ask for "the next feature," pull from this list in order:

1. **Earnings dashboard** (Today / Week / Month revenue, meals-saved breakdown,  
   top-3 dishes). Merchants churn without a money view.
2. **Auto-decrement portions + auto-archive** expired/sold-out listings.
3. **Push notifications** for new reservations (expo-notifications + FCM).
4. Better reservation cards: add **quantity + pickup code + customer notes**.
5. Replace destructive "Remove" with confirm Dialog inside Edit sheet.
6. Notification bell in top bar with unread badge.
7. Recurring listings (days-of-week + time → draft next 4 weeks).
8. i18n (English, Simplified Chinese, Malay, Tamil) via expo-localization.
9. Multi-stall support, hours of operation, holiday toggle.

## 6. How to Work With Me

- If anything is ambiguous, **stop and ask 1 clarifying question** before coding.
- Show only **changed files**, not the whole project, unless I ask for full context.
- For stores/reducers, include a quick test or note how to test the pure logic.
- Before finalizing, ask: *"Is this the simplest version that runs in Expo Go  
  today?"* If not, simplify.
- Surface the **riskiest assumption** (permissions, Firestore rules, platform  
  quirks) proactively.

## 7. Runtime Reality

I run the app myself: `npx expo start` → scan QR in Expo Go.  
You cannot see my runtime. If something breaks, I will paste the **red error  
text** from the terminal or Expo overlay — treat that as the source of truth.
