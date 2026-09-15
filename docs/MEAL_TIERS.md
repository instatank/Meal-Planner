# Meal tiers, ratings and templates

Not all meals are equal. This is how the database says so.

Read §1 if you want the shape, §3 before changing any number, §5 for what
these cost, and §6 for what is still wrong.

---

## 1. What a dish now carries

| Field | Means | Default |
| --- | --- | --- |
| `tier` | How often this belongs in a week | `null` — planned as `occasional` |
| `rating` | 1–5, your own opinion | none |
| `pairing` | `fixed` composite, or `modular` pattern | `fixed` |
| `note` | Free text, never parsed | empty |

**`tier` is null when you have not judged the dish, and that null is
load-bearing.** The default tier is `occasional`, so a dish nobody has looked
at and a dish deliberately marked `occasional` would otherwise be the same
record — and the tiering screen could not put the unjudged ones first, which is
the one thing that screen is for. A distinction that was never stored cannot be
recovered by reading harder.

Nothing downstream cares. Every consumer reads through `getMealTier` or
`getTierDefinition`, both of which resolve null to `occasional`, so a null tier
*plans* exactly as `occasional` does — which is what it means. `hasExplicitTier`
is the only accessor that can see the difference, and only the screen calls it.

Two consequences worth stating, because both were bugs waiting to happen:

- **`hasTierEffects` resolves before comparing.** Comparing `entry.tier !==
  DEFAULT_TIER` on the raw field says a null tier *is* an effect, which would
  switch the optimizer off its untiered path for a user who has only ever rated
  something — quietly ending the "an untiered catalog plans identically"
  guarantee this whole file rests on.
- **A rating is not a tier.** Rating a dish leaves `tier` null, so the screen
  keeps asking how often you want it. That is correct: the two are different
  axes (§ the rating section), and answering one must not silently answer the
  other.

Records written before `tier` could be null always carried a concrete tier
string, because `normalizeMealTier` put one there. So existing tiering reads as
explicit and **nobody is asked to re-tier a catalog they already worked
through.**

Stored per meal **name**, in the `meal-tiers` key. Name, not `meal_id`, because
that is what the event log, the optimizer's repeat counters and the preference
buckets all key on — a second identifier would need reconciling on every read,
and a mismatch would fail silently, which is exactly the shape of audit
finding #6.

Tiers are persisted. The learned preference model (`docs/FEEDBACK_SYSTEM.md`)
is deliberately **not** — it is rebuilt from the event log on every boot. A
tier is something you *said* and must survive; a learned score is a derivation
and storing it beside its source is how the two drift.

---

## 2. The rule this changed

**R1 used to say: every dish at most once a week**, with one hand-picked
"pinned" dish allowed up to three times. It exists because of a real failure —
a week once carried four different rajma dinners, every one legal, because the
cap counted meal names.

That single-pin escape hatch was the tell: a flat cap is wrong, some dishes
genuinely should recur, and there was no principled way to name which.

**The weekly cap is now a property of the dish.**

| Tier | Cap / week | Meaning |
| --- | --- | --- |
| `staple` | 3 | Happy to eat this several times a week |
| `regular` | 2 | Once or twice |
| `occasional` | **1** | The default — identical to the old flat cap |
| `rare` | 1, plus a 21-day gap | A treat |
| `retired` | 0 | Never plan this again |

`occasional` caps at 1, which *is* `maxDishRepeatsPerWeek`, so **an untiered
catalog plans bit-for-bit as it did before tiers existed**. That is asserted
against `RUBRIC_LIMITS` itself rather than against the literal 1, so the two
cannot drift apart.

The legacy pin still works and can now only *loosen* a tier, never tighten
one.

`retired` is the only tier that **gates** rather than ranks — it is checked at
`isMealAdmissible`, beside the avoid-score exclusion, before a single
combination is enumerated. It is also the only edit here that can make the
rules unsatisfiable, which is why the tiering screen keeps a weekly-capacity
figure on display rather than waiting for generation to start failing.

---

## 3. Making a staple actually recur — three wrong designs first

This took four attempts, and each failure was informative. All of the first
three passed a single-dish test while doing nothing in aggregate, which is why
the regression test is now a **sweep over the whole catalog**.

