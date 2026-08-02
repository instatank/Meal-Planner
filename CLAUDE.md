# Meal Planner Co-Pilot — Claude Context

Handover doc for AI assistants (and humans) resuming work on this repo.
Last updated to reflect the current state after the sync-overwrite hardening and the Vercel/Claude proxy migration.

---

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind
- **Backend**: Firebase (Firestore + Auth). Optional Upstash Redis behind `api/storage/[key].js`.
- **AI**:
  - Weekly plan generation → **Claude Sonnet 5** via a Vercel serverless proxy (`api/generate-plan.js`). Uses `tool_use` with per-slot `enum`s for strict output, `output_config.effort` as the quality/cost dial, and ephemeral prompt caching on the system block. **No sampling parameters** — Sonnet 5 rejects `temperature`/`top_p`/`top_k` with a 400.
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

### The rule model — read this before changing any threshold

**Aim daily, judge weekly.** Every day is *targeted* at the daily protein goal, but a week is accepted or rejected on weekly performance. Up to 2 of 7 days may fall out of band, and those flex days are allowed to be genuinely low — there is no meaningful per-day protein floor beyond a 50g sanity check. What keeps the week sound is the **weekly protein floor** (85% of nominal), which forces the other five days to compensate.

Rules live in **`src/lib/rules.js` and nowhere else**, split into three tiers:

| Tier | Meaning | Examples |
| --- | --- | --- |
| **1 — Hard** | Never violate; a plan containing one is invalid | per-meal protein floor (20g), no meal twice in a day, weekly repeat ceilings (breakfast ≤4, lunch/dinner ≤2), red-meat cap (3/wk), avoid score > 3, weekly protein ≥ 785g, 50g/day sanity floor |
| **2 — Budgeted** | Allowed to break on ≤2 of 7 days | daily protein band (119–145g), carb cap (130g), calorie bounds (1600–2200) |
| **3 — Scored** | Never rejects; only ranks | variety, cuisine diversity, protein-family diversity, fibre, dinner calorie tapering, user preferences, anti-greedy |

Budgets **pro-rate** for partial-week regenerations: a 4-day remainder gets 1 flex day and a 449g floor, not the full week's allowance.

`getRules` throws `UnsupportedGoalError` for goals onboarding declares but nobody built (`low_carb`, `two_meals`, `vegetarian`). It no longer silently becomes `high_protein` — that is how a vegetarian used to get a week of chicken.

### Hybrid Generation Pipeline
1. **Phase 1 (deterministic)** — `src/lib/planOptimizer.js` enumerates *every* Tier-1-legal breakfast/lunch/dinner combination (3,250 for the current catalog, ~250ms), scores each against Tiers 2 and 3, and beam-searches a week that satisfies the Tier-2 budgets by construction. Produces both a reference week and the per-date, per-slot shortlists.
2. **Phase 2 (AI)** — `src/lib/planService.js` sends shortlists to `/api/generate-plan`. The `submit_weekly_plan` tool is built per request with a **per-day, per-slot `enum`** of legal meal names, so a hallucinated name is structurally impossible. The plan is keyed by date, not an array, because JSON Schema applies one `items` schema to every array element and that would collapse seven days into one shared enum.
3. **Phase 3 (validation)** — `src/lib/planValidator.js` checks the returned week against all three tiers and repairs it deterministically if needed: first replacing only the days with Tier-1 violations, then rebuilding the whole run. Nothing invalid is ever written silently; if even the optimizer cannot satisfy the rules it returns `catalogInfeasible`.

Re-measure any of this with `npm run audit:generation` — it enumerates rather than estimates and exits non-zero if an acceptance criterion fails.

### Meal Database
`src/data/mealDatabase.js`. Categories: `breakfast`, `lunchDinner`, `snack`. Each meal carries macros, `has_fibre`, `cuisine`, `meal_weight` and `goal_fit` tags. Note that `meal_weight` is now only a display/reporting label — the optimizer tapers dinner by calories, not by this tag. Rebuild downstream artifacts with `npm run db:pack`.

---

## Known Gotchas (current, not stale)

| Area | Gotcha | Workaround / Reference |
| --- | --- | --- |
| **Claude structured output** | Prefill (`"[":`) is not a reliable way to force JSON. Use `tool_use` with `tool_choice: {type: 'tool', name}`. | See `buildSubmitPlanTool` in `src/lib/planService.js` and `tool` handling in `api/generate-plan.js`. |
| **Vercel timeouts** | `api/generate-plan.js` declares `maxDuration: 60`. Hobby plan caps at 10s regardless — upgrade to Pro or the regen will 504. | The proxy runs at `effort: 'low'` to stay inside the cap. Lower it further before reaching for a smaller model. |
| **The calorie floor is the binding budget** | Only 19.6% of legal day combinations reach 1600 kcal, and just 0.9% satisfy all three Tier-2 budgets at once. The week still validates, but there is very little slack. | Phase 2 catalog expansion. Measure with `npm run audit:generation`. |
| **Only 5 legal breakfasts for 7 days** | The 20g per-meal floor leaves 5 of 7 breakfasts, best 37g. This caps every day and is why the weekly floor sits at 85% rather than higher. | Phase 2: high-protein breakfasts are the single highest-leverage addition. |
| **Sampling parameters** | Sonnet 5 returns a 400 for any non-default `temperature`/`top_p`/`top_k`. A model swap without removing them breaks the endpoint outright. | `buildAnthropicRequest` in `api/generate-plan.js` strips them defensively, so a stale cached client bundle degrades instead of breaking. |
| **Thinking shares `max_tokens`** | Adaptive thinking is on by default on Sonnet 5 and counts against `max_tokens`. A budget sized for the response alone truncates mid-answer. | `DEFAULT_MAX_TOKENS` is 8192 for a response that is only a few enum picks. |
| **Sonnet 5 tokenizer** | ~30% more tokens for the same text than Sonnet 4.6, so cost baselines shift even though per-token pricing did not. | Re-baseline before reacting to the numbers. Also note prompt caching needs a 1024-token prefix; a short system prompt silently will not cache. |
| **Date keys + IST** | `getDateKey` uses `Asia/Kolkata`. Week boundaries are Monday-start. Don't mix with raw `toISOString()` slicing. | See `getWeekDateKeys` / `parseDateKey` in `App.jsx`. |
| **Omnibox still on Gemini** | Uses `VITE_GEMINI_API_KEY` exposed in the browser. Small surface area but a real key leak. | Follow-up: migrate to Claude Haiku 4.5 via the same proxy. |

