# Phase 2 Handover — Repair and Expand the Meal Database

**Status:** Ready to build. Nothing implemented yet.
**Prerequisite reading:** this file, then `CLAUDE.md` (especially "The rule model" and the sync invariants), then `docs/EVAL_AND_ROADMAP.md` §4.
**Prior work:** `docs/PHASE1_HANDOVER.md` — read §9 for what shipped and what it measured. §3 of the roadmap describes code that no longer exists.

---

## 1. Why this work exists

Phase 1 made the rules real. A generated week now satisfies every Tier-1 rule,
stays inside all three Tier-2 budgets, and is validated and repaired before it is
written. The engine is correct.

**That makes the catalog the binding constraint.** With 41 meals, the rules are
satisfiable but only barely:

| Measurement (high_protein, all 3,250 legal day combinations enumerated) | Result |
|---|---|
| Combinations reaching the 1600 kcal floor | **638 (19.6%)** |
| Combinations satisfying all three Tier-2 budgets at once | **30 (0.9%)** |
| Legal breakfasts for 7 days | **5** (best 37g protein) |
| Lunch/dinner cuisine spread | 13 Indian / 10 Continental / **3 Asian** |
| Generated week's calorie compliance | **5 of 7 — exactly the minimum** |

Reproduce all of it with `npm run audit:generation`.

The generated week passes, but with no slack on calories. Phase 2 is about
buying that slack — and it is the highest-leverage work left in the project.

---

## 2. The single most useful measurement in this document

Before writing any code, understand this. It changes what "add more meals" means.

I measured three catalogs against the live engine:

| Catalog | Combos | Reach 1600 kcal | Satisfy all 3 budgets | Generated week (P/C/K of 7) | Weekly protein |
|---|---|---|---|---|---|
| **Baseline** (41 meals) | 3,250 | 638 (19.6%) | 30 (**0.9%**) | 7 / 5 / 5 | 885g (95.8%) |
| **+ the two 19g breakfasts made legal** | 4,550 | 1,528 (33.6%) | 32 (**0.7%**) | 7 / 6 / 5 | 877g (94.9%) |
| **+ 3 hypothetical 38–45g, 520–590 kcal, ≤55g-carb breakfasts** | 5,200 | 1,724 (33.2%) | 158 (**3.0%**) | **7 / 7 / 7** | **918g (99.4%)** |

Read the middle row carefully. `Aloo paratha + curd` (19g protein, 685 kcal) and
`Idli, Mysore masala dosa + sambar` (19g, 624 kcal) are each **1g of protein**
below the per-meal floor. Making them legal more than doubles calorie-compliant
days — and the joint compliance rate *falls*, because both carry **96g of carbs**
and blow the daily carb cap instead.

**So the lesson is not "add high-protein breakfasts."** It is:

> The catalog needs breakfasts that are high-protein **and** calorie-dense
> **and** moderate-carb, simultaneously. Roughly **35–45g protein, 500–600 kcal,
> ≤55g carbs.** Three of those take the generated week from 7/5/5 to **7/7/7**
> and weekly protein from 95.8% to 99.4% of nominal.

Optimising any one axis alone moves a budget and breaks another. This is the
whole shape of Phase 2, and it is why "expand toward ~120 meals" is not by
itself a specification.

---

## 3. Work items, in leverage order

### 3.1 Add breakfasts against the measured spec *(highest leverage)*

Target the envelope in §2: ~35–45g protein, ~500–600 kcal, ≤55g carbs. Five or
six such meals should be enough to give every budget real slack.

Use `npm run audit:generation` as the acceptance test after each addition — it
enumerates rather than estimates, and it exits non-zero if a criterion fails. Do
not trust intuition about whether a meal helps; the middle row of the §2 table is
exactly the intuition that fails.

**Do not lower the 20g per-meal protein floor to make the two 19g breakfasts
legal.** That is the founder's settled Tier-1 rule, and the table shows it would
not buy joint compliance anyway. If you want those two dishes in the plan,
reformulate them (add eggs, paneer, or a shake) so they clear the floor on
merit — that is a data change, not a rule change.