**Attempt 1 — discount the repeat penalty.** Staples still never repeated.
Reusing a dish costs two things: `repeatUsePenalty` (5) *and* the
`distinctMealBonus` (6) it does not earn. At a penalty of zero a repeat still
loses by 6.

**Attempt 2 — pay repeats a bonus above break-even.** Break-even is
`(6 + 1) / 6 = 1.17x` the distinct bonus. Below it nothing repeats; above it a
repeat *always* wins, so every beam branch made the same choice, diversity
collapsed, and the branches dead-ended together. One staple was enough to make
a whole week infeasible.

**Attempt 3 — reserve candidate-pool room.** Built on a bad measurement and
**removed**. The claim was that only 300 of 23,688 days survive the trim and
that 31 of 75 dishes appear in none. Both wrong: the script hit a fallback
`slice(0, 300)` because `trimCandidatePool` is not exported, so it measured
neither the right size nor the real stratification. The actual pool is
`16 x 150 = 2400`, in which the median lunch/dinner dish appears **52** times
and exactly **1 of 75** appears in none. An ablation confirmed the reservation
pass changed nothing at all.

**What works — three levers, each with its own job:**

- the **cap** permits the repeat (from the tier),
- `repeatValueRatio` makes recurrence *affordable* (1.4 for a staple, above
  the 1.17 break-even),
- and a per-appearance **`affinity`** in `scoreDayStandalone` makes the dish
  *wanted*. This is the one that mattered. It lives in `baseScore` rather than
  the beam so one number reaches the candidate sort, the pool trim and the
  beam alike.

Ablated, every lunch/dinner dish marked staple one at a time:

| | appears | recurs |
| --- | --- | --- |
| no affinity | 18 / 75 | 13 / 75 |
| **with affinity** | **57 / 75** | **46 / 75** |
| affinity, no reservation | 57 / 75 | 46 / 75 |

### Turning tiering on can never produce a worse week

If tier scoring dead-ends the beam, `selectWeek` retries itself once with that
scoring suppressed — caps stay, pressure goes — before degrading to
best-effort. The fallback *is* the untiered search. That property is worth
more than any individual week, and it is what makes a feature touching a hard
rule safe to ship. Zero infeasible weeks across all 75 dishes.

### The 18 dishes that still never appear

They are admissible and do occur in legal days. They lose to the **Tier-2
budgets**, not to the cap: Rajma chawal is 21g of protein against a 120g daily
target and cannot carry a third of a day. That is the macro rules correctly
outranking a preference, so the tiering screen says so on the row rather than
leaving you to conclude the feature is broken.

---

## 3a. How the screen is ordered

Unjudged first, then most frequent to least: **Not set → Staple → Regular →
Occasional → Rare → Retired**, alphabetical inside each band, with a sticky
heading per band.

Unjudged goes on top because the screen is something you work *through*. With
120 meals in the catalog, sorting purely by frequency buries the only rows that
need a decision under a hundred that do not — and the rows nobody has touched
are precisely the rows that never get touched. The header count leads with
"N not set" for the same reason: it is the only figure on that line that asks
for anything.

Alphabetical within a band rather than by protein or calories, because the list
is browsed — you come here to find the dish you are thinking of, and a name is
how you look for it. Ranking within a band by a macro would imply an ordering
the tier does not have.

**A tier button has three states, not two**, and the third is the one that
matters: solid means you chose it, dashed-and-muted means you chose nothing and
this is the default *already in force*, plain means neither. Only `Occasional`
ever renders dashed, because only the default can apply without being chosen.

Both simpler designs are wrong, and wrong in opposite directions. Filling
`Occasional` solid on an unjudged row — which is what displaying the *resolved*
tier did — claims you answered a question you did not, on a hundred rows at
once. Leaving it plain implies the dish has no frequency at all, which invites
the reading that **an unmarked dish is not planned**. It is planned: as
`occasional`, at most once a week, exactly as it was before the field could be
null. The group heading says so outright rather than only asking you to act.

That reading is ruled out by a test rather than by this paragraph, and by
`audit:generation`, which runs against an **entirely empty tier map** — every
dish unjudged — and still builds a full 21-dish week. If unjudged meant
unplanned, the audit could not pass.

