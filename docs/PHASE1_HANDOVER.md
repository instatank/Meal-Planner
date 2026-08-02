# Phase 1 Handover — Fix the Generation Engine

**Status:** Ready to build. Nothing implemented yet.
**Branch:** `claude/meal-planner-eval-refine-o5jrt9`
**Prerequisite reading:** `docs/EVAL_AND_ROADMAP.md` (the full audit), then `CLAUDE.md`.

---

## 1. Why this work exists

An audit (see `docs/EVAL_AND_ROADMAP.md`) measured the live generation pipeline and found that **no component enforces daily macro totals**. The deterministic filter has a bug that disables half its rules, the prompt tells Claude the constraints are already handled when they aren't, and there is no validation after generation.

Measured, for the `high_protein` goal (132g/day target):

| Measurement | Result |
|---|---|
| Legal breakfast+lunch+dinner combinations | 1,820 |
| In the 119–145g protein band | 628 (**34.5%**) |
| Breaking the 130g carb cap | 335 (**18.4%**) |
| Rejected by the system | **0** |

**Phase 1 fixes the ruleset and the engine that runs it. Nothing else.**

---

## 2. Decisions already made by the founder — do not relitigate these

These came from reviewing the audit. They are settled.

### 2.1 Aim daily, judge weekly — this is the core mental model

Perfection per-day is explicitly **not** the goal. The founder's words:

> *"we DO want to aim for the daily protein targets, but we don't HAVE TO MEET EVERY SINGLE DAY. As long as the week is working fine, a couple of exception days are acceptable. So it's sort of a two-step filtering process."*

Read that literally — it defines the architecture:

- **Step 1 — aim daily.** Every day is *targeted* at the daily protein goal. The optimizer always tries to hit the band.
- **Step 2 — judge weekly.** A week is accepted or rejected on **weekly** performance, not on every day passing. Up to **2 of 7 days may fall out of band**, and those days are allowed to be **genuinely flexible — low floors, not near-misses.**

The unit of success is the week. A day that misses is not a failure; a week that misses is.

Specifics:

- **Protein — needs tightening.** 2-in-3 days missing is too much. Acceptable is **up to 20–25% of days off-target, i.e. a maximum of 2 miss days in a 7-day week.** Those are deliberate "cheat/treat" days.
- **Flex days are properly flexible.** The founder explicitly asked for **low floors** on those 1–2 days. Do not impose a tight per-day minimum on them (an earlier draft proposed 105g — **that has been rejected**). See §3 Tier 1 for what replaces it.
- **Carbs — current miss rate is acceptable.** ~1 in 5 days over the cap is fine. Do **not** tighten this; do not let it crowd out protein adherence.

### 2.2 Scope is Phase 1 only

Database repair and expansion (Phase 2 in the roadmap) is **explicitly deferred**. Do not:
- add meals to the catalog
- retire `csvTagsMap` or re-derive tags
- add fibre grams, sodium, prep time, or cost
- touch the user-added-meals feature

Work within the existing 41 meals. If a rule can't be satisfied with the current catalog, that's a finding to report — not a reason to add meals.

---

## 3. The rule model to build

Replace the current flat "filter" concept with three explicit tiers. This is the central design decision of Phase 1.

### Tier 1 — Hard (never violate; a plan containing one is invalid)

- Per-meal protein floor (currently 20g for `high_protein`, 12g for `standard`)
- No meal appearing twice on the same day
- Weekly repetition ceilings (breakfast ≤4, lunch/dinner ≤2) — **counted against the week being generated**, which today it is not
- Weekly red-meat cap (3 for `high_protein`, 4 for `standard`)
- User avoids with score > 3
- **Weekly protein total ≥ 85% of nominal** (nominal = 7 × daily target; for `high_protein` that is 7 × 132 = 924g, so the floor is **≈785g**)
- A sanity-only per-day protein floor of **50g** — this exists to catch a pathological day, not to constrain treat days

**There is deliberately no meaningful per-day floor on flex days.** The weekly total is what guarantees the week is sound. This is the direct implementation of "as long as the week is working fine": two genuinely low days are fine *provided the other five compensate*, and the weekly floor is what forces that compensation. A per-day floor and a weekly floor would double-constrain the same thing, and the per-day one is what the founder rejected.

### Tier 2 — Budgeted (violations allowed, but counted and capped per week)

| Constraint | Budget |
|---|---|
| Daily protein in band (target ±10%; 119–145g for `high_protein`) | **≥5 of 7 days must be in band** |
| Daily carb cap (130g for `high_protein`) | **≥5 of 7 days must be under** |
| Daily calorie bounds (1600–2200 for `high_protein`) | ≥5 of 7 days within |

A week that blows a budget is invalid and must be repaired or retried.

### Where the 85% weekly floor comes from — and why it isn't higher

