# Meal Planner — Evaluation & Roadmap

**Date:** 2026-08-02
**Scope:** Full evaluation of the meal generation engine, meal database design, and rule/prompt system. Plus a design for user-added meals.

> **Status update (2026-08-02): Phase 1 is shipped.** Everything in §3 (the
> generation engine) has been fixed and is measured in
> `docs/PHASE1_HANDOVER.md` §9. **§3 is now a historical record of what was
> broken, not a description of the current code** — the filter it describes has
> been deleted. §4 (the database) is still accurate and is the live work; see
> `docs/PHASE2_HANDOVER.md`. §5–§7 are unchanged and still pending.
>
> Re-measure any figure in this document with `npm run audit:generation`.

---

## 1. The headline

The app is architecturally in the right shape and wrong in the details. The "hybrid pipeline" described in `CLAUDE.md` — deterministic filter does the math, AI does the taste — is exactly the design the industry has converged on. **But the deterministic half doesn't actually enforce anything, and the prompt tells Claude that it does.**

Concretely: nothing in the system checks that a day's meals add up to your protein target. The filter doesn't. The AI is explicitly told not to. There is no check after generation. So the number the whole app is built around — daily protein — is unenforced end to end.

I measured this. For the `high_protein` goal (target 132g/day):

| Measurement | Result |
|---|---|
| Valid breakfast+lunch+dinner combinations the AI can choose from | 1,820 |
| Combos that land in the 119–145g protein band | **628 (34.5%)** |
| Combos that break the 130g daily carb cap the filter claims to enforce | **335 (18.4%)** |
| Combos the system would reject | 0 |

So roughly **two out of three generated days miss the protein target**, and about one in five breaks the carb cap — while the prompt says every option has "ALREADY been verified to satisfy all nutritional constraints."

That's the core problem. Everything else below is downstream of it.

---

## 2. What's genuinely good — keep these

**The two-phase architecture is right.** Market research confirms it: constraint-solver systems achieve consistent macro adherence; LLM-only systems produce numerically inconsistent output. Coupling the two — rules for the math, model for the palatability — is the correct production pattern. The bones are good; the deterministic layer just needs to actually run.

**Ingredient-level macro computation.** Meals are built from a 52-ingredient reference table with per-100g values and USDA/IFCT source citations, and macros are computed rather than typed in. This is a real asset — most hobby meal planners hardcode a calorie number per dish and drift immediately. **All 41 meals pass a macro↔calorie consistency check** (protein×4 + carbs×4 + fat×9 within tolerance of stated calories). That is unusual and worth protecting.

**Forced structured output.** Using Anthropic's tool-calling schema so the model physically cannot return malformed JSON — instead of prompt-begging for JSON — is the correct call and eliminates a whole class of parse failures.

**Server-side API key.** The Vercel proxy keeps `ANTHROPIC_API_KEY` off the browser. Correct.

**The event log.** `mealEvents.js` recording confirm/skip/swap/edit and deriving preference scores is the right substrate for personalisation later. It's underused, but it exists and it's clean.

**Sync hardening.** The timestamp-corruption handling is genuinely well-reasoned defensive code, and the invariants documented in `CLAUDE.md` are the kind of thing that saves a future session hours.

---

## 3. What's broken — the generation engine *(FIXED in Phase 1 — historical)*

> Every defect in this section has been fixed. `constraintFilter.js` is deleted;
> `src/lib/rules.js`, `planOptimizer.js` and `planValidator.js` replace it. Kept
> for the record because the measurements explain *why* the current architecture
> looks the way it does.

### 3.1 The constraint filter filters almost nothing

`generateFilteredShortlists` walks breakfast → lunch → dinner and is written as if it accumulates the day as it goes. It doesn't. Look at `src/lib/constraintFilter.js:235`:

```js
// But we can't pre-commit, so we leave dayPlanSoFar empty for this slot.
```

Because `dayPlanSoFar` stays empty, every "running total" the filter computes is zero:

- `dayCarbsUsed` = 0 → the carb cap never triggers
- `dayCalUsed` = 0 → the calorie ceiling never triggers
- `dayFatHeavyCount` = 0 → the fat-heavy cap never triggers
- `dayProteinFamilies` = empty → "no chicken twice in one day" never triggers
- `pairedFamily` = null → "lunch and dinner must differ" never triggers

**Five of the ten rules are dead code.** Measured shortlist yield confirms it — for every one of 7 days:

| Slot | Candidates surviving the filter |
|---|---|
| Breakfast | 5 / 7 |
| Lunch | **26 / 26 — zero filtering** |
| Dinner | 14 / 26 |