One more detail that is not cosmetic:
- **The list is capped at 60 with a "Show N more".** Stated rather than silent,
  and the cap is applied *after* grouping so a heading never claims more than
  it shows. The ordering guarantees what is cut is the already-decided end of
  the list, never a row awaiting a decision.

The ordering itself lives in `mealTiers.js` (`sortMealsByTier`,
`groupMealsByTier`), not in the component. "Not judged" versus "judged as
occasional" is a fact about the data; a component that re-derived it would be a
second opinion on what the tier map means.

---

## 4. Tiers proposed from behaviour

`tierProposals.js` reads the event log and suggests:

- eaten **2+ times a week** → `staple`
- turned down **60%+ of the time**, at least 3 times → `retired`
- eaten **0.3 times a week or less** → `rare`

Gated on 21 days of history and 4 outcomes per dish. **Nothing here writes a
tier** — proposals are returned and a human applies them one tap at a time,
and there is a test asserting the map comes back untouched. `preferenceLearning`
applies itself automatically because it is Tier 3 and cannot make a plan
illegal. Tiers change a *hard cap*. So tiers ask.

Two details that are easy to get wrong:

- **Cadence is per week observed, not per appearance.** A dish eaten once,
  eight weeks ago, is 0.125/week. Using its own history as the denominator
  makes everything look like a staple the day it is first eaten.
- **A rejection belongs to the dish left behind.** Swapping away from dal at
  lunch resolves that slot to whatever was eaten instead, so rejections are
  read from events while "eaten" is read from resolved slot outcomes.

A proposal is suppressed for a dish whose tier you set by hand in the last two
weeks. Being argued with the same week you decided is how a system teaches you
to ignore it.

---

## 5. Mix-and-match: templates

`mealTemplates.js` declares a base once and its proteins once. Two templates —
salad bowl, quinoa bowl — expand to 10 meals, taking lunch/dinner from 75
to 85.

Expansion happens at **catalog build, not during search**: the optimizer
enumerates every legal combination, so expanding inside that loop would
multiply a quadratic. Safe because measured first — growing lunch/dinner
75 → 175 moves enumeration 79ms → 157ms inside a ~900ms run, since the beam
search dominates and is bounded independently of catalog size.

**Macros are never declared on a template.** A generated meal carries `parts[]`
and goes through the same `buildMeal` path, so nutrition is rolled up from the
same ingredient table; a test recomputes every generated meal and asserts no
drift.

Adding them improved the plan rather than merely not harming it:

| | before | after |
| --- | --- | --- |
| carb cap | 6 of 7 days | **7 of 7** |
| weekly protein | 843g (100.4%) | 852g (101.4%) |
| candidates | 23,688 | 28,728 |
| runtime | 724ms | 720ms |

The bowls are low-carb and high-protein, which is where the catalog was thin —
the carb cap was the one criterion scraping through.

---

## 6. Known limits

**Only 57 of 75 dishes respond to being made a staple.** The rest lose on
macros, as above. Surfaced, not fixed.

**Templates are few and hand-declared.** Every generated meal competes with a
hand-authored one for a place in the week, so a template producing mediocre
food makes the catalog worse rather than bigger. Adding templates is a food
decision, not an engineering one.

**`minGapDays` on `rare` is declared but not yet enforced.** The field exists
and is tested as data; wiring it needs history threaded into enumeration,
where a history-dependent hard rule can make the catalog infeasible in ways
that are hard to diagnose. The 1-per-week cap and a negative affinity already
make `rare` behave rarely.

**Nothing is calibrated.** `affinity`, `repeatValueRatio` and the proposal
thresholds are defensible priors. The design makes that safe — an untiered
catalog is unchanged, and the retry means tiering cannot do worse than not
having it — but after a month of real tiering the question is whether a staple
appearing ~1.5 times a week matches what you meant by "3-4 times a week".

**Tier and learned preference are not reconciled.** A dish you tiered `staple`
and then repeatedly swapped away from will carry a positive affinity and a
negative learned score at the same time. They simply add. That is defensible —
you said one thing and did another, and the planner splits the difference —
but it is not *designed*, and the proposals screen is currently the only place
the contradiction surfaces.
