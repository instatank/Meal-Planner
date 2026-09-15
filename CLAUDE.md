# Meal Planner Co-Pilot — Claude Context

Handover doc for AI assistants (and humans) resuming work on this repo.
Last updated after the consistency audit (`docs/CONSISTENCY_AUDIT.md`) and the first four fixes from it — goal routing, the protein target, cuisine, and meal-event capture.

---

## Working environment (read before giving instructions)

This repo is built entirely in Claude Code cloud sessions — there is no local checkout, no local terminal, and no local dev environment for the founder. **Never hand him `cd` / `git clone` / `npm install` / `./script.sh` steps to run on his machine** — anything that must execute runs in the agent's own container, or in the deployed app.

- **Egress is allowlisted.** A host can fail with "Host not in allowlist" — that means blocked, not down. Say so and propose another route.
- **No secrets store here** (Anthropic's own docs say not to put API keys in Claude Code cloud env vars). Secrets live in Vercel's env vars — never ask the founder to paste one into chat or a local file.
- **Blocked host or needs real credentials?** Build it as a route in the deployed app and hand over a URL to open — not a script to run.
- **Steps the founder performs are browser/dashboard steps** — name the site, the menu, the button.

---

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind
- **Backend**: Firebase (Firestore + Auth). Optional Upstash Redis behind `api/storage/[key].js`.
- **AI**:
  - Weekly plan generation → **Claude Sonnet 5** via a Vercel serverless proxy (`api/generate-plan.js`). Uses `tool_use` with per-slot `enum`s for strict output, `output_config.effort` as the quality/cost dial, and ephemeral prompt caching on the system block. **No sampling parameters** — Sonnet 5 rejects `temperature`/`top_p`/`top_k` with a 400.
  - Omnibox natural-language intent parsing → **also Claude Sonnet 5**, same proxy, via `src/lib/omniboxService.js` (`submit_meal_intent` tool). Gemini (`@google/genai`, `geminiService.js`) has been fully removed — no more client-exposed AI key.
- **Deployment**: Vercel (production + preview branches). Production URL: `meal-planner-rho-eight.vercel.app`.

---

## Required Environment Variables

### Vercel (Production, Preview, Development)
| Var | Where it's used | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `api/generate-plan.js` (server-only) | Auth to Anthropic Messages API. **Never exposed to the browser.** Now used by both weekly generation and Omnibox. |
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

Rules live in **`src/lib/rules.js` and nowhere else**, split into three tiers.

**The daily protein target is `high_protein` 120g / `standard` 100g**, declared once in `GOAL_DEFINITIONS` and resolved only through `getRules`. It used to have seven homes — the adapter carried a `Math.max(…, 132)` ratchet, a flat `standard = 80`, and a `Math.min(…, DAILY_PROTEIN_MAX)` ceiling, and App.jsx passed a literal `120` — so `standard` planned at 80g against a declared 100g, and an explicit target could only ever resolve to 132. All of that is gone; every derived figure (band, weekly floor, nominal) moves with the one declaration.

| Tier | Meaning | Examples |
| --- | --- | --- |
| **1 — Hard** | Never violate; a plan containing one is invalid | per-meal protein floor (20g), no meal twice in a day, **R1 — per-dish weekly cap from its frequency tier** (default `occasional` = once a week, identical to the old flat cap; `staple` 3, `retired` 0 — see `docs/MEAL_TIERS.md`), **R2 — 3–4 egg-anchored breakfasts**, **R3 — Indian lunch + non-Indian dinner, directional**, **anchor-ingredient cap (≤2/wk at lunch/dinner)**, **no two identical days in a week**, red-meat cap (3/wk), avoid score > 3, weekly protein ≥ 85% of nominal (**714g** at the 120g target), 50g/day sanity floor |
| **2 — Budgeted** | Allowed to break on ≤2 of 7 days | daily protein band (**108–132g**), carb cap (130g), calorie bounds (1600–2200) |
| **3 — Scored** | Never rejects; only ranks | **R4 — lunch and dinner both flatbread/pasta**, variety, cuisine diversity, protein-family diversity, fibre, dinner calorie tapering, user preferences, anti-greedy |

### The quality rubric is enforced, not just scored

`docs/QUALITY_RUBRIC.md` R1–R3 are **hard rules inside the optimizer**, applied
where each is cheapest to enforce:

- **R1** (no dish repeats, one optional pin up to 3) is a week-level counter in
  `canPlaceDay`. One counter across all three slots, not one per slot — a dish
  at lunch on Monday and at dinner on Thursday is a repeat. It **replaced** the
  old per-slot ceilings (breakfast ≤4, lunch/dinner ≤2), which is why a week is
  now 21 distinct dishes.
- **R2** (3–4 egg-anchored breakfasts) needs both a ceiling and a floor. The
  ceiling prunes in `canPlaceDay`; the floor cannot, because a partial week
  being short on eggs is not yet a violation — so the beam carries a look-ahead
  in the same shape as the weekly protein floor, and `eggBreakfastsFloor`
  pro-rates it for partial runs.
- **R3** (Indian lunch + non-Indian dinner) is applied at **enumeration**,
  because it is a property of a single day. Nothing illegal is ever built,
  scored or shortlisted, and the candidate pool drops ~76% (99,900 → 23,688),
  which more than pays for R1/R2's extra bookkeeping — the optimizer got
  *faster*, ~1.0–1.25s → ~780ms.
- **R4** (lunch and dinner both flatbread/pasta) is **scored, never gated**, by
  founder instruction and because it genuinely conflicts with the macro
  budgets: 18 of the 28 Indian lunches R3 forces are flatbread, so gating it
  would regularly trade a −5 for an out-of-band day.

All three hard rules are **re-checked in `planValidator.js`**. That is not
belt-and-braces: Phase 2 hands the model flat per-slot shortlists that have
thrown the week structure away, so without the validator check a recombination
could pair a continental lunch with an Indian dinner and nothing downstream
would notice.

If the search runs out of candidates it returns a `bestEffort` week flagged
`feasible: false` and `constraintsRelaxed`, carrying a `diagnostics` block
naming the pool that ran dry (distinct Indian lunches, non-Indian dinners, egg
breakfasts). That path can emit a week breaking R1–R3 — it exists so the
validator has something to report on — so **never persist a week without
running `validateWeek` first**.

**The anchor-ingredient cap** counts the ingredient a meal is *about* (highest protein contributor, derived from `parts[]` by `derivePrimaryIngredient`), not the meal name. Name-based caps let `Rajma chawal + raita` and `Rajma + paneer bowl` each appear twice — four rajma dinners in a week, every one legal.

Budgets **pro-rate** for partial-week regenerations: a 4-day remainder gets 1 flex day and a 408g floor, not the full week's allowance.

`getRules` throws `UnsupportedGoalError` for goals onboarding declares but nobody built (`low_carb`, `two_meals`, `vegetarian`). It no longer silently becomes `high_protein` — that is how a vegetarian used to get a week of chicken.

### Hybrid Generation Pipeline
1. **Phase 1 (deterministic)** — `src/lib/planOptimizer.js` enumerates *every* Tier-1-legal breakfast/lunch/dinner combination (3,250 for the current catalog, ~250ms), scores each against Tiers 2 and 3, and beam-searches a week that satisfies the Tier-2 budgets by construction. Produces both a reference week and the per-date, per-slot shortlists.
2. **Phase 2 (AI)** — `src/lib/planService.js` sends shortlists to `/api/generate-plan`. The `submit_weekly_plan` tool is built per request with a **per-day, per-slot `enum`** of legal meal names, so a hallucinated name is structurally impossible. The plan is keyed by date, not an array, because JSON Schema applies one `items` schema to every array element and that would collapse seven days into one shared enum.
3. **Phase 3 (validation)** — `src/lib/planValidator.js` checks the returned week against all three tiers and repairs it deterministically if needed: first replacing only the days with Tier-1 violations, then rebuilding the whole run. Nothing invalid is ever written silently; if even the optimizer cannot satisfy the rules it returns `catalogInfeasible`.

**Every path that writes a generated week MUST run Phase 3.** The optimizer's
week-level guarantees do not survive Phase 2 on their own: the AI receives flat
per-slot shortlists that discard week structure, so it can freely recombine them
into a week that breaks repeat caps, the red-meat cap, or the duplicate-day rule.
The auto-generation path shipped without calling the validator at all and wrote
the AI's answer straight to storage — which is why bad weeks kept reaching the
user no matter how many rules were added to the optimizer. If you add a third
generation entry point, it validates or it does not ship.

Re-measure any of this with `npm run audit:generation` — it enumerates rather than estimates and exits non-zero if an acceptance criterion fails.

### Meal Database
`src/data/mealDatabase.js`, **120 meals** (20 breakfast / 85 lunchDinner / 15 snack) built from `src/data/ingredients.js` (92 ingredients). 10 of the lunch/dinner meals are composed from `mealTemplates.js` rather than hand-authored. Meals may carry an optional `recipe_url`.

Macros are **computed from `parts[]`**, never typed. So are three tags that used to be hand-maintained beside them and drifted:

| Tag | Derivation | Threshold |
| --- | --- | --- |
| `is_fat_heavy` | `macros.f > 25`, exclusive | `FAT_HEAVY_THRESHOLD` |
| `has_fibre` | `macros.fibre >= 3`, inclusive | `FIBRE_MEAL_THRESHOLD` |
| `meal_weight` | `>600` Heavy, `>=350` Medium, else Light | `HEAVY_MEAL_CALORIES` / `MEDIUM_MEAL_CALORIES` |

All three live in `deriveMealTags` (`mealDataLayer.js`) and read their thresholds from `rules.js`. **Do not hand-type them** — `handAuthoredTags` (formerly `csvTagsMap`) keeps only `cuisine`, and a test fails if a derived field reappears. Fibre is a real number in grams on every ingredient (IFCT 2017 / USDA), rolled up by `computeMacros` to one decimal.

`meal_weight` is display/reporting only — the optimizer tapers dinner by calories, not by this label.

Rebuild downstream artifacts with `npm run db:pack` (needs `npm install` — it imports `xlsx`).

---

## Known Gotchas (current, not stale)

| Area | Gotcha | Workaround / Reference |
| --- | --- | --- |
| **Claude structured output** | Prefill (`"[":`) is not a reliable way to force JSON. Use `tool_use` with `tool_choice: {type: 'tool', name}`. | See `buildSubmitPlanTool` in `src/lib/planService.js` and `tool` handling in `api/generate-plan.js`. |
| **Vercel timeouts** | `api/generate-plan.js` declares `maxDuration: 60`. Hobby plan caps at 10s regardless — upgrade to Pro or the regen will 504. | The proxy runs at `effort: 'low'` to stay inside the cap. Lower it further before reaching for a smaller model. |
| **Optimizer enumeration is quadratic — but the beam dominates** | `breakfasts x lunchDinner^2`, run client-side before the Anthropic call. The quadratic is real but **no longer the binding cost**: growing lunch/dinner 75 -> 175 moves enumeration 79ms -> 157ms and scoring 35ms -> 82ms, inside a run of ~900ms that barely changes, because the beam search dominates and is bounded independently of catalog size. **Current at 120 meals: ~720ms, 28,728 candidates.** | The previous note here said growth headroom was shrinking and the catalog was blocked on the optimizer. That was measured at 97 meals before Phase 3 Tier 1 landed and is stale — doubling the catalog now costs ~14%. Catalog growth is cheap; see `docs/MEAL_TIERS.md` §5. |
| **Promoted custom meals carry observed, not measured, macros** | `buildPromotedCustomMeal` no longer invents `{p: 24, c: 42, f: 14}`. A promoted meal now takes the **median** protein/cal/carbs/fat across every time the user logged it, and promotion **refuses** when no instance carried usable numbers. Median rather than mean because one mistyped portion would otherwise drag the meal far outside the calorie bounds. | Still not an ingredient rollup — flagged `macrosFromObservation: true` so a later pass can tell the two apart. The path is now *reachable*: closing the `customMealText` capture gap is what switched it on, which is why the macros were fixed in the same change. See `docs/FEEDBACK_SYSTEM.md` §2. |
| **Sampling parameters** | Sonnet 5 returns a 400 for any non-default `temperature`/`top_p`/`top_k`. A model swap without removing them breaks the endpoint outright. | `buildAnthropicRequest` in `api/generate-plan.js` strips them defensively, so a stale cached client bundle degrades instead of breaking. |
| **Thinking shares `max_tokens`** | Adaptive thinking is on by default on Sonnet 5 and counts against `max_tokens`. A budget sized for the response alone truncates mid-answer. | `DEFAULT_MAX_TOKENS` is 8192 for a response that is only a few enum picks. |
| **Sonnet 5 tokenizer** | ~30% more tokens for the same text than Sonnet 4.6, so cost baselines shift even though per-token pricing did not. | Re-baseline before reacting to the numbers. Also note prompt caching needs a 1024-token prefix; a short system prompt silently will not cache. |
| **Date keys + IST** | `getDateKey` uses `Asia/Kolkata`. Week boundaries are Monday-start. Don't mix with raw `toISOString()` slicing. | See `getWeekDateKeys` / `parseDateKey` in `App.jsx`. |
| **Old Gemini key still live at Google** | Removing `VITE_GEMINI_API_KEY` from Vercel only stops *future* builds from bundling it — every already-deployed URL (Vercel keeps old deployments reachable) still ships the old key in its JS bundle. The key itself must be deleted/rotated in Google AI Studio / Cloud Console, not just unset in Vercel. | Founder-owned follow-up outside this repo. |

---

## Dev / Build / Deploy

```
npm install
npm run dev              # local dev (no serverless functions — use `vercel dev` for those)
npm run build            # production build
npm run test:logic       # all tests (148, all green)
npm run test:planner     # planner regression only
npm run audit:generation # enumerate combinations + score a week against the acceptance criteria
npm run score -- <plan.json>  # score a week against docs/QUALITY_RUBRIC.md (ship at 85+)
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
| `scripts/scorePlan.mjs` | Score a week against the quality rubric (R1–R4). Accepts a rejection record, a `mealPlans` map, or `{ days: [...] }`. | — |
| `scripts/ingestUserMeals.mjs` | Fold app-added meals into `mealDatabase.js`. Reads the app's "Copy for the database" payload; prints paste-ready entries, a macro table with warnings, and the ingredient backlog. Never writes. | — |
| `scripts/exportRejections.mjs` | Dump rejected weeks from Firestore to `docs/rejections/`. **Needed before the rubric can be calibrated.** | Firebase Admin service account JSON. |
| `scripts/exportDatabase.mjs` / `exportMealsToXlsx.mjs` | Export to CSV / XLSX. | — |

When hand-pushing plans: use `generateConsolePaste.mjs`, not `pushMealPlan.mjs`, unless you specifically need admin-SDK writes. The paste helper now uses **current** timestamps — never resurrect the +1-year trick.

---

## Recent Architectural Shifts

- **Priority 1 (sync/overwrite) — shipped.** `keysToEnsure` now skips `dateKey >= todayKey`; boot no longer re-saves meal-plans; regen awaits Firestore write; `storageGet` detects and heals corrupt future-dated timestamps on both local and Firestore. Paste helper uses current time.
- **Priority 2 (Vercel proxy) — shipped.** Weekly generation runs through `api/generate-plan.js`. `tool_use` replaces the old JSON-prompting hack. Prompt caching active. API key server-only.
- **Phase 1 (generation engine rebuild) — shipped.** The three-tier rule model in `rules.js`; `constraintFilter.js` deleted and replaced by the `planOptimizer.js` day/week search; `planValidator.js` added; tool schema constrained with per-slot enums; prompts rewritten to state real numbers and stop claiming constraints were pre-verified; the hard dinner taper replaced by calorie-based scoring. See `docs/PHASE1_HANDOVER.md`.
- **Auto-generation useEffect hooks — ENABLED (2026-08-06).** A week that is *entirely* empty and still has days left auto-generates on view, using the same optimizer → shortlist → AI path as the manual "Regen Week" button. The emptiness check is what preserves the "plan pushed externally vs plan auto-generated" contract: a week with any meal in it, from any source, is never touched. `autoGenAttemptedRef` limits this to **one attempt per week per session** — without it a failed generation leaves the week empty, re-triggers the detector, and retries forever against a paid API. Failures fall back to the manual button by design.
- **Phase 2 (database repair + expansion) — shipped.** Catalog 41 → 69 meals. Joint Tier-2 compliance across enumerated day combinations went **0.9% → 6.7%**, legal breakfasts 5 → 12, Asian lunch/dinner 3 → 10, and the generated week from 7/5/5 to **7/7/7** with weekly protein at 100.5% of nominal. `is_fat_heavy`/`has_fibre`/`meal_weight` are derived rather than typed; fibre is in grams on every ingredient. No `rules.js` threshold changed. See `docs/PHASE2_HANDOVER.md` §9.
- **Sourced research batch — shipped 2026-08-03.** Catalog 69 → **97 meals**, 68 → 83 ingredients. Joint Tier-2 compliance **6.7% → 12.1%** (13.4x the 0.9% Phase 2 started from), every day in the generated week now lands exactly on the 132g protein target. Fixed two silent classification bugs the new data exposed: mackerel/sardines were tagged `vegetarian`, and `keema`/`kofta` were tagged red meat (so `Soya keema curry` was spending the red-meat budget). **Runtime hit ~2s — the catalog is now blocked on the optimizer, not the data.** See `docs/PHASE2_HANDOVER.md` §10.
- **Phase 3 Tier 1 (optimizer waste removal) — shipped and integrated.** Four commits replayed onto the Phase 2 catalog branch: memoised per-meal facts (`mealFacts`, WeakMap), enumeration bookkeeping removed, single scoring pass shared by `selectWeek` and `buildSlotShortlists` (`scoreCandidates`), bounded top-60 shortlist selection. At 97 meals / 72,930 candidates: **~2,025ms → ~630ms warm (3.2×), median of 5**; audit output and full plan+shortlists byte-identical across goals/preferences/history scenarios. One integration fix on top: the memo's inlined `fibre` had frozen the pre-Phase-2 `hasFibre` (regex-first) — it now delegates to the accessor, preserving grams-first precedence (11 of 97 meals differed). The optimizer branch's history was *not* merged wholesale — it predates Phase 2's protein-family fixes. See `docs/PHASE3_REPORT.md` and `docs/PHASE3_INTEGRATION.md`.
- **Priority 3 (Omnibox → Claude) — shipped.** `src/lib/omniboxService.js` replaces `geminiService.js` for intent parsing, using the same `api/generate-plan.js` proxy with a new `submit_meal_intent` tool. `@google/genai` dependency removed. `VITE_GEMINI_API_KEY` is no longer read anywhere in the app — the old key still needs deleting/rotating at the Google end (see Known Gotchas).

---

- **Consistency audit + findings 1, 2, 5, 6 — shipped.** `docs/CONSISTENCY_AUDIT.md` catalogues 14 facts with more than one home, ranked by blast radius; six already disagreed in production. Four are fixed:
  - **#1 goal routing.** `App.jsx`'s per-day wrapper accepted a `goalOverride` and never forwarded it, so `getRulesForProfile(undefined)` resolved **every** backfilled day — and the whole "regenerate on goal change" path — to `high_protein`. A `standard` user got a 20g per-meal floor and a 130g carb cap. `onboardingProfile.js` now takes its ids from `rules.js` `GOAL` instead of declaring a parallel enum (`two_meals_day` → canonical `two_meals`, legacy spelling still accepted and canonicalized on read), and the adapter normalizes before comparing.
  - **#2 protein target.** Seven homes → one. See the rule-model section above. **`high_protein` moved 132 → 120g** by founder decision; band, nominal and weekly floor moved with it.
  - **#5 cuisine.** Was declared twice inside `mealDatabase.js` — inline on 77 base meals (`western`) and again in `handAuthoredTags` (`Continental`), the latter silently winning, 29 disagreeing on value. Inline keys deleted and the map lowercased. This **revived the "Indian" quick action**, which compared `m.cuisine === 'indian'` against capitalised values and matched 0 of 42 meals.
  - **#6 meal-event capture.** `custom` events recorded `mealName` while the consumer read `originalMealName`, so the avoid signal never fired and `preferences.edits` was permanently empty. Now `previousMealName` is captured, `edit` events have a real producer (`selectOrderOutOption`), and the three weights that consumed them (`customAvoid`, `editAvoid`, `editAccept`) are **deleted rather than rewired** — recorded, uninterpreted, pending enough data to validate what they should mean. `confirm` (2) and `swap` (1.2) are untouched.

  Findings **3, 4, 7–14 remain open**, including two that still disagree in production: two independent red-meat classifiers (#3) and name-based fibre scoring that contradicts measured grams on 14 meat meals (#4).

- **Feedback + learning system — shipped.** Every interaction is now captured
  against one typed schema, judged at the week level, learned from, and shown
  back in the app. See `docs/FEEDBACK_SYSTEM.md`. The load-bearing parts:
  - **Capture gaps closed.** `skip` recorded a date and a slot but never the
    meal — "I will not eat this" without the "this". `custom` never wrote
    `customMealText`, which is the mechanical reason the promotion path has
    always found zero candidates (audit finding #6's second half). Both fixed,
    and `tests/feedbackCapture.producers.test.js` now scans App.jsx and checks
    all 11 `appendMealEvent` literals against the schema, so a producer can no
    longer drift from its consumer unnoticed.
  - **Week review replaces the `window.prompt`.** Accept/reject, a 1-5 rating
    (3 is explicitly neutral and moves nothing), structured reason tags that
    name the *same attribute keys the learner extracts from meals*, and a
    verbatim note. `rejected-plans` is still written so `scorePlan.mjs` keeps
    working.
  - **Learning is attribute-level, not dish-level.** Every observation credits
    the dish and its ten attributes, so three swaps off three paneer dishes
    become one `primary:paneer` signal that generalises to paneer dishes never
    served. Attributes are damped by inverse document frequency — measured,
    because crediting keys equally made one observation reach a median 110 of
    110 meals, which smears rather than generalises.
  - **It cannot wreck a plan, and that is tested.** Tier 3 only; shrunk by
    evidence; withheld below an evidence floor. With no model the optimizer is
    *bit-identical*; with every attribute at -1 it still returns a feasible
    week above the protein floor. `audit:generation` unchanged (1045ms ->
    1041ms).
  - **The legacy dish-name counters are untouched and still what is
    persisted.** The learned model is additive and re-derived from the log on
    every boot, never stored. Merging them waits for real data.

- **Meal tiers, ratings and templates — shipped.** See `docs/MEAL_TIERS.md`.
  - **R1's flat cap is now per-dish.** `occasional` (the default) caps at 1 and
    is bit-identical to the old rule; `staple` allows 3, `retired` 0. The
    single-pin hack is superseded and can now only loosen a tier. Asserted
    against `RUBRIC_LIMITS` so the default cannot drift from the rule it
    replaces.
  - **Making a staple recur took four attempts.** Discounting the repeat
    penalty does nothing (a repeat also forgoes `distinctMealBonus`); a repeat
    bonus above break-even collapses the beam into a dead end; a candidate-pool
    reservation — built on a mis-measurement and since removed — changed
    nothing. What works is a per-appearance `affinity` in `baseScore`: 18/75
    dishes appearing -> 57/75, 13/75 recurring -> 46/75.
  - **Tiering can never produce a worse week than not tiering.** On a beam
    dead-end `selectWeek` retries once with tier scoring suppressed, so the
    fallback is the untiered search.
  - **Tiers are proposed from the event log, never applied by it** — unlike the
    learned model, which is Tier 3 and cannot make a plan illegal. Tiers change
    a hard cap, so they ask.
  - **Templates add mix-and-match meals**, expanded at catalog build. Catalog
    110 -> 120. This *improved* the plan: carb cap 6/7 -> 7/7, weekly protein
    100.4% -> 101.4%, runtime unchanged.

- **Tiering screen ordered by frequency, unjudged first — shipped.** See
  `docs/MEAL_TIERS.md` §1 and §3a. **`tier` is now nullable**, and that is the
  substance of the change rather than a detail of it: `occasional` is the
  default, so "nobody has judged this" and "judged as occasional" were the same
  record and the screen could not put the former first. Null resolves to
  `occasional` through `getMealTier` / `getTierDefinition`, so the planner is
  unaffected — but `hasTierEffects` had to start resolving before comparing,
  or a rating-only entry would switch the optimizer off its untiered path and
  end the "untiered catalog plans identically" guarantee. `getMealTier` now
  validates the stored string too; it used to pass `legendary` straight through
  for any map that had not been normalised first. Legacy records all carry a
  concrete tier, so nobody re-tiers a catalog they already worked through.

- **User-added meals — shipped.** See `docs/USER_MEALS.md`. The tiering screen
  let you say how often a dish should appear; this lets you say a dish exists.
  - **A meal you type is not a meal the planner can see.** It is a *draft*,
    stored apart in `meal-drafts`, and it becomes plannable only by acquiring
    real `parts[]` and passing through `buildUserCatalogMeal`, which refuses
    outright when the rollup is empty or zero-calorie. The optimizer enforces
    the 20g per-meal and 714g weekly floors against catalog macros, so this is
    the same hazard `buildPromotedCustomMeal` had, prevented structurally
    rather than by care.
  - **The ingredient estimator cannot invent an ingredient.** `ingredientId` is
    an `enum` of the live `ingredients.js` keys — the `planService` per-slot
    enum trick one level down. The model supplies *portions*, never macros;
    `computeMacros` supplies macros. Anything it cannot map goes to `unmatched`
    rather than being substituted, and that list is the ingredient backlog.
  - **`buildMeal` moved from `mealDatabase.js` to
    `mealDataLayer.buildCatalogMeal`**, so a user meal and a shipped meal come
    out of one function. All 321 existing tests stayed green across the move;
    `tests/userMeals.test.js` asserts the two paths agree field by field.
  - **Handover is a clipboard paste**, not a sync: no local checkout, no admin
    credentials. `scripts/ingestUserMeals.mjs` reads it and prints paste-ready
    catalog entries — it never writes, because replacing an estimated portion
    with a sourced one is a judgement call.
  - **`meal_added` carries no learning signal**, deliberately. Crediting a dish
    for being added rewards novelty over the dishes with a real record behind
    them; the tier set on the same screen is the honest channel for "plan this
    often".

## Next Priorities (updated)

0. **Confirm the five Phase 2 decisions.** `docs/PHASE2_HANDOVER.md` §4 asked the founder five product questions before the work; they were not answered, so Phase 2 proceeded on stated assumptions (meals authored for review, additive only, fibre in grams now, unimplemented goals left throwing, protein floor unchanged). §9.7 and §9.8 record what to confirm — including the measurement for raising the weekly protein floor.
1. ~~**Fix `buildPromotedCustomMeal` before re-enabling promotion.**~~ **Done.**
   Detection was never deliberately off — it was off because `customMealText`
   had no producer. Closing that capture gap switched promotion on, so the
   macros were fixed in the same change rather than left armed: a promoted
   meal now carries the median of what was actually logged, and promotion
   refuses outright when there is nothing to go on. Worth keeping in mind as a
   pattern: the "safely unreachable" hazard became reachable as a side effect
   of an unrelated correctness fix.
2. **Next meal batch.** The optimizer is unblocked (Tier 1 shipped; ~1.0–1.25s at 110 meals) — the queued meal ingestion can now proceed against a fast optimizer. Tier 2/3 of `docs/PHASE3_HANDOVER.md` §4 stay parked until the catalog is well past 200 meals.
3. **Switch timestamps to Firestore `serverTimestamp()`.** The current heal-on-read logic is defensive but brittle. Using server-assigned timestamps makes client-clock poisoning impossible and lets us delete the `isCorruptTs` / heal branches.
4. **IF (Intermittent Fasting) mode.** `two_meals` is declared in onboarding and reconciled in `rules.js`, but has no ruleset — `getRules` throws for it by design. Give it real Tier-1/2/3 definitions and surface it so users can opt into 16/8 or 18/6 without overriding meals manually.
5. **Vegetarian goal.** Now cheap: Phase 2 added 2 vegetarian breakfasts and several vegetarian lunch/dinner dishes that sit inside the budgets. Still throws by design.
6. **Tag AI-generated plans** (`_aiGenerated: true`) so future dedup/cleanup logic can tell pushed/AI/manual plans apart.
7. **Calibrate the learning constants against real use.** `PRIOR_STRENGTH`
   (6), `MIN_EVIDENCE_TO_APPLY` (2.5) and `RECENCY_HALF_LIFE_DAYS` (70) are
   defensible priors, not fitted values. The system is built so that is safe —
   with no evidence it changes nothing and it shows its working — but after a
   month of real events the question is whether they match how this user
   actually behaves. `docs/FEEDBACK_SYSTEM.md` §4.
8. **Decide whether to correct for exposure bias.** The planner shows what it
   already believes you like, so disliked attributes stop appearing and freeze.
   Currently surfaced honestly ("Barely tried" in the insights panel) but not
   corrected. Fixing it means occasionally planning *against* current belief —
   a worse week now for a better model later. Founder's call, not the code's.
   `docs/FEEDBACK_SYSTEM.md` §7.
9. **Enforce `minGapDays` for the `rare` tier.** Declared and tested as data,
   not yet wired — it needs history threaded into enumeration, where a
   history-dependent hard rule can make the catalog infeasible in ways that are
   hard to diagnose. The weekly cap and a negative affinity already make `rare`
   behave rarely. `docs/MEAL_TIERS.md` §6.
10. **Reconcile tier against learned preference.** A dish tiered `staple` and
   then repeatedly swapped away from carries a positive affinity and a negative
   learned score at once; they simply add. Defensible, but not designed.
11. **Bundle size.** 819KB, 212KB gzipped (up from 796KB/204KB with the feedback system; down from 994KB/245KB originally — `@google/genai` removal alone was worth ~50KB gzip). Code-split Firebase, now the largest remaining offender.

---

## Docs

| Doc | What it is |
| --- | --- |
| `docs/PHASE3_REPORT.md` | **What Phase 3 delivered** — the four Tier-1 optimizer commits, the equivalence proofs, and where the remaining time goes (§4.1). Its measurements were taken at 41 meals + a synthetic catalog; the re-verified 97-meal numbers are in the gotcha row above and `PHASE3_INTEGRATION.md`. |
| `docs/PHASE3_INTEGRATION.md` | How the optimizer branch was replayed onto the Phase 2 catalog branch (the two had diverged from the same base), the protein-family/fibre merge hazards, and the 97-meal re-verification. |
| `docs/PHASE3_HANDOVER.md` | **Delivered** (Tier 1). Kept for Tier 2/3, which are parked until the catalog is well past 200 meals. Outcome recorded in `docs/PHASE3_REPORT.md`. |
| `docs/PHASE2_HANDOVER.md` | §1–§8 the original brief. **§9 what Phase 2 measured** — including the quadratic-runtime finding (§9.6) and the protein-floor measurement left for the founder (§9.7). **§10 the 2026-08-03 research batch**, the profiled runtime breakdown (§10.4) and the three-tier optimizer fix (§10.5). |
| `docs/PHASE1_HANDOVER.md` | Shipped 2026-08-02. §9 records what the generation-engine rebuild measured — read it before changing any threshold. |
| `docs/EVAL_AND_ROADMAP.md` | The original audit. §3 is now historical (that code is deleted); §4 onward is still live. |
| `docs/QUALITY_RUBRIC.md` | **The four scored rules (R1–R4)** layered on top of the `rules.js` hard gates. Implemented in `src/lib/planScorer.js`. **Not yet calibrated** — the calibration in its §Calibration needs `docs/rejections/` and the founder's ideal week, neither of which is in the repo. |
| `docs/MEAL_TIERS.md` | **Tiers, ratings and templates.** The R1 change (the weekly cap is now per dish), the three wrong designs it took to make a staple actually recur and the ablation that settled it, how tiers are proposed from behaviour, the template system, and the known limits. **Read §3 before changing any tier number.** |
| `docs/FEEDBACK_SYSTEM.md` | **The capture, review and learning system.** What each event records and why, how week reviews work, the attribute-level learning model and its three constants, the three guards that keep it from wrecking a plan, measured cost, and its known limits (exposure bias, chief among them). Read §4 before changing any learning threshold. |
| `docs/USER_MEALS.md` | **Meals the user adds from the app.** Why a draft is inert and what the single door between a draft and a plannable meal checks, how the ingredient estimator is enum-constrained so it cannot invent an ingredient, the clipboard handover back into the repo, and the decisions not worth re-litigating. **Read §1 before touching `buildUserCatalogMeal`.** |
| `docs/CONSISTENCY_AUDIT.md` | **Every fact with more than one home**, and every concept inferred by pattern-matching where structured data exists — 14 findings ranked by blast radius, each with file:line, current values, and the location that should become authoritative. Findings 1, 2, 5 and 6 are fixed and marked as such; the rest are open. |

---

## Quick File Map

```
api/
  generate-plan.js       Anthropic proxy (server-only API key)
  storage/[key].js       Optional Upstash Redis fallback
src/
  App.jsx                Main component — state, sync, effects, UI
  components/
    Omnibox.jsx          NL input (Claude-backed via omniboxService)
    PlanReviewModal.jsx  Week review sheet (verdict, rating, reasons, note)
    InsightsPanel.jsx    What the planner learned, and what it has not
    MealTieringPanel.jsx Rate and tier the database; accept tier suggestions
    AddMealPanel.jsx     Add your own dishes; estimate their ingredients; approve
    AdminTools.jsx       Admin panel
    OnboardingFlow.jsx   First-run setup
  lib/
    rules.js             SINGLE SOURCE OF TRUTH for every threshold (3 tiers)
    planOptimizer.js     Day enumeration + week beam search + shortlists
    planValidator.js     Post-generation validation + deterministic repair
    planScorer.js        Quality rubric R1-R4 (docs/QUALITY_RUBRIC.md) — scores, never gates
    planService.js       Client wrapper for /api/generate-plan — weekly gen (Claude)
    omniboxService.js    Client wrapper for /api/generate-plan — Omnibox intent parsing (Claude)
    plannerGenerator.js  Single-day generator (facade over planOptimizer)
    mealEvents.js        Event log → legacy dish-name preference derivation
    feedbackSchema.js    SINGLE SOURCE OF TRUTH for what is captured (9 event
                         types, their fields, and how each reads as a signal)
    planReview.js        Week-level accept/reject/rate + structured reasons
    preferenceLearning.js  Dish- AND attribute-level learning (see docs/FEEDBACK_SYSTEM.md)
    feedbackAnalytics.js   Adherence, overrides, skips, most-rejected dishes
    mealTiers.js         Per-dish frequency tier, rating, pairing mode
    userMeals.js         Draft lifecycle for user-added dishes + the one door
                         between a draft and a plannable meal
    mealIngestService.js Client wrapper for /api/generate-plan — turns a dish
                         name into catalog ingredients (enum-constrained)
    tierProposals.js     Tiers suggested from behaviour (proposes, never applies)
    firebase.js          Firebase client init
  data/
    mealDatabase.js      Canonical meal list
    ingredients.js       Ingredient definitions
    mealTemplates.js     Mix-and-match meals (base + protein) expanded at build
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
