# Why the meal planner disappoints — diagnosis and revamp

Written after an end-to-end audit of the generation pipeline. Every number
below was measured by running the shipped code against the shipped catalog, not
estimated. The scripts are reproducible: `npm run audit:generation`,
`npm run test:logic`.

---

## 0. The finding that explains all the others

**The system passed every test it had and every acceptance criterion it
measured, and the output was still wrong.**

At the start of this audit: 199 of 199 tests green, 13 of 13 acceptance
criteria PASS, validator clean. The founder's complaints — meals mixed up,
paneer and cottage cheese treated as unrelated, favourites ignored while
never-chosen meals kept appearing — were all true *simultaneously*.

That is not a contradiction. It means the measurements were measuring the wrong
things. Every rule was enforced somewhere; none of them described what a person
notices when they read a week. The fix is therefore not "more rules" — the
founder was right to resist that — but rules aimed at the level a person
actually perceives, and the deletion of a layer that was doing nothing.

---

## 1. Wanting a meal often was not expressible. At all.

### What was measured

`maxDishRepeatsPerWeek: 1`, a **hard** rule, applied identically to all 110
meals. So every generated week was 21 distinct dishes. Every week. Forever.

The preference weight was tested at increasing strength against the shipped
optimizer:

| `accepts["Paneer tikka + jowar roti + salad"]` | times it appears in the week |
| --- | --- |
| 0 | 0 |
| 2 | 1 |
| 4 | 1 |
| 8 | 1 |
| 20 | 1 |
| 100 | 1 |

The preference signal was not weak. It was **structurally incapable** of
changing how often a meal appears. It could only ever decide *whether* a meal
appeared, never *how often*.

The optimizer did carry an escape hatch — `pinnedDish`, one chosen dish allowed
up to 3 uses. It was dead code:

- No caller anywhere in `src/`, `api/` or `scripts/` ever set it. Grep confirms
  a single production reference, in the parameter list itself.
- `validateAndRepairWeek` did not forward it to `validateWeek` either, so even
  if something had set it, the validator would have rejected the repeat and the
  repair pass would have removed it.

**So the single most-wanted behaviour — "give me this one often" — had no
implementation, and the affordance that looked like it was never connected.**

### What changed

`src/lib/mealTiers.js`. This is the founder's own tier idea, with one change of
address.

| Tier | Weekly allowance | Score pull | Meaning |
| --- | --- | --- | --- |
| `staple` | 3 | +9 | You want this often |
| `regular` | 2 | +4 | Happy to see it most weeks |
| `occasional` | 1 | 0 | The default — what everything used to be |
| `rare` | 1, plus a 3-week cooldown | −6 | Served before, not eaten |
| `excluded` | 0 | — | Never planned |

**Why not a column in `mealDatabase.js`**, which is the obvious implementation:

1. A tier is a fact about a *person*, not about a food. Storing it on the meal
   freezes one palate into a shared catalog.
