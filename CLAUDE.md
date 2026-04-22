# Meal Planner Co-Pilot — Claude Context

Handover doc for AI assistants (and humans) resuming work on this repo.
Last updated to reflect the current state after the sync-overwrite hardening and the Vercel/Claude proxy migration.

---

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind
- **Backend**: Firebase (Firestore + Auth). Optional Upstash Redis behind `api/storage/[key].js`.
- **AI**:
  - Weekly plan generation → **Claude Sonnet 4.6** via a Vercel serverless proxy (`api/generate-plan.js`). Uses `tool_use` for strict JSON output and ephemeral prompt caching on the system block.
  - Omnibox natural-language intent parsing → **still Gemini** (`@google/genai`) via `src/lib/geminiService.js`. Migration to Claude is a pending priority.
- **Deployment**: Vercel (production + preview branches). Production URL: `meal-planner-rho-eight.vercel.app`.

---

## Required Environment Variables

### Vercel (Production, Preview, Development)
| Var | Where it's used | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `api/generate-plan.js` (server-only) | Auth to Anthropic Messages API. **Never exposed to the browser.** |
| `VITE_GEMINI_API_KEY` | Omnibox intent parsing (browser) | Auth to Gemini for NL input. Exposed; rotate if leaked. |
| `VITE_FIREBASE_*` | `src/lib/firebase.js` | Firebase config. Has in-code fallbacks for local dev, but Vercel should set them explicitly. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (optional) | `api/storage/[key].js` | Only needed if Redis fallback is used. Currently dormant. |

### Local
Create `.env.local` with the same keys. `.env*` is gitignored.

### Firebase Admin (CLI scripts only, local machine)
`scripts/pushMealPlan.mjs` reads `./meal-planner-fa6ee-firebase-adminsdk-fbsvc-c136fcb9e0.json` (gitignored). Download from Firebase Console → Project Settings → Service accounts → **Generate new private key**.

---

## Core Architecture

### State Management
All centralized in `src/App.jsx` (`MealPlannerMain` component). Key state: `mealPlans`, `mealHistory`, `preferences`, `mealEvents`, `onboardingProfile`. `AppRoot` gates on Firebase auth before mounting the main component.

### Storage / Sync (read this before touching `storageGet` or `saveToStorage`)
LocalStorage-first with Firestore as the shared source of truth. Each key has a sibling `{key}__ts` ISO timestamp used for conflict resolution at boot.