### 3.2 Derive tags from ingredients instead of hand-typing them

`csvTagsMap` in `src/data/mealDatabase.js` hand-maintains tags alongside computed
macros, and they disagree. Measured against the current catalog:

| Tag | Disagreements | Rule compared against |
|---|---|---|
| `is_fat_heavy` | **12 of 41** | computed fat > 25g |
| `has_fibre` | **10 of 41** | any fibre-bearing ingredient in `parts[]` |
| `meal_weight` | **3 of 41** | calorie thresholds (>600 Heavy, ≥350 Medium) |

Examples: *Mutton keema + jowar roti* is 34g fat and tagged `is_fat_heavy: false`;
*Chicken red curry* is 14g fat and tagged `true`; *Scrambled eggs + toast* is
tagged `has_fibre: false` despite whole-wheat toast.

The `has_fibre` count is method-dependent — the original audit said 11, I measure
10 with a slightly different ingredient heuristic. **That discrepancy is the
point:** the derivation rule has to be chosen deliberately and written down, not
inferred. Choose it, encode it, delete the hand-typed field.

Note that `meal_weight` is now **display/reporting only** — Phase 1 made dinner
tapering calorie-based, so nothing in the engine reads that label any more. It is
the cheapest of the three to fix and the least urgent.

Keep hand-tags only for genuinely subjective fields: `cuisine`, effort, user
preference.

### 3.3 Fibre in grams

`has_fibre` is a yes/no flag; there is no fibre figure anywhere. The ingredient
table (`src/data/ingredients.js`, 52 ingredients) carries only `kcal`, `p`, `c`,
`f`. For an app whose Tier-3 scoring cares about fibre, a boolean is thin.

IFCT 2017 has fibre for Indian foods and is free and offline
(`@nodef/ifct2017`); USDA FoodData Central covers the Continental and Asian
items. Add `fibre` to `per100g`, then let `computeMacros` roll it up like every
other macro. Same mechanism for sodium if it is wanted later.

### 3.4 Cuisine and slot coverage

Lunch/dinner is 13 Indian / 10 Continental / **3 Asian**. The prompt asks the
model to "mix Indian, Continental and Asian through the week" and there are three
Asian dishes to do it with. Tier-3 scoring rewards cuisine variety it cannot
actually achieve.

### 3.5 Expand toward ~120 meals

The roadmap's original target. Do it **after** 3.1–3.4, and keep re-running the
audit — a bigger catalog that does not widen the binding budget is churn. Watch
the optimizer's runtime as the catalog grows (currently ~266ms over 3,250
combinations, capped at 960 candidates by `trimCandidatePool`); enumeration is
`breakfasts × lunchDinner²`, so it grows quadratically in the lunch/dinner pool.

---

## 4. Decisions the founder needs to make — do not guess these

Phase 1 arrived with every threshold settled. Phase 2 does not. These are
genuine product questions and the answers change the work:

1. **Where do new meals come from?** Hand-authored by the founder, or is Phase 3
   (user-added meals, roadmap §5) pulled forward so the catalog grows through
   use? The roadmap argues for the latter — "that feature isn't a nice-to-have,
   it's the growth path for the database."
2. **How much reformulation is acceptable?** Several existing meals are one small
   change from clearing a floor. Is editing an existing meal's ingredients in
   scope, or is Phase 2 additive only?
3. **Fibre in grams — worth the ingredient-table work now, or defer?** It is the
   most invasive of the data changes and nothing currently depends on a number.
4. **Do the three unimplemented goals get built or removed?** `low_carb`,
   `two_meals`, `vegetarian` are declared in onboarding and UI-disabled;
   `getRules` throws `UnsupportedGoalError` for them by design. Phase 1
   deliberately left them failing loudly rather than silently becoming
   `high_protein`. Vegetarian in particular is cheap to add once the catalog is
   bigger.