---

## Dev / Build / Deploy

```
npm install
npm run dev              # local dev (no serverless functions — use `vercel dev` for those)
npm run build            # production build
npm run test:logic       # all tests (94, all green)
npm run test:planner     # planner regression only
npm run audit:generation # enumerate combinations + score a week against the acceptance criteria
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
| `scripts/auditGeneration.mjs` | Enumerate all legal day combinations and score a generated week against the Phase 1 acceptance criteria. | — |
| `scripts/exportDatabase.mjs` / `exportMealsToXlsx.mjs` | Export to CSV / XLSX. | — |

When hand-pushing plans: use `generateConsolePaste.mjs`, not `pushMealPlan.mjs`, unless you specifically need admin-SDK writes. The paste helper now uses **current** timestamps — never resurrect the +1-year trick.

---

## Recent Architectural Shifts

- **Priority 1 (sync/overwrite) — shipped.** `keysToEnsure` now skips `dateKey >= todayKey`; boot no longer re-saves meal-plans; regen awaits Firestore write; `storageGet` detects and heals corrupt future-dated timestamps on both local and Firestore. Paste helper uses current time.
- **Priority 2 (Vercel proxy) — shipped.** Weekly generation runs through `api/generate-plan.js`. `tool_use` replaces the old JSON-prompting hack. Prompt caching active. API key server-only.
- **Phase 1 (generation engine rebuild) — shipped.** The three-tier rule model in `rules.js`; `constraintFilter.js` deleted and replaced by the `planOptimizer.js` day/week search; `planValidator.js` added; tool schema constrained with per-slot enums; prompts rewritten to state real numbers and stop claiming constraints were pre-verified; the hard dinner taper replaced by calorie-based scoring. See `docs/PHASE1_HANDOVER.md`.
- **Auto-generation useEffect hooks — disabled** (still present but wrapped in `if (false)`). Keep them off unless you're redesigning the "plan pushed externally vs plan auto-generated" contract.

---

## Next Priorities (updated)

0. **Phase 2 — repair and expand the database.** Phase 1 made the rules real; the catalog is now the binding constraint. In priority order: high-protein breakfasts (5 legal options for 7 days), derive `is_fat_heavy` / `has_fibre` / `meal_weight` from ingredients instead of the hand-typed `csvTagsMap` (12, 11 and 3 disagreements respectively), fibre in grams, then expansion toward ~120 meals. See `docs/EVAL_AND_ROADMAP.md` §4.
1. **Migrate Omnibox to Claude.** Currently the only remaining Gemini dependency. Use Haiku 4.5 via the same proxy (latency < 2s, cost ~1/10th of Sonnet). Removes the exposed `VITE_GEMINI_API_KEY` from the browser bundle.
2. **Switch timestamps to Firestore `serverTimestamp()`.** The current heal-on-read logic is defensive but brittle. Using server-assigned timestamps makes client-clock poisoning impossible and lets us delete the `isCorruptTs` / heal branches.
3. **IF (Intermittent Fasting) mode.** `two_meals` is declared in onboarding and reconciled in `rules.js`, but has no ruleset — `getRules` throws for it by design. Give it real Tier-1/2/3 definitions and surface it so users can opt into 16/8 or 18/6 without overriding meals manually.
4. **Tag AI-generated plans** (`_aiGenerated: true`) so future dedup/cleanup logic can tell pushed/AI/manual plans apart.
5. **Raise the weekly protein floor above 85%** once the catalog grows. A generated week currently clears the 785g floor by ~100g (885g, 95.8% of nominal), but that is with almost no slack on the calorie budget — the headroom is real, the margin is not.
6. **Bundle size.** 980KB gzipped 240KB. Code-split Firebase + `@google/genai` (largest offenders).

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
    rules.js             SINGLE SOURCE OF TRUTH for every threshold (3 tiers)
    planOptimizer.js     Day enumeration + week beam search + shortlists
    planValidator.js     Post-generation validation + deterministic repair
    planService.js       Client wrapper for /api/generate-plan (Claude)
    geminiService.js     Legacy weekly-gen + active Omnibox parser
    plannerGenerator.js  Single-day generator (facade over planOptimizer)
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
