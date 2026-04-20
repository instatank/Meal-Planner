# Meal Planner Co-Pilot - Claude Context

This file provides comprehensive context for modifying and extending the Meal Planner application.

## Tech Stack
- **Frontend**: React, Vite, Tailwind CSS
- **Database / Backend**: Firebase (Firestore for data storage, Authentication)
- **AI Integration**: Claude API (for meal generation), previously Gemini. 
- **Deployment**: Vercel

## Core Architecture
- **State Management**: Heavily centralized in `App.jsx` using React hooks. State includes `mealPlans`, `mealHistory`, `preferences`, `mealEvents`.
- **Data Sync**: Uses a LocalStorage-first approach with Firebase background sync. `storageGet` and `saveToStorage` handle reading/writing and resolve cache vs. remote conflicts using timestamps (`__ts`).
- **Meal Database**: Located in `src/data/mealDatabase.js`. Contains meals categorized by `breakfast`, `lunchDinner`, and `snack`, enriched with metadata (`calories_kcal`, `protein_g`, `has_fibre`, `cuisine`, tags).
- **Hybrid Generation Pipeline**:
  - **Phase 1 (Deterministic)**: `src/lib/constraintFilter.js` strictly filters the meal catalog based on goals, macros, and history (ensures no repeat meals, meets protein targets).
  - **Phase 2 (AI AI)**: An LLM selects the most appetizing combinations from the filtered shortlists.

## Recent Architectural Decisions & Changes
- **Migration to Claude**: Switched from Gemini to Claude (Anthropic) for vastly superior output quality and variety.
- **Auto-Generation Disabled**: The `useEffect` hooks responsible for autonomously generating meal plans at the turn of the week in `App.jsx` have been disabled. This prevents the app from silently overwriting manually pushed/curated plans.
- **Aggressive Overwrite Fix**: Fixed a bug where `keysToEnsure` `useEffect` in `App.jsx` was replacing pushed plans if it detected adjacent days had identical meals (legacy clone check). It now strictly only fills in *truly empty* days.
- **Direct Firestore Injection**: Created `scripts/pushMealPlan.mjs` and `scripts/generateConsolePaste.mjs` to bypass client-side generation and push Claude-generated JSON directly into Firestore or LocalStorage. 
- **Firebase Auth SDK**: Migrated hardcoded Firebase config to Vite Environment Variables (`VITE_FIREBASE_*`) with local fallbacks.

## Known Issues & Gotchas
- **Data Sync Race Conditions**: LocalStorage cache often conflicts with or overwrites Firebase data. The app generates local fallback plans for empty days on boot; if this happens before Firebase data loads, it writes the fallback to Firebase with a fresh timestamp, destroying the actual remote data.
- **Date/Time Boundary Issues**: Discrepancies between Monday/Sunday start strings and timezone offsets have caused generated plans to map to the wrong day or get overwritten at the start of the week.
- **Aggressive Constraints**: The High-Protein goal filter in `constraintFilter.js` is overly aggressive. It eliminates many viable Asian chicken meals (pho, pad krapow) because they lack the required `has_fibre` metadata tag.

## Next Development Priorities

1. **Fix Persistent Sync/Overwrite Bug**: 
   - Ensure the High-Protein plan pushed via the CLI script actually *persists* in the UI across page reloads without getting overwritten by the local generator.
   - Investigate the `keysToEnsure` and Auto-Confirmation effects in `App.jsx` to stop them from touching future dates (`dateKey >= todayKey`).
2. **Vercel Serverless Proxy (`api/generate-plan.js`)**:
   - Implement the Vercel serverless function to proxy requests securely to the Anthropic API (hiding the API key).
   - Hook up the frontend "Generate Week" button to point to this new proxy instead of the legacy `geminiService.js`.
3. **Audit Implementation Tasks**:
   - Tag AI-generated meal plans with an `_aiGenerated: true` flag to prevent local deduplication logic from wiping them.
4. **Database Expansion**:
   - Add more high-fibre, high-protein Continental/Asian options to `mealDatabase.js` to improve AI selection variety when the High-Protein goal is active.