5. **Once the catalog widens, raise the weekly protein floor above 85%?** The
   hypothetical catalog in §2 hits 99.4% of nominal. The floor exists because 5
   legal breakfasts capped every day; when that stops being true, 85% is
   leaving quality on the table. Do not raise it before the catalog moves — see
   the warning in §6.

---

## 5. Acceptance criteria

Phase 2 is done when:

1. `npm run audit:generation` reports **≥6 of 7 days** in calorie bounds (up from
   the current 5, which is the bare minimum) without regressing protein or carbs.
2. The share of legal day combinations satisfying all three Tier-2 budgets is
   **materially above 0.9%** — target ≥3%, which the §2 modelling shows is
   reachable with three well-chosen breakfasts.
3. **≥8 legal breakfasts** for 7 days, with at least three above 35g protein.
4. `is_fat_heavy`, `has_fibre` and `meal_weight` are **derived, not typed**, with
   the derivation rule documented; `csvTagsMap` retains only subjective fields.
5. Lunch/dinner Asian coverage is **≥6 dishes**.
6. `npm run test:logic` is **fully green** (currently 102 tests).
7. Every meal still passes the macro↔calorie consistency check (currently
   **41 of 41** — this is a real asset, protect it).
8. New tests cover the tag-derivation rules and assert `csvTagsMap` no longer
   carries derived fields.

---

## 6. Landmines

- **Do not change any threshold in `src/lib/rules.js` to make the catalog fit.**
  The three tiers are the founder's settled model and Phase 1 is measured against
  them. If a rule genuinely cannot be satisfied after the catalog grows, that is
  a finding to report — the same way the hard dinner taper was reported and
  removed in Phase 1 *with the measurement that justified it*.
- **Raising the weekly protein floor is tempting and premature.** A generated
  week clears 785g by 100g, but the calorie budget passes at exactly the minimum.
  The two trade against each other in the same small pool. Move the floor only
  after the audit shows slack on *all three* budgets.
- **`npm run db:pack` regenerates derived artifacts** under `database/` and
  `exports/`. Run it after catalog changes or those files drift.
- **Do not break the sync invariants.** `CLAUDE.md` documents three hard-won
  rules about `storageGet` / `saveToStorage`. Phase 2 should not touch the
  persistence layer at all — if you find yourself there, stop and re-read them.
- **`buildPromotedCustomMeal` in `App.jsx` still assigns hardcoded macros** to
  user-added meals (`{p: 24, c: 42, f: 14}` for every lunch/dinner). Those
  fabricated numbers clear the 20g protein floor and flow straight into the
  optimizer, which now *trusts* its inputs completely. Phase 1 made the engine
  rigorous; this path feeds it invented data. Either fix it in Phase 2 or leave
  it disabled — do not leave it live alongside a catalog people are told is
  measured.
- **`node_modules` is not installed in a fresh environment.** Tests, the audit
  and `db:pack` are plain Node over pure-JS modules and run without deps;
  `npm install` is only needed for build/dev.
- **The auto-generation `useEffect` hooks are deliberately disabled**
  (`if (false)`). Keep them off.
- **`main` auto-deploys to Vercel production.** Develop on a
  `claude/<description>` branch.

---

## 7. Suggested commit sequence

1. Fibre (and optionally sodium) added to `src/data/ingredients.js` + tests
2. Tag derivation (`is_fat_heavy`, `has_fibre`, `meal_weight`) + tests; strip
   derived fields from `csvTagsMap`
3. New breakfasts against the §2 spec, one commit, with before/after audit output
   in the commit message
4. Asian lunch/dinner coverage
5. Broader catalog expansion toward ~120 meals
6. *(only if the audit shows slack on all three budgets)* raise the weekly
   protein floor in `rules.js`, with the measurement that justifies it

---

## 8. Report back

State plainly, measured by re-running `npm run audit:generation`:

- Before/after for each figure in the §1 table
- The final acceptance-criteria table from the audit
- Which meals were added and why each one was chosen (which budget it targets)
- The derivation rule chosen for each tag, and how many meals changed value
- Any rule the expanded catalog still cannot satisfy
- Any test whose assumptions changed, and why