Measured against the current catalog (enumeration of all 1,820 legal `high_protein` day-combinations):

| Achievable daily protein | Value |
|---|---|
| Minimum | 64g |
| 25th percentile | 101g |
| Median | 112g |
| 90th percentile | 131g |
| Maximum | 155g |
| Mean of in-band combos | 127.6g |

Note the maximum is misleading: the 150g+ combinations reach that only by serving the same dish twice in one day, which Tier 1 forbids. **A realistic strong day is ~128–132g, not 140g.**

Weekly totals that follow:

| Scenario | Weekly total | % of nominal (924g) |
|---|---|---|
| 5 days @ 128g + 2 days @ 60g | 758g | 82% |
| 5 days @ 132g + 2 days @ 70g | 800g | 87% |
| 5 days @ 132g + 2 days @ 90g | 840g | 91% |
| 5 days @ 132g + 2 days @ 105g | 870g | 94% |

**This is the trade-off, stated plainly:** genuinely low flex days and a 90%+ weekly total are mutually exclusive on a 41-meal catalog. The founder chose low flex days, so the weekly floor is set at **85%** to match. Anything higher silently re-imposes the per-day floor that was rejected.

The binding constraint is **breakfast** — only 5 of 7 breakfasts survive the 20g per-meal floor, and the best is 37g. That caps every day. Raising the weekly floor above 85% is a **Phase 2 outcome** (more high-protein breakfasts), not something to force in Phase 1.

> If a generated week comfortably clears 85%, report the actual figure — that is the evidence for where to set the floor once the catalog grows.

### Tier 3 — Scored (never reject; rank by these)

- Variety / distinct-meal count across the week
- Cuisine diversity, and lunch≠dinner cuisine on the same day
- Protein-family diversity (no chicken twice in a day)
- Fibre presence
- Dinner calorie tapering — **as a score, not a hard cut** (see §5.3)
- User preference scores from `mealEvents`
- Anti-greedy: prefer least-used meals

---

## 4. Work items

### 4.1 Create a single source of truth for rules

