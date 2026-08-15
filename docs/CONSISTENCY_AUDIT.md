# Consistency Audit — facts with more than one home

Read-only audit, 2026-08-13. Nothing was changed in the audit pass itself.

> **Status, 2026-08-15.** Findings **1, 2, 5 and 6 are fixed** and shipped; each
> is marked ✅ below with what changed. Findings **3, 4 and 7–14 remain open**,
> including two that still disagree in production: the two independent red-meat
> classifiers (#3) and name-based fibre scoring that contradicts measured grams
> on 14 meat meals (#4). Measurements throughout this document were taken
> *before* the fixes and are left as recorded, so the reasoning stays auditable.
>
> One fix carried a deliberate behaviour change on top of the deduplication:
> **`high_protein`'s daily protein target moved 132g → 120g** by founder
> decision, so the band (now 108–132g), weekly nominal (840g) and weekly floor
> (714g) moved with it.

**Method.** Every claim below was checked against the running code, not read off
comments. Where a divergence could be counted, it was counted by executing the
real modules against the real catalog (110 meals, 92 ingredients). Numbers in
the "Current values" rows are what the code produces today, not what the
comments say it produces.

**Baseline.** `npm run test:logic` — 130 tests, all passing. Every divergence in
this document is invisible to the suite: none of them fails a test today.

**Ranking.** By blast radius — how much of a user's plan is wrong, or silently
different from what they asked for, when the copies drift. Findings 1–6 already
disagree in production. Findings 7–14 agree today and are ranked on what breaks
when someone edits one copy.

| # | Concept | Homes | Agreed at audit time? | Status |
| --- | --- | --- | --- | --- |
| 1 | Which goal the user chose | 4 | **No** — one path discards it | ✅ fixed |
| 2 | Daily protein target | 7 | **No** — 80 vs 100 for `standard` | ✅ fixed |
| 3 | Protein family / red meat | 3 classifiers | **No** — 2 meals | open |
| 4 | Fibre | 4 | **No** — 14 meat meals mis-scored | open |
| 5 | Cuisine | 2 + 2 casings | **No** — 29 meals, 1 dead feature | ✅ fixed |
| 6 | Which meal an event refers to | 5 field names | **No** — 3 signals dropped | ✅ fixed |
| 7 | Rules stated to the model | prompt + validator | Partial | open |
| 8 | "Heavy" / "carb-heavy" meal | 2 each | **No** — 3 and 9 meals | open |
| 9 | Thresholds outside `rules.js` | ~20 | Agree (by luck) | open |
| 10 | Slot list | 6 | Agree | open |
| 11 | Week length | 6 | Agree | open |
| 12 | History lookback window | 3 | **No** — 7 / 10 / 14 days | open |
| 13 | One egg | 2 | **No** — 38% kcal apart | open |
| 14 | The catalog itself | 4 artifacts | **No** — one is 72 meals stale | open |

---

## 1. Which goal the user chose

> ✅ **Fixed.** `App.jsx` forwards `goal: goalOverride` into the shared day
> generator; `onboardingProfile.js` takes its ids from `rules.js` `GOAL` instead
> of declaring a parallel enum (legacy `two_meals_day` still accepted and
> canonicalized on read); the adapter normalizes before comparing. Guarded by
> `tests/onboarding.goalRouting.test.js`.

Highest blast radius in the codebase: an entire goal is planned under the wrong
rulebook on one of the two generation paths, and the parameter that would fix it
is accepted and then dropped.

**Copies**

| Location | What it holds |
| --- | --- |
| `src/lib/onboardingProfile.js:8-14` | `ONBOARDING_GOAL` — `high_protein`, `standard`, `low_carb`, **`two_meals_day`**, `vegetarian` |
| `src/lib/rules.js:33-39` | `GOAL` — same list but **`two_meals`** |
| `src/lib/rules.js:54-59` | `GOAL_ALIASES` — the reconciliation table (`two_meals_day → two_meals`) |
| `src/lib/onboardingPlannerAdapter.js:26,53,57,62,64` | compares against `ONBOARDING_GOAL.*` **raw**, never through `normalizeGoalId` |
| `src/App.jsx:284-297` | `generatePlanForDate(dateKey, plans, preferences, goalOverride)` — accepts `goalOverride`, forwards `preferences` and `dailyProteinTarget`, **never forwards `goal`** |

**Current values.** `rules.js` owns the canonical vocabulary and a working
alias table. Nothing outside `rules.js` uses it: the adapter branches on the
onboarding spellings directly, and `App.jsx` drops the goal entirely on the
per-day path.

**Do they agree?** No.

`src/App.jsx:291-297` calls `plannerGeneratePlanForDate({ dateKey, plans,
preferences, dailyProteinTarget, mealDatabase })` — no `goal` key. Downstream,
`plannerGenerator.js:134` calls `getRulesForProfile(undefined, …)`, which
`rules.js:428-429` resolves to **`high_protein`**. Both callers are affected:

- `src/App.jsx:646` — backfilling past days with no plan.
- `src/App.jsx:860` — `regenerateCurrentWeekForGoal(goal)`, which exists
  specifically to rebuild the week when the user changes goal, and passes the
  new goal to a function that throws it away.

So a `standard` user's days are built under `high_protein` Tier 1 and Tier 2:

| Rule | Applied (`high_protein`) | Intended (`standard`) |
| --- | --- | --- |
| `minMealProtein` | 20g | 12g |
| `dailyCarbCap` | 130g | `Infinity` |
| calorie bounds | 1600–2200 | 1800–2400 |
| `maxBreakfastRepeatsPerWeek` | 4 | 3 |
| `redMeatMealsPerWeek` | 3 | 4 |

…while the protein target passed alongside is the `standard` one. The day is
judged by two goals at once.

There is a second, quieter consequence: `getRules` was deliberately built to
**throw** `UnsupportedGoalError` for `low_carb` / `two_meals` / `vegetarian`
("silently falling back to `high_protein` is how a vegetarian used to get a week
of chicken" — `rules.js:373-376`). On this path the goal never reaches
`getRules`, so the throw cannot fire and the fallback happens anyway. The guard
is bypassed by the caller it was written to protect against.

**What breaks when they drift.** Adding a sixth goal, or renaming one, requires
edits in three vocabularies. A goal added to `ONBOARDING_GOAL` but not to
`GOAL_ALIASES` silently becomes `high_protein` on the week path (via
`getRulesForProfile`'s empty-string fallback) and unconditionally
`high_protein` on the day path.

**Authoritative home.** `rules.js` — `GOAL`, `GOAL_ALIASES`, `normalizeGoalId`.
`onboardingProfile.js` should import `GOAL` rather than declare a parallel enum;
the adapter should call `normalizeGoalId(goal)` before comparing; `App.jsx:291`
should forward `goal: goalOverride`.

---

## 2. Daily protein target

> ✅ **Fixed.** `rules.js` is the sole declaration: `high_protein` **120g**
> (moved from 132 by founder decision), `standard` 100g. The adapter's ratchet,
> flat `standard = 80` and `Math.min` ceiling are deleted, and App.jsx's two
> `120` literals are gone. `ingredients.js`'s unread `daily_protein_target_g:
> 130` was deliberately left — it is a seventh home but is read by nothing.
> Guarded by `tests/protein.target.source.test.js`.

Seven homes. The `high_protein` figure agrees at 132 only because three
independently-derived numbers happen to be equal; the `standard` figure does not
agree at all.

**Copies**

| Location | Value | Role |
| --- | --- | --- |
| `src/lib/rules.js:203` | **132** | `high_protein` `defaultDailyProteinTarget` |
| `src/lib/rules.js:261` | **100** | `standard` `defaultDailyProteinTarget` |
| `src/lib/onboardingPlannerAdapter.js:13,63` | **132** | `HIGH_PROTEIN_DAILY_TARGET`, applied as `Math.max(target, 132)` |
| `src/lib/onboardingPlannerAdapter.js:65` | **80** | `standard` — a flat assignment, not a floor |
| `src/lib/onboardingPlannerAdapter.js:68` | **132** | `Math.min(target, DAILY_PROTEIN_MAX)` ceiling |
| `src/lib/plannerGenerator.js:43-47` | **120** → band 108–132 | `DEFAULT_RULES`, the source of `DAILY_PROTEIN_MAX` above |
| `src/App.jsx:728`, `src/App.jsx:1568` | **120** | literal passed into the adapter by both week-generation paths |
| `src/data/ingredients.js:30` | **130** | `userProfile.daily_protein_target_g` — read by nothing |

**Current values (measured).**

```
high_protein: adapter 120 → max(120,132) → min(132,132) → 132 ✓ matches rules.js
standard:     adapter 120 → 80          → min(80,132)  → 80  ✗ rules.js says 100
weekly protein floor, standard: 476g actual vs 595g if rules.js were authoritative
```

**Do they agree?** For `high_protein`, yes — but by coincidence. Three distinct
concepts all evaluate to 132: the goal's target (`rules.js:203`), the adapter's
floor (`adapter:13`), and the **band maximum of a different target** — `Math.min(…,
DAILY_PROTEIN_MAX)` where `DAILY_PROTEIN_MAX` is `round(120 × 1.1)`
(`plannerGenerator.js:47`). That last one is a category error: a *band edge* for
a 120g target is being used as a *ceiling on the target itself*. Change
`rules.js:203` to 140 and the adapter's floor still says 132 while the ceiling
still clamps to 132 — the new target never takes effect.

For `standard`, they already disagree: 80 vs 100, a 119g/week difference in the
protein floor.

**What breaks when they drift.** The user has no UI to set a protein target at
all (`grep` finds no such control), so today every one of these is a developer
constant. The moment a target becomes user-settable, `Math.max` prevents lowering
it below 132 and `Math.min` prevents raising it above 132 — the setting would be
inert in both directions on the goal it matters most for.

**Authoritative home.** `rules.js` — `GOAL_DEFINITIONS[goal].defaultDailyProteinTarget`,
resolved through `getRules({ dailyProteinTarget })`, which already clamps
sensibly (`rules.js:382-385`). The adapter's three numbers and
`plannerGenerator.js`'s back-compat exports should be deleted rather than
reconciled. `ingredients.js:30` (130) and `estimated_tdee_kcal: 2400` — note the
latter sits above the 2200 kcal ceiling the same user is planned to — are dead
and should go with them.

---

## 3. Protein family and red meat — three classifiers

The exact pair the brief names, plus a third the brief did not.

**Copies**

| Location | Mechanism | Emits |
| --- | --- | --- |
| `src/lib/planOptimizer.js:51-59,75-85` | `FAMILY_PATTERNS` regex, after a `tags.protein_family` lookup | `fish` / `chicken` / `red_meat` / `vegetarian` |
| `src/lib/planOptimizer.js:61-65` | `FAMILY_COUNT_PATTERNS` — a **fourth**, subtly different copy (no `ham`) used only by `hasRepeatedFamilyInsideMeal` | counts |
| `src/lib/mealDataLayer.js:81-114` | `inferProteinFamily` — the nuanced one (`keema`/`kofta` disambiguation) | + `mixed` |
| `src/lib/rules.js:135-140` | `ANCHOR_FAMILY` — a hand-listed ingredient set, comment says "kept in step with `isRedMeat`" | `red_meat` family |

Both red-meat mechanisms are live and independent:
`planOptimizer.isRedMeat` (`:85`) feeds `redMeatMealsPerWeek`
(`planOptimizer.js:640`, `planValidator.js:244-255`); `ANCHOR_FAMILY`'s
`red_meat` feeds `anchorFamilyMaxPerWeek` (`planOptimizer.js:629`,
`planValidator.js:226-242`). `rules.js:170-181` wires the second to the first's
number, which prevents the *limits* diverging but not the *membership*.

**Current values (measured against the live catalog).**

```
getProteinFamily distribution: vegetarian 47, chicken 32, fish 21, red_meat 9, mixed 1
isRedMeat: 9 meals    ANCHOR_FAMILY red_meat: 8 meals
disagreement: "Boiled eggs + ham sandwich" — red_meat by family, `egg` by anchor
"Chicken soup + smoked salmon salad" — `mixed` (data layer) vs `fish` (optimizer fallback)
```

**Do they agree?** No, on two meals, in two different ways.

1. *Ham sandwich.* Its protein family is `red_meat` (one ham slice matches the
   regex) so it spends 1 of the 3 weekly red-meat meals; its anchor ingredient is
   `egg_whole` (eggs out-protein the ham slice) so it spends `egg` budget, not
   `red_meat` budget. One meal, two ledgers, neither aware of the other. Today
   this over-restricts. Reverse the protein split on a future meal and it
   under-restricts instead.
2. *`mixed`.* `mealDataLayer` can emit `mixed`; `planOptimizer` has no such
   value. `isRedMeat` (`:85`) tests `=== 'red_meat'` and `isPrimaryMeat` (`:87`)
   tests membership of `['fish','chicken','red_meat']` — a `mixed` meal fails
   both. It is therefore excluded from the red-meat cap, from the within-day
   protein-family diversity penalty, and from the "meat meals should carry
   fibre" rule. Today the only `mixed` meal is chicken + salmon, so nothing
   escapes a cap. **A beef-and-chicken dish would be tagged `mixed` and would
   not count as red meat at all** — the cap would silently stop applying to it.

**What breaks when they drift.** A red-meat ingredient added to `ingredients.js`
and used in a meal is caught by the regex only if its name appears in the meal
title, and by the anchor cap only if someone remembers to add it to
`ANCHOR_FAMILY`. The two failure modes are independent, so a new ingredient can
be caught by neither.

**Authoritative home.** `mealDataLayer.inferProteinFamily`, materialised once
onto `tags.protein_family` at catalog build time (it already is —
`mealDatabase.js:2235-2246` runs `enrichMealForDataLayer`). `planOptimizer`
should read the tag and drop `FAMILY_PATTERNS`/`FAMILY_COUNT_PATTERNS`
altogether, and must handle `mixed` explicitly. `ANCHOR_FAMILY.red_meat` should
be derived from the family tag rather than hand-listed.

---

## 4. Fibre — inferred by name where grams exist

The clearest instance of the brief's item 3, and it is not confined to the
fallback path: the name heuristic runs on every meal in the catalog, measured or
not.

**Copies**

| Location | Mechanism |
| --- | --- |
| `src/lib/planOptimizer.js:67-69,89-96` | `getFibreScore` — three regexes over name + components |
| `src/lib/planOptimizer.js:105-109` | `hasFibre` — grams first (`macros.fibre >= 3`), name heuristic only as fallback |
| `src/lib/mealDataLayer.js:142` | `deriveHasFibre` — grams, materialised onto the `has_fibre` field |
| `src/lib/planService.js:106` | `has_fibre: !!m.has_fibre` — reads the raw field, not the accessor |

`hasFibre` is careful and correct. `getFibreScore` is not, and it is the one
that runs unconditionally: `mealFacts` (`planOptimizer.js:167`) computes
`fibreScore` for every meal, and `scoreDayStandalone:415` uses it —
`if (meal.fibreScore < 1) meatWithoutFibreCount += 1` — to apply the
"meat meals should carry fibre" penalty (`:438`). Measured grams are never
consulted on that branch.

**Current values (measured).**

```
name heuristic vs measured grams, whole catalog: 31 of 110 disagree (28%)
restricted to meat meals (where the penalty applies): 14 disagree
  Grilled salmon + sweet potato + spinach   8.2g fibre  fibreScore 0  → penalised
  Cantonese steamed fish + edamame + rice   6.1g fibre  fibreScore 0  → penalised
  Prawn stir-fry + edamame + rice noodles   5.4g fibre  fibreScore 0  → penalised
  Thai pad krapow + rice                    1.6g fibre  fibreScore 1  → rewarded
  Oyakodon + side salad                     1.9g fibre  fibreScore 1  → rewarded
```

**Do they agree?** No — 14 meat meals are scored against the opposite of their
measured fibre. The penalty is `w.fibreBonus` (1.5 for `high_protein`, 3 for
`standard`) per meal, applied on top of the `+fibreCount * fibreBonus` bonus
that *does* read grams. So a high-fibre salmon dish collects the bonus and the
penalty simultaneously, netting zero, while a low-fibre stir-fry collects
neither and ranks above it.

**What breaks when they drift.** `FIBRE_MEAL_THRESHOLD` is documented at
`rules.js:316-334` with a measurement justifying 3g over 6g. Moving it changes
`hasFibre` and `deriveHasFibre` and does nothing to `getFibreScore`, so the two
halves of the same rule move apart. Separately, `mealDataLayer.js:67` still
carries a stale comment claiming "the `has_fibre` threshold sits at 5" — it is 3.

The `planService` copy adds a third behaviour: user-promoted meals
(`buildPromotedCustomMeal`, `App.jsx:1057-1081`) carry no `macros.fibre` and no
`has_fibre` field, so the optimizer scores them via the name heuristic while the
prompt is told `has_fibre: false` for the same meal.

**Authoritative home.** `macros.fibre` + `FIBRE_MEAL_THRESHOLD`, via
`hasFibre`. `getFibreScore` should be deleted and `:415` should test
`meal.fibre`. `planService.js:106` should call `hasFibre(m)`.

---

## 5. Cuisine — two homes inside one file, and two casings

> ✅ **Fixed.** All 77 shadowed inline `"cuisine"` keys removed and
> `handAuthoredTags` lowercased, making the map canonical at source. Verified
> casing-only: the resolved cuisine for all 110 meals is byte-identical before
> and after. This revived the dead "Indian" quick action without touching
> App.jsx. Guarded by `tests/cuisine.source.test.js`.

**Copies**

| Location | What it holds |
| --- | --- |
| `src/data/mealDatabase.js:408,425,443,…` (77 meals) | inline `"cuisine": "indian" / "western" / "asian"` — lowercase |
| `src/data/mealDatabase.js:2109-2226` | `handAuthoredTags` — 110 entries, `"Indian" / "Continental" / "Asian"` — capitalised |
| `src/data/mealDatabase.js:2235-2246` | `buildMeal` spreads `handAuthoredTags` **last**, so it wins |
| `src/lib/mealDataLayer.js:388` | `tags.cuisine` — the same value, lowercased |

**Current values (measured).**

```
meal.cuisine:  Continental 46, Indian 42, Asian 19, International 2, General 1  (capitalised)
tags.cuisine:  continental 46, indian 42, asian 19, international 2, general 1  (lowercase)
77 meals carry an inline cuisine; all 77 are overwritten by handAuthoredTags
29 of those 77 disagree in value, not just casing: inline "western" vs authored "Continental"
```

**Do they agree?** No, on both axes.

- The inline field is dead data that contradicts the live data on 29 meals. It
  uses a taxonomy (`western`) that the authoritative map does not
  (`Continental`). Anyone reading `mealDatabase.js` top-down sees the wrong
  value.
- `meal.cuisine` is `"Indian"`; `meal.tags.cuisine` is `"indian"`. Consumers
  split accordingly. `planOptimizer.getMealCuisine` (`:43`) lowercases before
  comparing, so the `cuisineBalanced` Tier-2 rule (`:352-354`) works.
  **`src/App.jsx:1310` does not:** `lunchMeals.filter((m) => m.cuisine === 'indian')`
  matches zero of 42 Indian meals, so the "Indian" quick action silently
  changes nothing. That is a user-visible feature that is broken right now,
  caused purely by this split.
- `src/lib/planService.js:104` sends `cuis: m.cuisine || 'general'` — the
  capitalised form — into the prompt, while `fallbackPrompts.js:122` asks the
  model to reason about "Indian+Indian" pairings. It happens to work because
  the model is case-insensitive; a code-side consumer of the same payload would
  not be.

**What breaks when they drift.** Any new meal added with an inline `cuisine`
and no `handAuthoredTags` entry gets its inline value (lowercase), so the two
casings would then coexist in the same field, and `getMealCuisine`'s
lowercasing is the only thing standing between that and a broken cuisine budget.

**Authoritative home.** `handAuthoredTags` → `tags.cuisine`, lowercased once at
build time. Delete the 77 inline `cuisine` keys; make every consumer read
`tags.cuisine` (or keep `meal.cuisine` as an alias written from the same
source). Fix `App.jsx:1310`.

---

## 6. Which meal an event refers to — five field names, three dead signals

> ✅ **Fixed, at data-capture scope only.** `previousMealName` is captured on all
> four custom-event sites; `selectOrderOutOption` now emits the `edit` event that
> never had a producer; `customAvoid`, `editAvoid` and `editAccept` are **deleted
> rather than rewired** — pointing them at the field that existed would have
> penalised the meal the user just chose. `custom`, `edit` and `skip` are now
> recorded in full and interpreted by nothing, pending enough data to validate an
> interpretation. `confirm` (2) and `swap` (1.2) untouched. Candidate detection
> and `buildPromotedCustomMeal` remain deliberately off. Guarded by
> `tests/mealEvents.capture.test.js`.

The user's own actions are recorded under one vocabulary and read under
another. Three of the five preference signals never fire.

**Copies — producers (`src/App.jsx`)**

| Line | Event type | Field carrying the meal name |
| --- | --- | --- |
| 916, 950, 992, 1033 | `custom` | `mealName` |
| 1105 | `custom_promoted` | `customMealText`, `promotedMealName` |
| 1129 | `swap` | `fromMealName`, `toMealName` |
| 1211 | `skip` | — |
| 1392 | `confirm` | `mealName` |

**Copies — consumers (`src/lib/mealEvents.js`)**

| Line | Reads | Weight |
| --- | --- | --- |
| 89 | `event.mealName` on `confirm` | `confirmAccept: 2` ✓ fires |
| 95 | `event.fromMealName` on `swap` | `swapAvoidFirst: 1.2` ✓ fires |
| 99-100 | `event.originalMealName` / `updatedMealName` on `edit` | `editAvoid: 0.4`, `editAccept: 0.6` — **`edit` is never produced** |
| 103 | `event.originalMealName` on `custom` | `customAvoid: 1.5` — **field never written** |
| 148, 184 | `event.customMealText` on `custom` | candidate detection — **field never written** |

**Do they agree?** No. Measured against the producer list:

- `EVENT_WEIGHTS.customAvoid` (1.5) reads `originalMealName` on `custom`
  events; every `custom` event writes `mealName`. `addDelta` no-ops on an
  undefined key (`mealEvents.js:17`), so replacing a planned meal with a
  custom one produces **no avoid signal at all**.
- `getCustomMealCandidates` (`:168-216`) and `getCustomMealOccurrenceCount`
  (`:135-150`) key on `customMealText`, which no `custom` event carries.
  `normalizeCustomMealKey(undefined)` returns `''` and the event is skipped, so
  `customCandidates` (`App.jsx:815`) is **always empty** and the promotion UI
  never offers anything. This is why `buildPromotedCustomMeal` — CLAUDE.md's
  standing gotcha about fabricated macros — is unreachable in practice.
- `edit` events are in `IMPACTFUL_EVENT_TYPES` (`:12`) but nothing emits them,
  so `preferences.edits` is permanently `{}` and
  `rules.scored.preferenceEditWeight` (`rules.js:253`, `:298`) is dead weight in
  the scoring function.
- `skip` events are emitted (`App.jsx:1211`) but are **not** in
  `IMPACTFUL_EVENT_TYPES`, so `preferences.skips` is permanently `{}` — while
  `plannerGenerator.normalizePreferences:56` and
  `onboardingPlannerAdapter.js:39` both carefully carry the empty bucket
  through the whole pipeline to a consumer that does not exist.

**Related — the user's own macros discarded.** `App.jsx:925` computes real
macros from the ingredient parts the user described (`computeMacros`) and stores
them on the plan. When that same meal is later promoted into the catalog,
`buildPromotedCustomMeal` (`App.jsx:1057-1081`) **ignores the parts entirely**
and stamps a fixed `{p:24, c:42, f:14, cal:450}` profile. The measured value
exists, in the same component, and is thrown away in favour of an invented one
that happens to clear the 20g per-meal floor.

**What breaks when they drift.** They have already drifted — this is not a
future risk. Every one of these is a user action the app records, persists to
Firestore, and then ignores.

**Authoritative home.** One field name for "the meal this event is about"
(`mealName`), one for "the meal it replaced" (`previousMealName`), declared
beside `EVENT_WEIGHTS` in `mealEvents.js` and used by both sides. Either emit
`edit` events or delete the two weights; either consume `skip` or stop
persisting `skips`.

---

## 7. Rules stated in a prompt and enforced in code

The brief's item 4. Three categories, in descending order of cost.

**Enforced by the validator, never stated to the model** — `fallbackPrompts.js`
mentions none of these:

| Rule | Enforced at | Tier |
| --- | --- | --- |
| breakfast repeats ≤ 4 / week | `planValidator.js:171-180` | 1 |
| lunch-dinner repeats ≤ 2 / week | `planValidator.js:181-190` | 1 |
| anchor-ingredient family cap | `planValidator.js:226-242` | 1 |
| red meat ≤ 3 / week | `planValidator.js:244-255` | 1 |
| no two identical days | `planValidator.js:205-219` | 1 |
| 50g daily sanity floor | `planValidator.js:138-147` | 1 |

The model cannot satisfy the anchor-family cap even in principle: the payload
(`planService.js:99-107`) carries `pp: m.tags?.protein_family || m.components?.protein`,
which is the *protein family* taxonomy (`chicken`) — or, failing that, a
free-text label (`"Chicken breast"`) — while the cap counts
`primary_ingredient` families (`poultry`). Two different taxonomies under one
key, neither of which is the one being enforced.

**Stated to the model, enforced nowhere:**

| Statement | Location | Reality |
| --- | --- | --- |
| "If you use flex days, put them on non-consecutive dates" | `fallbackPrompts.js:118` | no check, no score |
| "Never repeat a meal when an unused alternative exists" | `:120` | code allows 4 breakfast / 2 lunch-dinner repeats |
| "prefer at least 2 of 3 daily meals with `has_fibre = true`" | `:156` | Tier 3 bonus only, and fed by the wrong field (finding 4) |

**Stated weaker than enforced:**

`fallbackPrompts.js:122` says "different cuisines for lunch and dinner… Avoid
Indian+Indian same-day pairings." The actual Tier-2 rule
(`planOptimizer.js:352-354`) is *exactly one* Indian across lunch and dinner —
so a Continental + Asian day also fails it. A model following the prompt
literally will produce zero-Indian days, blow the `cuisine_balance_budget`, and
trigger a repair pass. The `standard` prompt is worse: it never mentions the
cuisine budget at all (`:155` lists cuisine variety as a soft priority), yet
`planValidator.js:274` applies `cuisine_balance_budget_exceeded` to `standard`
identically.

**What breaks.** Nothing user-visible — Phase 3 catches all of it. The cost is
paid in repairs: every prompt/validator gap is a paid Anthropic call whose
answer gets partly or wholly discarded by `repairWeek`, and a
`[Hybrid] Repaired the generated week` warning the founder is trained to ignore.

**Authoritative home.** `rules.js`, rendered into the prompt the way the numeric
thresholds already are. `planService.js:146-164` already substitutes 12
placeholders from `rules`; the week-level caps should join them rather than
being omitted or hand-written in prose.

---

## 8. "Heavy" and "carb-heavy" — two definitions each

**Copies**

| Concept | Location A | Location B |
| --- | --- | --- |
| heavy meal | `planOptimizer.js:116-118` — `cal > 600 \|\| (fat > 25 && carbs > 35)` | `mealDataLayer.js:116-122` — `cal > 600` only |
| carb-heavy | `planOptimizer.js:119` — `carbs >= 55` (`CARB_HEAVY_THRESHOLD`) | `mealDataLayer.js:197-203` — `carbs > 50` is `high` |

**Current values (measured).**

```
heavy: 3 meals disagree
  Paneer paratha + curd      593 kcal, 31g f, 52g c → optimizer heavy, weight class Medium
  Beef bulgogi bowl          575 kcal, 26g f, 37g c → optimizer heavy, weight class Medium
  Tofu & vegetable bibimbap  555 kcal, 27g f, 41g c → optimizer heavy, weight class Medium
carb-heavy: 9 meals sit in (50, 55) — tags.carb_level "high" but not isCarbHeavyMeal
  incl. Chicken biryani + raita (54g), Butter chicken + jowar roti (52g)
```

**Do they agree?** No. `meal_weight` is display-only
(`mealDataLayer.js:144-152`), so the heavy split is currently cosmetic — the
user sees "Medium" on a meal the optimizer is penalising as heavy
(`planOptimizer.js:442`). The carb split matters more: `tags.carb_level` feeds
`scoreMealMetadataSimilarity` (`mealDataLayer.js:474-494`), which drives the
"you keep eating this, try these" suggestions, so a biryani is
similarity-matched as `high` carb while the scorer treats it as not carb-heavy.

**What breaks when they drift.** `rules.js:310` declares `CARB_HEAVY_THRESHOLD = 55`
as a shared constant; `inferCarbLevel`'s 50 and 20 are literals in
`mealDataLayer.js`. Moving the shared constant moves one and not the other.
The `35` in `isHeavyMeal` is a bare literal in `planOptimizer.js` — see finding 9.

**Authoritative home.** `rules.js` for both thresholds;
`inferMealWeightClass` for the heavy/medium/light split, with
`planOptimizer.isHeavyMeal` either delegating to it or having its
fat-and-carb clause promoted into `rules.js` as a named constant.

---

## 9. Numeric thresholds living outside `rules.js`

`rules.js:7-8` states the invariant plainly: "Nothing else may hard-code a
numeric limit." About twenty do.

| Location | Value | Concept |
| --- | --- | --- |
| `planOptimizer.js:118` | `35` | carb component of "heavy" |
| `planOptimizer.js:379` | `0.25` | in-band proximity discount |
| `planOptimizer.js:442-444` | `2` | multiplier on the heavy/carb/fat-heavy penalties |
| `planOptimizer.js:448` | `0.15` | protein-gap penalty rate |
| `planOptimizer.js:458-460` | `4`, `3`, `4` | caps on accept / edit / avoid influence |
| `planOptimizer.js:512` | `40` | `DEFAULT_BEAM_WIDTH` |
| `planOptimizer.js:528` | `150` | `CANDIDATES_PER_BUDGET_CLASS` |
| `planOptimizer.js:879-880` | `8`, `60` | shortlist size per slot, alternate days |
| `mealDataLayer.js:200-202` | `50`, `20` | carb-level cuts (vs `CARB_HEAVY_THRESHOLD` 55) |
| `mealDataLayer.js:240,246,254-255` | `15/35`, `60/40`, `320/25/20` | goal-fit scoring |
| `mealDataLayer.js:300-301` | `35`, `0.2` | macro/calorie consistency tolerance |
| `mealDataLayer.js:365-375` | `0.88…0.45`, `0.08`, `0.05` | confidence scoring |
| `planService.js:135-136` | `0.9`, `1.1` | protein band fallback (vs `proteinBandRatio: 0.10`) |
| `planService.js:143` | — | re-derives `weeklyProteinFloor` inline instead of calling `rules.weeklyProteinFloor` |
| `App.jsx:1292,1297` | `400`, `350` | "light" meal for the quick action |
| `App.jsx:1438` | `100` | "Days ≥100g P" — the UI's idea of a good day, vs a 119–145g band |

**Do they agree?** Where they overlap, mostly yes, by luck. Two do not:
`inferCarbLevel`'s 50 vs `CARB_HEAVY_THRESHOLD`'s 55 (finding 8), and the UI's
100g success line vs the `high_protein` band floor of 119g — the progress panel
congratulates the user for days the engine treats as out of band.

`planService.js:135-136,143` are the sharpest: both are exact re-derivations of
functions `rules.js` already exports (`getRules`'s band computation,
`weeklyProteinFloor`). They produce identical numbers today and would not if
`proteinBandRatio` or `weeklyProteinFloorRatio` ever moved.

**Authoritative home.** `rules.js`. The scoring weights (`0.15`, `0.25`, `×2`,
the preference caps) belong in the `scored` block beside the weights they
multiply; the search-shape constants (beam width, pool sizes) are engine tuning
rather than nutrition rules and can reasonably stay, but should be labelled as
such. `planService` should call `weeklyProteinFloor(dayCount, rules)`.

---

## 10. The slot list

**Copies**

| Location | Form |
| --- | --- |
| `src/lib/rules.js:85` | `CORE_SLOTS` — frozen, exported, also exposed as `rules.slots` |
| `src/lib/planOptimizer.js:34` | its own `CORE_SLOTS` — unfrozen, **this is the one everything uses** |
| `src/lib/plannerGenerator.js:35` | `CORE_MEAL_TYPES` |
| `src/lib/planService.js:36` | inline literal |
| `src/App.jsx:600,1754,1782` | inline literals (two include `snack`) |
| `tests/*` | inline literals in 4 files |

**Do they agree?** Yes — all are `['breakfast','lunch','dinner']`.
`rules.js`'s copy and `rules.slots` are consumed by **nothing**: `planValidator`
imports `CORE_SLOTS` from `planOptimizer`, not from `rules`. The declared
authority is inert.

**What breaks when they drift.** Adding a fourth core slot (the roadmap's IF /
`two_meals` mode removes one) means finding six literals, one of which is
already the wrong one to edit.

**Authoritative home.** `rules.js` `CORE_SLOTS` — since it is per-goal data
(`getRules` already returns `rules.slots`, which is exactly what a two-meal
goal would need to vary). `planOptimizer` should import it.

---

## 11. Week length

**Copies:** `rules.js:197` `WEEK_DAYS = 7` (and `rules.weekDays`, consumed by
nothing); `App.jsx:238` and `:242` `Array.from({ length: 7 })`; `App.jsx:718`
and `:1558` `for (let i = 0; i < 7; i++)` building the history map;
`App.jsx:1422` `sortedDays.slice(-7)`.

**Do they agree?** Yes, all 7. `WEEK_DAYS` is genuinely load-bearing inside
`rules.js` (`allowedMissDays` pro-rates against it, `rules.week` is built from
it); the five copies in `App.jsx` are independent.

**What breaks when they drift.** `allowedMissDays` (`rules.js:350-354`) already
pro-rates correctly for partial runs, so the engine tolerates any day count.
Only the UI's fixed 7s would need changing — but a mismatch would mean the
budget is pro-rated against a different week than the one displayed.

**Authoritative home.** `rules.js` `WEEK_DAYS`, imported by `App.jsx`.

---

## 12. History lookback window

**Copies:** `planOptimizer.js:470` `lookbackDays = 14` (default of
`buildHistoryCounts`); `plannerGenerator.js:108` `HISTORY_LOOKBACK_DAYS = 10`;
`App.jsx:718` and `:1558` build a **7**-day history map before calling the
optimizer.

**Do they agree?** No — 7, 10 and 14 for the same concept. The 14-day default is
never reached in the app: both week paths hand `buildHistoryCounts` a map that
is only 7 days deep, so the recency weighting (`:473`) normalises over 7 entries
rather than 14. The single-day generator uses 10. Two entry points, two
anti-repeat memories, neither the documented one.

**What breaks when they drift.** The recency weight is
`max(0.2, (index+1)/dateKeys.length)`, so the window size directly scales the
`historyRepeatPenalty`. A meal eaten 8 days ago is invisible to the week path
and penalised on the day path.

**Authoritative home.** `rules.js` — a named `HISTORY_LOOKBACK_DAYS`, with
`App.jsx` building its map to that length.

---

## 13. One egg

**Copies:** `fallbackPrompts.js:22-26` — "NEVER use the `egg_whole` ingredient…
1 egg = 1 `egg_white` + 0.5 `egg_yolk`"; `ingredients.js:98-114` — `egg_whole`
(50g piece), `egg_white` (33g), `egg_yolk` (17g); the catalog itself, which uses
`egg_whole` in its egg breakfasts (`mealDatabase.js:18`, and others).

**Current values (computed from `ingredients.js`).**

```
1 egg as egg_whole (50g):            71.5 kcal, 6.30g protein
1 egg as prompt split (33g + 8.5g):  44.5 kcal, 4.97g protein
3 eggs, catalog breakfast:          214.5 kcal, 18.9g protein
3 eggs, logged via Omnibox:         133.6 kcal, 14.9g protein   (−38% kcal, −21% protein)
```

**Do they agree?** No. The prompt's ratio drops half the yolk mass, so the same
food is worth materially less when the user logs it than when the planner serves
it. `getTotalProtein` (`App.jsx:1402`) sums whichever version happens to be in
the slot, so a day's protein reading depends on how the eggs got there.

**What breaks when they drift.** The prompt's instruction is a nutrition claim
maintained in prose, in a file of prompt templates, against ingredient data it
cannot see. `buildDatabasePack.mjs:21-24` carries yet another version of the same
assumption — "Egg style baseline: 4 egg whites + 1 yolk" — used for the exported
documentation.

**Authoritative home.** `ingredients.js`. If the split is deliberate (yolk
reduction is a real dietary practice) it should be an ingredient
(`egg_reduced_yolk`) with its own measured `per100g`, not a ratio the model is
asked to apply.

---

## 14. The catalog itself

**Copies**

| Artifact | Contents | State |
| --- | --- | --- |
| `src/data/mealDatabase.js` | 110 meals (20 / 75 / 15) | authoritative |
| `database/seeds/meal_catalog_v1.json` | 110 meals | current — `npm run db:pack` |
| `exports/meal_database_architecture_v1.xlsx` | — | current — same script |
| `meal_database_export.csv` (repo root) | **38 meals**, `cuisine: "global"`, unrounded macros | **stale by 72 meals** |
| `meal_database_architecture_v1.numbers` (repo root, 784KB) | — | stale binary |

**Do they agree?** No. The root CSV predates both `handAuthoredTags` (every
cuisine reads `global`) and the Phase 2 / research-batch expansions. Its
generator, `scripts/exportDatabase.mjs:57`, writes to the repo root and is
**not** wired into `package.json` — only `db:pack` and `export:rejections` are —
so nothing regenerates it and nothing flags it as stale.

**What breaks when they drift.** Nothing at runtime; the risk is a human reading
the CSV as the catalog. That is exactly what it looks like sitting at the repo
root next to `README.md`.

**Authoritative home.** `src/data/mealDatabase.js`, with every artifact
regenerated by a single `npm run db:pack`. Either add `exportDatabase.mjs` to
that script or delete the root CSV and `.numbers` file.

---

## Appendix — deliberate duplication, listed for completeness

These are copies by design. Flagged so a future pass does not "fix" them.

- **`tests/rules.test.js:21-42`, `tests/planAcceptance.test.js:31-58`** pin
  `132`, `785`, `1600`, `2200` as literals. This is the point of a pinning test:
  the literal is the specification, and a change to `rules.js` *should* fail here.
- **`tests/prompt.weeklyGeneration.test.js:13-34`** re-implements
  `planService`'s placeholder substitution, with a comment saying so ("Kept in
  the test rather than exported so a drift between the two shows up here"). Note
  the copy is already incomplete — it omits `{{AVAILABLE_MEALS}}`,
  `{{PREFS_EDITS}}`, `{{RECENT_HISTORY}}` and `{{TARGET_DATES}}` — so it would
  not catch a drift in those four.
- **`api/generate-plan.js:13` `DEFAULT_MODEL`** is single-homed;
  `tests/generatePlanProxy.test.js:14` pins it deliberately.

## Appendix — documentation drift noticed in passing

Not code, but the same class of problem:

- `CLAUDE.md` quotes optimizer runtime "~630ms warm at 97 meals / 72,930
  candidates". The catalog is 110 meals; that figure describes a catalog two
  batches ago and understates the current enumeration by roughly a third.
- `CLAUDE.md` says `npm run test:logic` runs 125 tests. It runs 130.
- `src/lib/mealDataLayer.js:67` says "the `has_fibre` threshold sits at 5". It
  is 3 (`rules.js:334`).
- `CLAUDE.md`'s gotcha table calls `buildPromotedCustomMeal` "the only
  unmeasured path into a fully measured catalog". Per finding 6 it is currently
  unreachable — the candidate list that feeds it is always empty.