Only three rules do real work: the per-meal protein floor (20g), the dinner "taper" (no Heavy meals at dinner), and history-based repetition. Everything else is decoration.

The same bug hits the weekly rules — `src/lib/constraintFilter.js:247` notes the plan-so-far is never updated, so "max 2 repeats of a lunch/dinner" and "max 3 red-meat meals per week" only count against *past* history, never against the week being generated. Nothing stops the model from serving the same dinner seven nights running.

### 3.2 The prompt tells Claude a falsehood

`src/data/fallbackPrompts.js:100`:

> "Every meal option below has **ALREADY been verified** to satisfy all nutritional constraints (protein floors, carb caps, caloric bounds, fat-heavy limits, repetition ceilings, red meat caps). You do NOT need to check any of these."

Three of those six claims are false. This is the worst possible failure mode: the one component that *could* reason about daily totals has been explicitly instructed not to, on the strength of a guarantee that doesn't hold. Fix the filter and this line becomes true; leave the filter and this line must be deleted.

### 3.3 There is no validation after generation

Whatever Claude returns is written straight into the plan. There is no post-generation check, no repair loop, no retry. `src/lib/constraintFilter.js:153` even says the calorie floor "is checked post-generation" — there is no such check anywhere in the codebase.

Related: meal names come back as free-text strings and are matched by lowercased exact match (`findMeal` in `App.jsx`). A near-miss silently falls back to whatever was in the slot before, with no error surfaced. Anthropic's schema layer supports `enum` — the tool schema should list the exact legal meal names per slot per day so a hallucinated or slightly-reworded name is impossible by construction.

### 3.4 Three rule engines that disagree with each other

There are three independent definitions of "a valid day," and they contradict:

| Rule | `plannerGenerator.js` | `constraintFilter.js` | The prompt |
|---|---|---|---|
| Daily protein floor | 105g (enforced) | not checked | "informational" |
| Daily protein ceiling | 140g (enforced) | not checked | — |
| Daily carb cap | 130g (enforced) | 130g (**dead code**) | — |
| Fat-heavy definition | computed: fat > 25g | hand-typed `is_fat_heavy` flag | — |
| Meat meals must have fibre | enforced | absent | soft "prefer 2 of 3" |
| Protein spread across meals | max 40g gap | absent | absent |

`plannerGenerator.js` (the stricter, better engine) still runs on goal-change and onboarding; the AI path runs on "regenerate rest of week." **The same app produces plans under two different rulebooks depending on which button you press.** This also explains the 4 failing regression tests — they assert `plannerGenerator`'s rules against fixtures the filter would happily pass.

### 3.5 The high-protein goal is fighting itself

The `high_protein` target is 132g/day. The dinner "taper" rule excludes every `Heavy` meal from dinner — which removes the three highest-protein dishes in the catalog:

- Chicken curry + jowar roti + dal — **61g**
- Chicken curry + jowar roti — 56g
- Grilled salmon + veg + spaghetti — 46g

So the goal demands the most protein while the rules remove the best protein sources, from a catalog whose median lunch/dinner is 43g. This is the "high-protein filter is strict" gotcha already noted in `CLAUDE.md` — now with a measured cause. The taper should be based on **calories**, not on a hand-typed weight label, and should be a *scoring preference*, not a hard exclusion.

### 3.6 Model and API are a generation behind

`api/generate-plan.js` pins `claude-sonnet-4-6`. Current models are Claude Opus 5, Sonnet 5, and Haiku 4.5.

**One thing to know before upgrading:** the proxy always sends `temperature: 0.7` (`planService.js:143`). Sonnet 5 / Opus 5 **reject non-default sampling parameters with a 400 error**. A naive model-string swap will break the endpoint outright. `temperature` must be removed in the same change.

Recommendation: **Claude Sonnet 5** for weekly generation — near-Opus quality on structured selection at Sonnet cost — with `output_config.effort` tuned down rather than `temperature`. Note also that Sonnet 5 uses a new tokenizer (~30% more tokens for the same text), so re-baseline cost before reacting to the numbers.

Also worth noting the **Vercel Hobby 10-second cap**, already flagged in `CLAUDE.md`. Once the filter does real work the shortlists get *smaller*, which helps — but this stays a live risk until the plan is on Pro.

---

## 4. What's broken — the database design *(LIVE — this is Phase 2)*

### 4.1 It's too small to satisfy its own rules

41 meals: 7 breakfasts, 26 lunch/dinner, 8 snacks. After filtering, **5 breakfasts for 7 days**. Variety is arithmetically impossible; the "VARIETY IS KING" prompt rule can't be honoured no matter how good the model is.