2. Every fact in this repo that got a second hand-maintained home has drifted.
   `cuisine` was declared inline on 77 meals and again in `handAuthoredTags`,
   and **29 of them disagreed** (`docs/CONSISTENCY_AUDIT.md` #5). A hand-typed
   tier column is that bug with a longer fuse.

So a tier is *resolved*, in one place, from an explicit override first, then
observed behaviour, then the default. The flat cap of 1 survives as that
default, so any engine handed no tier table behaves exactly as it did before.

**The demotion guard matters more than it looks.** `App.jsx` auto-confirms every
planned meal on every past day (`autoConfirmed: true`), so `mealHistory` cannot
distinguish a meal you ate from one it assumed you ate. Only the `confirm`
*event* log can, and that is written solely by the Confirm button. A user who
has not been pressing it looks, to the counts, exactly like a user who dislikes
the entire catalog. `minConfirmsBeforeDemotion: 5` means silence never demotes
anything. Explicit rejections (swap, skip) are deliberate acts and demote
regardless.

---

## 2. Five of seven days repeated an ingredient inside the day

### What was measured

A generated week, read the way a person reads it:

```
2026-09-07  egg_whole x2 (breakfast+lunch), curry_base x3 (all three slots)
            Anda bhurji + toast | Egg curry + dal + jowar roti | Prawn curry + rice
2026-09-12  paneer x2 (breakfast+lunch)
            Moong dal chilla + paneer + hung curd | Palak paneer + jowar roti | Grilled fish
2026-09-13  jowar_roti x2, curry_base x2
            Chicken keema bhurji + jowar roti | Soya keema curry + jowar roti | Pork chop
```

**5 of 7 days.** Every one legal. Week-wide: `curry_base` 10 uses,
`jowar_roti` 7, `mixed_salad` 5.

Two separate causes:

**(a) The anchor cap counted one ingredient per meal.**
`derivePrimaryIngredient` returns the single highest-protein contributor.
Everything else in the bowl was invisible to every rule in the system. Measured
on the shipped catalog:

| Meal | Contains | Anchors on | Counted by the cheese cap? |
| --- | --- | --- | --- |
| Moong dal chilla + paneer + hung curd | paneer | `moong_dal_chilla` | **no** |
| Shakshuka with feta | feta | `egg_whole` | **no** |
| Chicken souvlaki + tzatziki | feta | `chicken_breast` | **no** |
| Chicken & ricotta carbonara | ricotta | `chicken_breast` | **no** |

**4 of the 15 soft-cheese meals were invisible to the soft-cheese cap.**

This is the direct answer to *"it doesn't know paneer and cottage cheese are
the same"*. It does — `ANCHOR_FAMILY` puts paneer, feta, halloumi, ricotta,
cottage cheese and cheese slices in one `cheese_soft` family, and that mapping
is correct. The failure is that the family was only ever consulted for one
ingredient per meal, so the mapping was right and simply not reached.

**(b) There was no per-day ingredient rule at all.** The anchor cap is weekly
(2 for `cheese_soft`). A paneer breakfast plus a palak paneer lunch spends both
of the week's two slots on a single day and passes.

### What changed

- `deriveSignatureIngredients` (mealDataLayer) derives *every* ingredient a
  person would name — anything supplying ≥20% of a meal's protein, ≥25% of its
  carbs or ≥20% of its calories, minus a named seasoning list. Average 2.4 per
  meal; no meal derives zero.
- **R5** (`maxSameSignatureIngredientPerDay: 1`) is a new Tier-1 rule, enforced
  at *enumeration* where R3 already is, because it is a property of one day.
  Nothing illegal is ever built, scored or shortlisted.
- The weekly family caps now count every signature ingredient, not just the
  anchor, so the invisible paneer above is now counted.
- Week-level leaning is **scored, never gated** — R3 forces seven Indian
  lunches and 18 of the 28 legal Indian lunches are flatbread-based, so a hard
  cap on `jowar_roti` would make the week infeasible.

### Result

| | before | after |
| --- | --- | --- |
| days repeating an ingredient in-day | **5 of 7** | **0 of 7** |
| week-level leaning (top ingredient) | `curry_base` ×10 | `jowar_roti` ×5 |
| enumerated candidates | 23,688 | 16,326 |
| optimizer runtime | 621ms | **537ms** |

The rule made the engine *faster*, because an illegal day is cheaper to skip
than to build and score.

---

## 3. The AI phase was being asked to do something it cannot do

This is the largest finding. **Read the caveat first, because it matters:** the
percentages below come from *simulating* the tool schema — sampling uniformly
from the choices it permits — not from live API calls. A real model is not a
uniform sampler and would do better than these figures on the variety
dimensions it was actually told about.

What the simulation establishes is not "the model gets it wrong this often". It
is the shape of the space the model was put in: what the schema allows, how
little of that space is legal, and which rules it was given no way to satisfy.
Those three things do not depend on which model is answering.

### What was measured

The `submit_weekly_plan` tool schema permits **~9.2 × 10¹⁸** weeks. Sampling it
400 times, exactly the way the schema allows:

```
legal weeks:                    0 / 400   (0.0%)
weeks breaking a HARD rule:   400 / 400   (100.0%)

most common violations (400 samples):
  dish_repeat_exceeded              1976
  anchor_family_repeat_exceeded      998
  carb_cap_budget_exceeded           227
  calorie_bounds_budget_exceeded     192
  egg_breakfasts_above_ceiling        93
  red_meat_cap_exceeded               54
```

**Zero of 400.** The relevant point is not the exact rate but why the legal
region is so small — three compounding reasons, none of which better prompting
fixes:

1. **The shortlists cannot satisfy R1.** Each day offers 8 breakfasts, and *7 of
   those 8 are the same meal on all seven days*. The union of all seven days'
   breakfast lists is **9 distinct meals**, while R1 demands 21 distinct dishes
   across the week.
2. **Four of the hard rules were never stated in the prompt.** The
   anchor-family caps, the egg-breakfast floor and ceiling, the red-meat cap and
   the duplicate-day rule appear nowhere in `weeklyGeneration`. R1 appears only
   as a soft preference ("Never repeat a meal when an unused alternative
   exists") when it is in fact a hard gate.
3. **The payload carried no data to evaluate them with.** Each shortlist entry
   has name, protein, carbs, calories, cuisine, fibre flag and protein family.
   No anchor ingredient. The model could not check the family caps even if told.

Then, what happened to that answer. Feeding 60 simulated model responses through
`validateAndRepairWeek`:

```
repair strategy used:              { regenerated_week: 60 }
final week identical to the optimizer's, AI discarded entirely:  60/60 (100%)
```

`dish_repeat_exceeded` is a **week**-scoped violation, and repair pass 1 only
fires on **day**-scoped ones. So pass 1 never ran; pass 2 rebuilt the whole week
deterministically, every time.

Again, these were simulated answers. A real model would break fewer rules — but
it only takes **one** dish repeat anywhere in 21 slots to trigger the same
week-scope violation and the same full rebuild, and it was given neither the
rule nor the data to avoid the anchor-family and egg-breakfast violations at
all. The realistic reading is that the AI phase was contributing far less than
its cost and latency suggested, and on the runs where it did differ from the
optimizer it was more likely to be discarded than kept.

### What changed

The model was being asked to do a job it cannot do — assemble a week from parts
while blind to the rules the week is judged by. But there is a job it *is*
better at than the optimizer: judging how a week reads.

`chooseWeeklyPlan` gives it that job. The beam search already finishes holding
~40 complete weeks, all of which satisfy every hard rule and every Tier-2 budget
by construction; all but one were being thrown away. The model now picks between
7 of them.

| | before | after |
| --- | --- | --- |
| model's choice space | ~9.2 × 10¹⁸ weeks | 7 complete weeks |
| of which legal | **0%** | **100%, by construction** |
| effect of a bad answer | week discarded, rebuilt | a different *good* week |
| what it is asked to judge | arithmetic it has no data for | how the week reads |
| effect of an outage | generation fails | falls back to the optimizer's pick |

An illegal answer is no longer detected. It is unrepresentable.

The selection prompt deliberately says nothing about protein, carbs, calories
or repeat caps. Every option already satisfies them, so restating the rules
would only invite the model to re-derive constraints it cannot improve and
second-guess arithmetic it has no data for. It is asked about staples, avoided
meals, rhythm, flow and appetite — and nothing else.

---

## 4. The feedback loop was inverted against engagement

`handleConfirm` wrote history entries shaped `{ meal: name, protein, cal }`.
Every consumer reads `.name` (`getMealName` checks `.name` and
`.canonical_name`, never `.meal`).

```
getMealName(confirmed history entry) = ""
getMealName(planned  plan   entry)   = "Paneer tikka + jowar roti + salad"

history counts from a week you CONFIRMED : {}
history counts from a week you only PLANNED: { 'Paneer tikka + jowar roti + salad': 3 }
```

And `historyMap` chose per *day*, wholesale:

```js
if (mealHistory[d]) historyMap[d] = mealHistory[d];
else if (mealPlans[d]) historyMap[d] = mealPlans[d];
```

So **confirming any one meal made that entire day invisible to the recency
logic.** The only days that reached the signal were the ones the user had not
engaged with. Every act of engagement deleted its own evidence.

Fixed: history entries now carry `name` alongside `meal` (five writers), and
`buildRecentContext` merges per *slot*, preferring a real history entry and
falling back to the plan.

### A preference must never make a week invalid

Stress-testing the finished tier system found a real failure: marking a
*breakfast* a `staple` exhausted the beam on the last day and fell through to
`bestEffortWeek`, which returned a week with duplicate days and three
anchor-family violations. Two causes, both now fixed:

1. **The tier bonus was reaching `baseScore`,** which is what
   `trimCandidatePool` ranks by. With +9 baked in, every budget class filled up
   with days containing the staples and the pool lost the variety the rest of
   the week needs. The bonus is now applied to the *placement* inside the beam,
   which keeps the candidate pool representative while still making the search
   reach for a favourite before it reaches for novelty.
2. **There was no degradation path.** `softenTiers` steps every allowance down
   one level (`staple → regular → occasional`) and the search retries, at most
   twice, before any fallback. If a favourite cannot be honoured in full the
   week says so (`tiersRelaxedFrom`, surfaced as a notification) rather than
   coming back broken.

Measured across five tier configurations, from none to four simultaneous
staples: **every one now produces a valid week with 6 legal alternatives.**

Note *which* slot degraded. A lunch staple is honoured twice; a breakfast
staple has to fall back to once. That is §5.2 below showing up in practice —
breakfast is the binding slot, and it is the constraint to spend the next meal
batch on.

---

## 5. Recommendations — what I did not change, and why

These are decisions, not defects. Each carries the measurement so the call can
be made on numbers.

### 5.1 R3 — DECIDED, and shipped as a budget

R3 (Indian lunch + non-Indian dinner) is currently hard on **all 7 days**.

```
legal lunch/dinner meals:              75
Indian     (lunch-only under R3):      28
non-Indian (dinner-only under R3):     47
Indian lunches built on flatbread:     18 of 28 (64%)
day combinations with R3:              16,326
day combinations if R3 were scored:    99,900  (6.1x)
```

Consequences worth weighing:

- **No meal can ever appear in both slots.** 47 meals are dinner-only and 28
  are lunch-only, permanently.
- **7 Indian lunches must come from a pool of 28**, and 64% of that pool is
  flatbread-based. This is the direct cause of `jowar_roti` appearing 5–7 times
  a week, and of R4 (lunch and dinner both flatbread) having to be demoted to a
  score rather than a rule — the two constraints genuinely conflict.
- It removes **84% of the candidate space** before anything is scored.

**Founder decision: loosen it.** R3 is now a Tier-2 budget judged 5 of 7, the
same "aim daily, judge weekly" shape everything else uses. What that actually
bought, measured:

| | R3 hard (7 of 7) | R3 budgeted (5 of 7) |
| --- | --- | --- |
| enumerated day candidates | 16,326 | **61,794** (3.8x) |
| a breakfast marked `staple` | beam exhausted; tiers stepped down | **honoured outright** |
| R3 days in the generated week | 7 of 7 | 7 of 7 |
| optimizer runtime | 537ms | 1131ms |

Two things worth being straight about.

**The generated week is still 7 of 7 R3-compliant.** Loosening the rule did not
change the default output, because compliant days genuinely score best. What it
bought is *headroom*, not variety-by-default: the week can now break the pattern
on up to two days when something better is available — a favourite that happens
to be a non-Indian lunch, or a tight week where the alternative was failing.
That headroom is exactly what fixed the staple problem below.

**It cost ~600ms of client-side compute.** Enumerating 3.8x the candidates is
inherently more work. Two optimizations recovered part of it — the beam's
per-day expansion is now a bounded top-K selection instead of collecting every
survivor and sorting (the largest single cost, ~1150ms of a ~1500ms
generation), and the per-slot shortlists that the retired Phase 2 needed are no
longer built. The remainder is real and accepted: it is client-side work
sitting in front of an API call with a 90-second timeout.

### 5.1b The egg ceiling — DECIDED, 4 to 5

Founder: *"I eat scrambled eggs or a boiled egg sandwich pretty often; I don't
mind an egg breakfast 4 or 5 days a week."*

R2's ceiling moved 4 -> 5, and the `egg` anchor-family cap 4 -> 6 so that the
stated ceiling is the one that actually binds rather than the family cap
binding one earlier. The **floor stays at 3** — permission to eat more eggs is
not a requirement to, and the tier system raises the count on its own once the
egg breakfasts actually eaten are confirmed often enough to earn `staple`.

This surfaced a real gap. Raising a ceiling is not enough to make a favourite
appear: `Scrambled eggs + toast` is 23g of protein and 284 kcal — the
second-lightest breakfast in the catalog — so against a 120g target and a 1600
kcal floor the optimizer avoids it, and marking it a `staple` produced a week
containing it **zero times**. A tier had a ceiling and no floor.

`staplePressurePenalty` fixes that, in the same shape as the existing Tier-2
budget pressure: leaving a staple unplaced costs more the fewer days remain,
and the final week selection prefers a week that placed them all. A human
planner schedules the light breakfast and makes the day up at lunch; the search
now does the same. Measured across three simultaneous staples including that
one: every staple placed at least once, week valid, no tier stepped down.

### 5.1c A pre-existing failure these changes did not cause

`npm run audit:generation -- --goal standard` fails two criteria: only **2 of 7
days** land inside the `standard` goal's 1800-2400 kcal band, and the validator
reports the resulting budget violation. This is not a regression — it fails
identically on the commit before any of this work (verified by stashing). Only
**12.2%** of legal days reach that goal's 1800 kcal floor, against 53.8% for
`high_protein`'s 1600.

`standard` is not the goal in use, so it is recorded rather than fixed. It is a
catalog problem, not a rules problem: the fix is calorie-denser meals, not a
threshold change.

### 5.2 Breakfast is the binding slot, not the catalog as a whole

```
breakfasts clearing the 20g protein floor: 18 of 20
best breakfast in the catalog:             44g protein
lunch/dinner clearing the floor:           75 of 75
```

18 legal breakfasts for 7 slots. The R2 ceiling and the `egg` family cap were
part of what made it bind, and raising both (§5.1b) relieved some of it — a
breakfast staple no longer forces the tier system to step down.

The pool itself is unchanged, though, and it is still the tightest in the
system. **The next meal batch should be almost entirely breakfasts.** With the
egg ceiling at 5 the useful shape has shifted: non-egg breakfasts are what add
genuinely new days, since the egg ones now have room but still number only 8
distinct dishes. That single change buys more perceived variety than any
further rule work.

### 5.3 Two known-bad items from the previous audit are still open

- **`buildPromotedCustomMeal` fabricates macros** — assigns `{p:24, c:42, f:14}`
  to every user-added lunch/dinner. Unreachable today because candidate
  detection is off. It is now *more* dangerous than before: the optimizer trusts
  its inputs completely and the tier system will happily promote a fabricated
  meal to `staple`. Fix the macros before switching detection on.
- **Findings 3 and 4 of `docs/CONSISTENCY_AUDIT.md`** still disagree in
  production: two independent red-meat classifiers, and name-based fibre scoring
  that contradicts measured grams on 14 meat meals.

### 5.4 The thing I would resist

More rules. The failure was never a shortage of them — there were enough to
make 100% of the AI's possible answers illegal. The failure was that the rules
described the catalog rather than the meal, and the week rather than the day. R5
is the whole of what was missing at the day level, and tiers are the whole of
what was missing at the person level. If something still reads wrong after this,
the next question is which *measurement* is absent, not which rule.

---

## 6. Reproducing all of this

```
npm run test:logic                        # 228 tests
npm run audit:generation                  # high_protein: all criteria pass
npm run audit:generation -- --goal standard   # fails on calories; see §5.1c
```

The audit now also reports R5 compliance, week-level ingredient leaning, and
that every alternative week offered to Phase 2 validates.