New module (suggested `src/lib/rules.js`) exporting per-goal constraint definitions split into the three tiers above. It must be consumed by `plannerGenerator.js`, the filter/optimizer, and the validator. **Delete the duplicated thresholds** from `plannerGenerator.js` and `constraintFilter.js` — today they disagree (see the audit's §3.4 table).

Also reconcile the goal enums while here: onboarding defines five goals (`high_protein`, `standard`, `low_carb`, `two_meals_day`, `vegetarian`), the filter knows two, and the data layer tags meals `two_meals` vs onboarding's `two_meals_day`. Do **not** implement the missing goals. Make unknown goals fail loudly instead of silently becoming `high_protein`.

### 4.2 Fix the filter → make it an optimizer

The current bug: `src/lib/constraintFilter.js:235` never commits a meal to `dayPlanSoFar`, so every daily accumulator stays zero and five of ten rules are dead code. Lunch shortlists come back **26/26 — nothing filtered**.

Given the budgeted-constraint model, a pure filter is now the wrong shape. Build a **scored search over whole days, then whole weeks**:

1. Enumerate feasible day-combinations (B/L/D) that satisfy Tier 1. The catalog is small enough that near-exhaustive enumeration is viable — the audit enumerated all 1,820 combos in milliseconds.
2. Score each day against Tier 2 (in-band or not) and Tier 3 (quality).
3. Select 7 days maximising quality subject to the Tier-2 weekly budgets. Beam search or greedy-with-backtracking is fine; this does not need to be optimal, it needs to respect the budgets.

Keep it deterministic and seedable so tests are stable.

### 4.3 Add a post-generation validator

There is currently **none** — despite `constraintFilter.js:153` claiming the calorie floor "is checked post-generation."

Validate the returned week against all three tiers and return structured violations. On failure: repair deterministically, or retry once feeding the violations back to the model. Never write an invalid week silently.

### 4.4 Constrain the tool schema

Meal names come back as free strings and are matched by lowercased exact match (`findMeal` in `App.jsx`); a near-miss silently falls back to the previous meal with no error. Replace the free-string fields in `SUBMIT_PLAN_TOOL` (`src/lib/planService.js`) with per-slot, per-day **`enum`** of legal meal names. Anthropic's schema layer supports `enum`, so a hallucinated name becomes structurally impossible.

### 4.5 Rewrite the prompt

`src/data/fallbackPrompts.js:100` and `:132` currently assert:

> "Every meal option below has ALREADY been verified to satisfy all nutritional constraints... You do NOT need to check any of these."

Three of the six named constraints are unchecked. Either make it true (via 4.2) or delete it. Also:
- State actual numeric targets — research shows hard numbers ("hit 132g protein") outperform soft adjectives ("high protein") for LLM constraint adherence.
- Remove the vestigial `OUTPUT FORMAT — strictly valid JSON` block; structured output handles shape now.
- Make clear which days, if any, are permitted off-band days.

### 4.6 Decouple the dinner taper

The `high_protein` goal wants 132g/day, but the taper excludes every `Heavy` meal from dinner — removing the three highest-protein dishes in the catalog (61g, 56g, 46g). The goal fights its own rules.

Make tapering **calorie-based and scored** (Tier 3), not a hard exclusion on a hand-typed weight label.

### 4.7 Model upgrade — do this LAST, as its own commit

Currently pinned to `claude-sonnet-4-6`. Recommend **`claude-sonnet-5`**.

> ⚠️ **`api/generate-plan.js` always sends `temperature` (default 0.7, set in `planService.js:143`). Sonnet 5 and Opus 5 reject non-default sampling parameters with a 400.** A model-string swap alone breaks the endpoint. `temperature` must be removed in the same commit. Use `output_config: { effort: ... }` if a quality/cost dial is needed.

Sonnet 5 uses a new tokenizer (~30% more tokens for the same text) — re-baseline cost before reacting to the numbers.

**Sequence this last and separately** so the rules work isn't confounded by a model change. Get the deterministic engine correct on the current model first.

---

## 5. Acceptance criteria

Phase 1 is done when all of these hold:

1. A generated 7-day `high_protein` week has **≥5 of 7 days** with total protein in 119–145g.
2. The **weekly protein total is ≥785g** (85% of nominal). This is the constraint that makes flex days safe — verify it explicitly, not by inference from the daily numbers.
3. No day falls below the 50g sanity floor. Flex days are otherwise unconstrained — **a 70g day is a pass, not a bug.**
4. **≥5 of 7 days** under the 130g carb cap and within 1600–2200 kcal.
5. No Tier-1 violation appears in any generated week.
6. Weekly repetition and red-meat caps are counted **against the generated week**, not just history.
7. The validator runs on every generation and surfaces violations rather than writing silently.
8. `plannerGenerator.js`, the optimizer, and the validator all read thresholds from one module.
9. **`npm run test:logic` is fully green** — the 4 known failures in `tests/planner.regression.test.js` (tests 12, 25, 26, 27, "total protein out of range: 147") should resolve once the rule engines are unified. Note that the *weekly* model may legitimately invalidate a test that asserts a hard per-day protein range; if so, update the test deliberately and say which assumption changed and why.
10. New tests cover: weekly-total accounting, budget accounting, flex days passing at low protein, weekly repetition against the generated week, and validator repair/retry.

---

## 6. Landmines

- **Do not break the sync invariants.** `CLAUDE.md` documents three hard-won rules about `storageGet` / `saveToStorage` — never re-save on boot, treat future-dated timestamps as poisoned rather than clamping, await Firestore writes in the regen flow. Phase 1 touches the regen flow; leave the persistence semantics alone.
- **Two generation paths exist.** `plannerGenerator.js` runs on goal-change and onboarding; the AI path runs on "regenerate rest of week." Both must end up on the unified rules, or the app keeps producing plans under two rulebooks.
- **Vercel Hobby caps functions at 10s** regardless of `maxDuration: 60`. Smaller shortlists from a working optimizer help, but this stays a live risk.
- **Anthropic bills failed requests** if generation started. Inspect `console.error('[planService] proxy returned non-OK:', ...)` or Vercel logs for the real error body before retrying.
- **The auto-generation `useEffect` hooks are deliberately disabled** (`if (false)`). Keep them off.
- **`node_modules` is not installed** in a fresh environment. Tests are plain `node --test` over pure-JS modules and run without deps; `npm install` is only needed for build/dev.

---

## 7. Suggested commit sequence

1. `src/lib/rules.js` + tests — single source of truth, no behaviour change yet
2. Repoint `plannerGenerator.js` at `rules.js`; delete its local thresholds
3. Replace `constraintFilter.js` with the scored day/week optimizer + tests
4. Add the validator + repair/retry path + tests
5. Tool-schema `enum` constraint in `planService.js`
6. Prompt rewrite in `fallbackPrompts.js`
7. Dinner taper → scored
8. *(separate)* Model upgrade to `claude-sonnet-5` **and remove `temperature`**

---

## 8. Report back

On completion, state plainly:
- Measured adherence of a generated week against each acceptance criterion (re-run the audit method — enumerate combinations, don't estimate)
- **The actual weekly protein total achieved**, as a percentage of nominal. If it clears 85% comfortably, say by how much — that is the evidence for raising the floor after Phase 2.
- Any rule that the current 41-meal catalog **cannot** satisfy — the evidence base for prioritising Phase 2
- Any test whose assumptions were changed, and why

**No open questions remain.** All rule thresholds in §3 are settled; build against them. If the build surfaces a genuine conflict between two settled rules, report it rather than picking a winner.