Cuisine coverage is also thin — lunch/dinner is 13 Indian, 10 Continental, 3 Asian. The prompt's "mix Indian, Continental, Asian through the week" has three Asian dishes to work with.

**This is the single highest-leverage fix in the whole project.** ~40 → ~120 meals changes the output quality more than any prompt or algorithm change. And it's exactly what feature request #2 (user-added meals) is for — that feature isn't a nice-to-have, it's the growth path for the database.

### 4.2 Hand-typed tags contradict the computed data

Meals carry hand-maintained tags in a `csvTagsMap` alongside computed macros. They disagree, a lot:

| Tag | Disagreements with computed value |
|---|---|
| `is_fat_heavy` vs. fat > 25g | **12 of 41** |
| `has_fibre` vs. fibre-bearing ingredients | **11 of 41** |
| `meal_weight` vs. calorie thresholds | 3 of 41 |

Examples: Kababs + dal + gobi + jowar roti is 37g fat and tagged `is_fat_heavy: false`. Chicken red curry is 14g fat and tagged `true`. Scrambled eggs + toast is tagged `has_fibre: false` despite whole-wheat toast.

Anything derivable from ingredients should be **derived, not typed**. Keep hand-tags only for genuinely subjective fields (cuisine, effort, user preference).

### 4.3 Fibre isn't a number

`has_fibre` is a yes/no flag. There is no fibre in grams anywhere — not on meals, not in the ingredient table. For an app whose rules care about fibre, this is a real gap. Same for **sodium, prep time, cost, seasonality, and any recipe/method text** — all absent (0 of 41 meals).

### 4.4 Goal plumbing is inconsistent

Five goals exist in onboarding (`high_protein`, `standard`, `low_carb`, `two_meals_day`, `vegetarian`); three are UI-disabled. But `constraintFilter.js` only knows two — everything else silently falls back to `high_protein`. And the goal IDs don't match: onboarding says `two_meals_day`, the data layer tags meals `two_meals`. A vegetarian goal would today produce a plan full of chicken.

### 4.5 The `database/` folder is aspirational

`database/schema_v1.sql` and `architecture_v1.md` describe a proper normalised model (`meal_templates`, `meal_template_components`, `preference_scores`, `meal_events`). Nothing uses it — the live catalog is a JavaScript literal. The schema is good thinking; it's just not connected to anything. Worth either adopting or explicitly marking as a future target so it stops looking like documentation of reality.

---

## 5. Feature request: adding meals from the frontend

You asked for a way to push new home-cooked meals into the database and have them researched for nutrition and used in future plans.

### What already exists (and why it's currently harmful)

There *is* a promote-to-catalog flow. `approveCustomCandidate` (`App.jsx:1022`) spots meals you've logged repeatedly and offers an "Add" button. But look at what it saves — `buildPromotedCustomMeal` (`App.jsx:996`):

```js
const profileByType = {
  breakfast:  { p: 20, c: 30, f: 10, cal: 310 },
  lunchDinner:{ p: 24, c: 42, f: 14, cal: 450 },
  snack:      { p: 12, c: 20, f: 8,  cal: 220 },
};
```

**Every user-added meal gets identical invented macros.** Not estimated — hardcoded by slot. No ingredients, no cuisine, no fibre, no weight class. And 24g protein clears the 20g filter floor, so these fabricated numbers flow straight into plans and into daily protein maths that's already unenforced.

There's also a `pending-novel-foods` queue that gets written to and **never read by anything** — a dead end.

So the feature is ~30% built and the built part actively degrades data quality. It needs replacing, not extending.

### Proposed design

**Entry point.** Settings → "My Meals" tab, as you suggested. Not in the main UI.

**Capture.** Free text: *"Rajma chawal with a bowl of curd and a small salad."* Optionally a photo.

**Resolution — three tiers, in order.** This is the important part, and the design principle from market research is: **prefer database lookup over model estimation, and label the difference.**

1. **Local ingredient match.** Try to build the meal from the existing 52-ingredient table. Deterministic, free, exact, and consistent with every other meal. Confidence: high.
2. **Reference database lookup** for unmatched ingredients. Two sources worth adding:
   - **IFCT 2017** (Indian Food Composition Tables) — 542 Indian foods, 151 nutrients including fibre, measured across six regions by the National Institute of Nutrition. Available as an npm package (`@nodef/ifct2017`) and open datasets. Given the catalog is majority-Indian, this is the highest-value single addition to the project and it's free and offline.
   - **USDA FoodData Central** — free API, the reference other commercial APIs are built on, for the Continental/Asian items.
   New ingredients found this way get added to the ingredient table with a source citation, so the *next* meal that uses them resolves at tier 1.