**Invariants (learned the hard way — don't break these):**
1. **Never re-save on boot without a genuine change.** `loadStoredData` deliberately omits `saveToStorage('meal-plans', ...)` after read. Re-saving stamps a fresh `updatedAt` on unchanged data and races with other devices.
2. **Corrupt (future-dated) timestamps mean the VALUE is also untrustworthy.** If `updatedAt > now + 6h`, the source was poisoned (e.g. by a bad paste helper). The current `storageGet` discards that source's value entirely and heals from the other side. Do not "clamp" timestamps — that was a previous fix that resurrected stale values.
3. **Writes from the regen flow are awaited** before showing success. Without this, a fast refresh can beat the Firestore `setDoc`.

### Hybrid Generation Pipeline
1. **Phase 1 (deterministic)** — `src/lib/constraintFilter.js` filters the meal catalog against goal/macros/history. Produces per-date, per-slot shortlists. Deterministic, fast, free.
2. **Phase 2 (AI)** — `src/lib/planService.js` sends shortlists to `/api/generate-plan`. The proxy calls Claude with a `submit_weekly_plan` tool whose `input_schema` is the exact output shape we need. Claude cannot return free-form text in this path; the API enforces the schema.

### Meal Database
`src/data/mealDatabase.js`. Categories: `breakfast`, `lunchDinner`, `snack`. Each meal carries macros, `has_fibre`, `cuisine`, `meal_weight`, `goal_fit` tags used by the filter. Rebuild downstream artifacts with `npm run db:pack`.

---

## Known Gotchas (current, not stale)

| Area | Gotcha | Workaround / Reference |
| --- | --- | --- |
| **Claude structured output** | Sonnet 4.6 does **not** support assistant-message prefill (`"[":`). The only reliable way to force strict JSON is `tool_use` with `tool_choice: {type: 'tool', name}`. | See `SUBMIT_PLAN_TOOL` in `src/lib/planService.js` and `tool` handling in `api/generate-plan.js`. |
| **Vercel timeouts** | `api/generate-plan.js` declares `maxDuration: 60`. Hobby plan caps at 10s regardless — upgrade to Pro or the regen will 504. | Switch model to Haiku 4.5 for Hobby-grade responses under 10s. |
| **High-protein filter is strict** | Eliminates some viable Asian dishes lacking `has_fibre`. Partial fixes merged in `1b2141c` but not complete. | Audit `src/lib/constraintFilter.js` + meal metadata when adding new goals. |
| **Date keys + IST** | `getDateKey` uses `Asia/Kolkata`. Week boundaries are Monday-start. Don't mix with raw `toISOString()` slicing. | See `getWeekDateKeys` / `parseDateKey` in `App.jsx`. |
| **Pre-existing planner test failures** | 4 of 29 tests fail with `total protein out of range: 147` and a custom-meal-count assertion. These existed before the recent work. | Track as technical debt; tests 12, 25, 26, 27 in `tests/planner.regression.test.js`. |
| **Omnibox still on Gemini** | Uses `VITE_GEMINI_API_KEY` exposed in the browser. Small surface area but a real key leak. | Follow-up: migrate to Claude Haiku 4.5 via the same proxy. |

---

## Dev / Build / Deploy

```
npm install
npm run dev              # local dev (no serverless functions — use `vercel dev` for those)
npm run build            # production build
npm run test:logic       # all tests (expect 25/29 pass, 4 known failures)
npm run test:planner     # planner regression only
npm run db:pack          # regenerate database packs under database/ + exports/
```

Deploy happens on `git push origin main` (Vercel auto-deploys). Feature branches get preview URLs; Anthropic calls work on previews too as long as `ANTHROPIC_API_KEY` is set for the Preview environment.

---

## Scripts

| Script | Purpose | Requires |
| --- | --- | --- |
| `scripts/pushMealPlan.mjs` | Push a hand-curated plan directly to Firestore. | Firebase Admin service account JSON. |
| `scripts/generateConsolePaste.mjs` | Emits a browser-console snippet that writes the same plan via the signed-in browser session. | Nothing beyond `npm install`. **Preferred path** — no admin credentials needed. |
| `scripts/consolePaste.snippet.js` | Pre-generated latest snippet (checked in). | — |
| `scripts/buildDatabasePack.mjs` | Regenerate derived meal-database artifacts. | — |
| `scripts/exportDatabase.mjs` / `exportMealsToXlsx.mjs` | Export to CSV / XLSX. | — |

When hand-pushing plans: use `generateConsolePaste.mjs`, not `pushMealPlan.mjs`, unless you specifically need admin-SDK writes. The paste helper now uses **current** timestamps — never resurrect the +1-year trick.

---

## Recent Architectural Shifts

- **Priority 1 (sync/overwrite) — shipped.** `keysToEnsure` now skips `dateKey >= todayKey`; boot no longer re-saves meal-plans; regen awaits Firestore write; `storageGet` detects and heals corrupt future-dated timestamps on both local and Firestore. Paste helper uses current time.
- **Priority 2 (Vercel proxy) — shipped.** Weekly generation runs through `api/generate-plan.js` against Claude Sonnet 4.6. `tool_use` replaces the old JSON-prompting hack. Prompt caching active. API key server-only.
- **Auto-generation useEffect hooks — disabled** (still present but wrapped in `if (false)`). Keep them off unless you're redesigning the "plan pushed externally vs plan auto-generated" contract.

---

## Next Priorities (updated)

1. **Migrate Omnibox to Claude.** Currently the only remaining Gemini dependency. Use Haiku 4.5 via the same proxy (latency < 2s, cost ~1/10th of Sonnet). Removes the exposed `VITE_GEMINI_API_KEY` from the browser bundle.
2. **Switch timestamps to Firestore `serverTimestamp()`.** The current heal-on-read logic is defensive but brittle. Using server-assigned timestamps makes client-clock poisoning impossible and lets us delete the `isCorruptTs` / heal branches.
3. **IF (Intermittent Fasting) mode.** A `two_meals` goal filter already exists in `constraintFilter.js`. Surface it in onboarding so users can opt into 16/8 or 18/6 without overriding meals manually.
4. **Tag AI-generated plans** (`_aiGenerated: true`) so future dedup/cleanup logic can tell pushed/AI/manual plans apart.
5. **Fix the 4 failing planner regression tests.** "Total protein out of range: 147" suggests the planner's protein clamp isn't being enforced in some fixtures. Pre-existing.
6. **Database expansion.** More high-fibre, high-protein options — especially lighter breakfast alternatives compatible with IF's noon-eating start.
7. **Bundle size.** 980KB gzipped 240KB. Code-split Firebase + `@google/genai` (largest offenders).

---

## Quick File Map

```
api/
  generate-plan.js       Anthropic proxy (server-only API key)
  storage/[key].js       Optional Upstash Redis fallback
src/
  App.jsx                Main component — state, sync, effects, UI
  components/
    Omnibox.jsx          NL input (still on Gemini)
    AdminTools.jsx       Admin panel
    OnboardingFlow.jsx   First-run setup
  lib/
    planService.js       Client wrapper for /api/generate-plan (Claude)
    geminiService.js     Legacy weekly-gen + active Omnibox parser
    constraintFilter.js  Phase-1 deterministic filter
    plannerGenerator.js  Deterministic fallback plan builder
    mealEvents.js        Event log → preference derivation
    firebase.js          Firebase client init
  data/
    mealDatabase.js      Canonical meal list
    ingredients.js       Ingredient definitions
    fallbackPrompts.js   System-prompt templates (override via Firestore)
scripts/                 CLI helpers (see "Scripts" above)
tests/                   Node --test suite
```

---

## Working Notes for Future Sessions

- When in doubt, **develop on a feature branch** (`claude/<description>`), fast-forward `main` only after testing. Vercel auto-deploys `main`.
- The Anthropic API **bills failed requests** if Claude started generating. Don't iterate blindly — always inspect `console.error('[planService] proxy returned non-OK:', ...)` or Vercel function logs for the real Anthropic error body before trying another call.
- The `tool_use` path in `planService.js` returns `data.toolInput.days`; the legacy text-based path (not used) returned `data.text`. If you extend the proxy for other features (Omnibox, recipe generation), follow the tool_use pattern — it's strictly safer than prompt-engineered JSON.

---

## End of Session Learning Recap

When the user types the session recap commands, generate a session recap using this exact structure. 
Keep it brief, plain English, no jargon without explanation. 
The user is a non-technical founder learning by building — prioritize conceptual understanding over syntax.

**Scope: the current session only.** Recaps cover what happened in this single conversation / working session — not the entire project history, prior sessions, or the full chat backlog. If nothing meaningful happened in this session (e.g. a short Q&A), say so honestly rather than padding with older material.

## Session Recap Commands

### wrap and teach
Generate a structured session recap **for this session only** (not the whole project, not prior sessions). Plain English only — no jargon without a brief explanation. User is a non-technical founder learning by building.

**SESSION WRAP — [date]**

**What we built**
- [2–4 bullets: what actually shipped *this session*]

**Key concepts encountered**
- [concept]: [one plain-English sentence — what it is, why it matters]
- [repeat for 2–4 concepts max — only what was genuinely touched *this session*]

**One thing worth remembering**
- [Single most transferable insight from *this session*]

**Friction point** *(only if something broke or took unexpectedly long in this session)*
- [What it was and why]

---

### summarize learnings
3–5 bullet points covering **this session only** (not prior sessions, not the whole project). What was built, what was learned. One line each. No headers, no padding.