3. **Claude estimation** — only for what tiers 1 and 2 can't resolve. Same serverless proxy, structured output, and critically: the result is written with `confidence: low` and `needs_review: true`. The `nutrition_metadata` fields for exactly this already exist in `mealDataLayer.js` and are currently unused.

**Confirmation.** Show the user the parsed ingredient list with quantities and computed macros before saving, with per-item confidence. Let them correct portions. This is the "AI proposes → user confirms" pattern — never silently accept a model's nutrition estimate.

**Storage.** Same shape as catalog meals — real `parts[]`, so macros are computed by the same `computeMacros` as everything else, and derived tags come from the same code. A user meal should be indistinguishable from a built-in one except for provenance and confidence.

**Management.** The My Meals tab lists user meals with edit / delete / "exclude from plans", and a review queue for anything flagged low-confidence.

This turns the feature from a data-quality liability into the database's growth engine — which is the answer to §4.1.

---

## 6. Frontend — brief assessment

You said you're happy here, and that's reasonable. Quick notes only:

- The week view, day cards, quick actions, and swap flow are coherent and the information hierarchy is sensible. No structural complaints.
- `App.jsx` is **2,100 lines** holding all state, all sync, all effects, and all UI. It works, but it's the reason every change feels risky. Not urgent, but extracting the sync layer and the generation flow into hooks would de-risk everything downstream. Worth doing *before* the database work, not after.
- Bundle is ~980KB (240KB gzipped). Firebase and `@google/genai` dominate. Dropping Gemini removes one of the two.
- `AdminTools.jsx` is a one-way "overwrite Firestore from local code" button. It's a footgun with a `window.confirm`. If Settings is getting a My Meals tab anyway, this should move behind the same surface.
- Omnibox still uses `VITE_GEMINI_API_KEY`, exposed in the browser bundle. Already on your list; it becomes free to fix once the meal-capture parser is built, since it's the same problem.

---

## 7. What the market does (and what to borrow)

Short version of the research:

- **Constraint solvers beat LLMs on macro adherence.** Systems that enforce nutrition at the database-query level achieve consistent energy and macro compliance; off-the-shelf LLMs produce "numerically inconsistent outputs." The recommended production pattern is explicitly hybrid — which is what you have on paper. Borrow: make the deterministic layer actually binding.
- **Hard numeric constraints work better than soft adjectives** when you *do* involve a model. "Hit 132g protein and stay under 2,200 kcal" outperforms "high protein, not too many calories." Your current prompt uses the soft form and then says the numbers are "informational." Worth inverting.
- **Nutrition data: use references, not model knowledge.** USDA FoodData Central is the free authoritative base that the commercial APIs (Nutritionix, Edamam, FatSecret) resell. For Indian food specifically, IFCT 2017 is the right source and is openly available.
- **Constrained decoding with enums is reliable.** Restricting a schema field to a fixed set means the model *cannot* emit anything else. Use it for meal selection.

Nothing here suggests you need a commercial nutrition API subscription. USDA (free) + IFCT (free, offline, India-specific) covers this app's needs.

---

## 8. Roadmap

Ordered by leverage. Phase 1 is the one that matters; the rest builds on it.

### Phase 1 — Make the rules real *(SHIPPED 2026-08-02)*

Goal: a generated day either satisfies its constraints or the app knows it didn't.

**Done.** All seven items below shipped, plus a three-tier rule model
(hard / budgeted / scored) that the original write-up did not anticipate — the
founder's "aim daily, judge weekly" call made a flat filter the wrong shape.
Measured results in `docs/PHASE1_HANDOVER.md` §9. Headline: a generated week hits
7 of 7 days in the protein band and 885g weekly protein (95.8% of nominal), with
the calorie budget — not protein — as the binding constraint.

1. **Fix the sequential filter.** Make the filter actually commit a slot before filtering the next, so daily accumulators are non-zero. Two viable approaches: (a) beam search over B/L/D combinations scoring against daily targets, or (b) have the filter emit *feasible combinations* rather than three independent lists. (a) is more flexible; (b) is simpler and makes the tool-schema enum trivial.
2. **Add a post-generation validator.** Check the returned week against daily protein band, carb cap, calorie floor/ceiling, weekly repetition, and red-meat cap. On violation, repair deterministically or retry once with the violations fed back.
3. **Unify the rule engines.** Extract one `rules.js` as the single source of truth for goal constraints, consumed by `plannerGenerator`, `constraintFilter`, and the validator. Delete the duplicated thresholds.
4. **Constrain the tool schema.** Replace free-string meal names with per-slot `enum` of legal names. Eliminates hallucinated names and the silent `findMeal` fallback.
5. **Rewrite the prompt to match reality.** Delete the false "already verified" claim. State the actual numeric targets. Remove the now-vestigial "OUTPUT FORMAT — strictly valid JSON" section (structured output handles that).
6. **Fix the high-protein/taper conflict.** Calorie-based dinner tapering, as a score not a hard cut.
7. **Upgrade the model — and remove `temperature` in the same commit** (Sonnet 5 rejects it with a 400).

*Done when:* a 7-day generated plan passes the validator on every day, and the 4 failing regression tests pass against the unified rules. — **Met.** The suite is 102/102; one of the four "failures" turned out to be a time-bomb fixture rather than a rules problem (see the handover).

### Phase 2 — Repair the database *(NEXT — see `docs/PHASE2_HANDOVER.md`)*

1. **Derive tags instead of typing them.** Compute `is_fat_heavy`, `has_fibre`, `meal_weight` from ingredients; keep hand-tags only for cuisine/effort. Retire `csvTagsMap`.
2. **Add fibre in grams** to the ingredient table (IFCT has it), then to meals. Optionally sodium.
3. **Add prep time and effort** — needed for "I'm exhausted" swaps, which the Omnibox already has an intent for.
4. ~~**Reconcile the goal enums**~~ — *partially done in Phase 1.* `rules.js`
   normalises the spelling (`two_meals_day` → `two_meals`) and `getRules` now
   throws `UnsupportedGoalError` instead of silently falling back to
   `high_protein`. The three unimplemented goals still need either a real
   ruleset or removal from the UI.
5. **Expand the catalog** toward ~120 meals, weighted to the current gaps: high-protein breakfasts, lighter dinners, Asian dishes.

### Phase 3 — User-added meals *(your feature request)*

1. Settings → My Meals tab: list, add, edit, delete, exclude.
2. Three-tier resolution pipeline (local → IFCT/USDA → Claude), per §5.
3. Confirmation UI showing parsed ingredients, quantities, macros, and per-item confidence.
4. Wire up `nutrition_metadata.confidence_score` / `needs_review` — the fields already exist and are unused.
5. Review queue for low-confidence entries; retire the dead `pending-novel-foods` queue.
6. **Replace `buildPromotedCustomMeal` entirely** — the hardcoded-macro path must not survive this phase.

### Phase 4 — Personalisation & polish

1. Feed `mealEvents` preference scores into the *scoring* layer rather than only as a hard `avoids > 3` exclusion.
2. Migrate Omnibox to Claude via the same proxy — kills `VITE_GEMINI_API_KEY` and a chunk of bundle.
3. Tag AI-generated plans (`_aiGenerated: true`).
4. Firestore `serverTimestamp()` to retire the heal-on-read branches.
5. Extract sync + generation from `App.jsx` into hooks.
6. IF / two-meals mode, now that goal plumbing is consistent.

---

## 9. If you only do three things

1. ~~**Make the constraint filter actually accumulate the day, and add a validator after generation.**~~ **Done** — the filter is deleted and replaced by an enumerating optimizer plus a post-generation validator with deterministic repair.
2. **Grow the database, and make user-added meals the way it grows** — with real nutrition resolution, not hardcoded placeholder macros. **Still the highest-leverage item, and now the binding one:** the rules are real, so the catalog is what limits output quality. Only 0.9% of legal day combinations satisfy all three daily budgets at once.
3. ~~**Delete the sentence in the prompt that tells Claude the constraints are already handled.**~~ **Done** — the prompt now separates what the pipeline guarantees from what it doesn't, and states every target as a hard number.

---

## Appendix — how the numbers were measured

All figures are from running the live code, not estimates:

- Catalog counts, macro consistency, and tag disagreements: script over `src/data/mealDatabase.js` using the app's own `validateMacroCalorieConsistency`.
- Shortlist yields: `generateFilteredShortlists` invoked directly for a 7-day window, both goals, empty history.
- Protein-band and carb-cap figures: exhaustive enumeration of all breakfast×lunch×dinner combinations from the filter's own shortlists for a single day (1,820 combos for `high_protein`, 4,732 for `standard`).
- Test results: `npm run test:logic` → 25 pass, 4 fail (all in `tests/planner.regression.test.js`, all "total protein out of range" or custom-meal-count).
