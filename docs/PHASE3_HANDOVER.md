# Phase 3 Handover — Unblock the Optimizer

**Status:** Ready to build. Nothing implemented yet.
**Prerequisite reading:** this file, then `CLAUDE.md` (especially "The rule model"
and "Hybrid Generation Pipeline"). `docs/PHASE2_HANDOVER.md` §10.4–§10.5 is where
this work was first identified; everything from there is restated below, so you
do not need to read it first.
**Scope:** `src/lib/planOptimizer.js` only. This is a performance phase — **no
rule, threshold, or meal changes.**

---

## 1. Why this work exists

Phase 1 made the rules real. Phase 2 and the 2026-08-03 research batch grew the
catalog from 41 meals to **97**, and joint Tier-2 compliance from 0.9% to
**12.1%**. The data is in good shape. The engine that consumes it is now the
bottleneck.

The deterministic pass (`buildWeekPlan`) runs **client-side, on the user's
device, before the Anthropic call**. Browser JavaScript is single-threaded, and
that thread also draws the screen — so for the whole duration the UI is frozen.

| Catalog | Combinations | Runtime |
|---|---|---|
| 41 meals | 3,250 | 322ms |
| 69 meals | 21,672 | 780ms |
| **97 meals (now)** | **72,930** | **~2,000ms** |

Enumeration is `breakfasts × lunchDinner²`. Lunch and dinner draw from the same
pool, so each new lunch/dinner dish adds roughly `breakfasts × 2 × pool` new
combinations — about **2,200 at today's size, and rising**. The catalog doubled
and the work grew 22x.

**More meals are queued and waiting on this.** That is the point of the phase:
make adding meals cheap again.

---

## 2. The measurement — where the 2 seconds actually goes

Median of 5 runs, 72,930 combinations, 97-meal catalog. Reproduce with the
profiling recipe in §6.

| Step | Cost | Scales with catalog? |
|---|---|---|
| `enumerateFeasibleDays` | 314ms | yes |
| Score every candidate + object spread (`selectWeek`) | 387ms | yes |
| Sort all candidates (`selectWeek`) | 220ms | yes |
| `buildSlotShortlists` (scores + sorts **again**) | ~700ms | yes |
| **Beam search proper** | **~350ms** | **no — fixed** |

**~1,600ms of the ~2,000ms scales with the combination count. Only ~350ms is
fixed.**

Read that carefully, because it inverts the obvious assumption: **the clever
part is not the problem.** The beam search is already bounded — `trimCandidatePool`
(line 352) caps the pool at 960 candidates, so the search costs the same no
matter how big the catalog gets. Every expensive thing is the bookkeeping that
happens *around* it: building 72,930 day objects, scoring them all, sorting them
all, and then discarding all but 960.

This is good news. It is waste, not fundamental difficulty, and most of it comes
out without changing a single result.

---

## 3. The specific waste sites

All line numbers are `src/lib/planOptimizer.js` at commit `8a020a1`.

### 3.1 The whole candidate set is scored and sorted TWICE *(biggest single win)*

`buildWeekPlan` (708) calls `selectWeek` (449) and then `buildSlotShortlists`
(652), passing the same `dayCandidates` to both.

- `selectWeek` line 475: `scoreDayStandalone(candidate, …)` over all 72,930,
  then sorts all 72,930.
- `buildSlotShortlists` line 665: `scoreDayStandalone(candidate, …)` over all
  72,930 **again**, then sorts all 72,930 **again**.

Same function, same `rules`, same `preferences`, same `historyMap`. The second
pass then keeps only `DEFAULT_ALTERNATE_DAYS` of them.

**Fix:** have `selectWeek` return its already-scored, already-sorted pool and
pass it into `buildSlotShortlists`. Expect **~600ms**.

**Care required:** the two sorts differ. `selectWeek` breaks ties on
`a.mealNames.join('|')`; `buildSlotShortlists` does not. Reuse `selectWeek`'s
ordering (it is the more deterministic of the two) and confirm the shortlists
are unchanged — see §5.

### 3.2 Per-meal properties recomputed inside per-combination loops

`scoreDayStandalone` (230) calls, for each of 3 meals, on each of 72,930 days:

| Helper | Line | Cost |
|---|---|---|
| `getFibreScore` | 84 | 3 regex tests over a built string |
| `hasFibre` | 100 | numeric, but re-reads macros |
| `getProteinFamily` | 70 | tag lookup, regex fallback |
| `hasRepeatedFamilyInsideMeal` | 106 | 3 global regexes over the name |
| `isHeavyMeal` / `isCarbHeavyMeal` / `isFatHeavyMeal` | 111–114 | arithmetic |
| `getMealName` | 36 | `String()` coercion, called everywhere |

That is **218,790 per-meal lookups to describe 83 distinct meals — a redundancy
factor of 2,636x**, and several of them are regex.

**Fix:** compute a per-meal property record once (a `Map` keyed by meal object
or `meal_id`) and read from it. Expect **~300ms**.

### 3.3 `satisfiesDayHardConstraints` re-checks what was already filtered

`enumerateFeasibleDays` (187) pre-filters both pools with `isMealAdmissible`,
then calls `satisfiesDayHardConstraints` (163) per combination, which calls
`isMealAdmissible` again on all three meals. **The pool membership already
guarantees it.**

The only checks that genuinely need to run per combination are "no meal twice in
a day" and the 50g protein sanity floor.

**Also:** `summariseDay` (149) runs twice per combination — once inside
`satisfiesDayHardConstraints` for the sanity floor, once inside `annotateDay`
(207). Compute totals once and pass them.

**Also:** `{ rules, preferences }` is allocated fresh on every `isMealAdmissible`
call, and `CORE_SLOTS.map(…)` allocates a new array twice per combination.
~500,000 short-lived allocations. Hoist them.

Expect **~200ms** across §3.3.

### 3.4 The per-candidate object spread

`selectWeek` line 473 does `{ ...candidate, baseScore }` for all 72,930
candidates — a full object clone each. Measured at 387ms including the scoring;
scoring alone without the spread was 412ms in a separate run, so the spread is
within noise of free *on its own* but it doubles peak memory, which matters on a
phone. Attach `baseScore` to the existing object or keep a parallel array.

---

## 4. The work, in three tiers

### Tier 1 — pure speedups, no behaviour change *(do this first)*

Everything in §3. **The generated plan must come out byte-identical.** That is
not an aspiration, it is the acceptance test (§5).

- Target: **~2,000ms → ~900ms** at 97 meals.
- Headroom bought: comfortable to ~130 meals.
- Effort: roughly a day.
- Risk: low. No logic changes, only when and how often things are computed.

### Tier 2 — stop materialising every combination

Today `enumerateFeasibleDays` builds all 72,930 annotated day objects, and
`trimCandidatePool` then keeps 960. Instead, enumerate and retain in one pass:
keep a bounded best-N per budget-compliance class as you go.

**Do not turn this into a naive "top N by score" trim.** The comment at line 344
records why: only a minority of combinations reach the 1600 kcal floor, those
days are *not* the highest-scoring ones, and a naive trim deletes exactly the
days the week needs. Keep the stratification `trimCandidatePool` already does.

Derive the slot shortlists from the retained pool too.

- Target: **~900ms → ~400ms**, and peak memory down by an order of magnitude.
- Headroom bought: ~200 meals.
- Effort: a few days.
- Risk: medium — this changes which candidates the beam sees. Expect the
  regression snapshot to move, and justify it.

### Tier 3 — beat the quadratic itself

Index lunch/dinner by macro bucket. Once a breakfast is fixed, the protein,
calorie and carb range that lunch+dinner must land in is known — so look up only
pairs that could satisfy it instead of testing all `pool × (pool-1)`.

- Headroom bought: thousands of meals.
- Effort: a week or so.
- Risk: high. Needs its own correctness argument that no legal combination is
  missed. **Only start this when the catalog is actually approaching 200.**

### Complementary — Web Worker

Move `buildWeekPlan` off the main thread so the UI stays responsive and a real
progress indicator becomes possible. This **does not make the work smaller** —
do it alongside Tier 1, never instead of it.

---

## 5. Acceptance criteria

Tier 1 is done when:

1. `npm run audit:generation` produces output **identical to the pre-change
   baseline except the runtime line** (see §6 for the diff recipe). Same
   combination counts, same percentages, same 7 chosen days, same weekly protein.
2. `npm run test:logic` is **fully green at 124 tests**, with the planner
   regression snapshot **unchanged** (`tests/planner.regression.test.js`).
3. Runtime at 97 meals is **under 1,000ms**, measured as a median of 5 runs.
4. The scaling curve is re-measured and recorded (§6 has the script).
5. No change to `src/lib/rules.js`, `src/data/mealDatabase.js` or
   `src/data/ingredients.js`. If you think a rule needs to change to make this
   work, stop — you have misunderstood the task.

Tier 2 additionally:

6. Any change to the generated week is **justified with the measurement**, in the
   commit message, the way Phase 1 justified removing the hard dinner taper.
7. Joint Tier-2 compliance stays at **12.1%** and the generated week stays at
   **7/7/7** with weekly protein at 100% of nominal.

---

## 6. How to measure

**Baseline before you touch anything:**

```bash
npm run audit:generation > /tmp/audit-before.txt
```

**After each change:**

```bash
npm run audit:generation > /tmp/audit-after.txt
diff <(grep -v 'optimizer runtime' /tmp/audit-before.txt) \
     <(grep -v 'optimizer runtime' /tmp/audit-after.txt) && echo "IDENTICAL ✓"
```

That diff being empty is the Tier-1 contract.

**Profiling harness** — write a throwaway script that imports
`enumerateFeasibleDays`, `scoreDayStandalone` and `buildWeekPlan` directly and
times each over 5 runs, taking the median. Time the steps separately; the whole
point of §2 is that the aggregate number hides where the cost is.

**Scaling curve** — synthesise larger catalogs by cloning real meals under new
names with lightly perturbed macros, and time the real optimizer against them.
Do not extrapolate; the Phase 2 finding came from measuring 53 → 142 meals
directly.

---

## 7. Landmines

- **`npm install` is required.** `npm run db:pack` imports `xlsx`. Tests and the
  audit run on plain Node without it.
- **Determinism is a feature.** `tests/planner.regression.test.js` asserts the
  same input gives the same week across 25 runs. Any `Map`/`Set` iteration you
  introduce must have a stable order, and object-keyed `Map`s must not leak
  identity into ordering.
- **`trimCandidatePool` is stratified on purpose.** Line 344 explains why. Do not
  "simplify" it to a top-N.
- **The beam search is already bounded.** Do not optimise it first; §2 shows it
  is ~350ms of a 2,000ms problem.
- **Preferences and history are per-request.** Any memoization of *day*-level
  scores must be invalidated when `preferences` or `historyMap` change. Per-*meal*
  property memoization (§3.2) is safe because those properties depend only on the
  meal — except `isMealAdmissible`, which reads `preferences.avoids`.
- **Do not touch the persistence layer.** `CLAUDE.md` documents three hard-won
  sync invariants. This phase has no reason to go near `storageGet` /
  `saveToStorage`.
- **`main` auto-deploys to Vercel production.** Develop on a `claude/<description>`
  branch.
- **The auto-generation `useEffect` hooks are deliberately disabled** (`if (false)`).
  Keep them off.

---

## 8. Suggested commit sequence

1. Profiling harness committed under `scripts/` (so the numbers stay
   reproducible), plus the baseline recorded in the commit message
2. §3.1 — stop scoring and sorting the candidate set twice *(biggest win, do it
   alone so the gain is attributable)*
3. §3.2 — per-meal property memoization
4. §3.3 — drop the redundant admissibility re-check, single `summariseDay` pass,
   hoist allocations
5. §3.4 — remove the per-candidate object spread
6. Re-measure the scaling curve; update `CLAUDE.md` and
   `docs/PHASE2_HANDOVER.md` §10.4 with the new numbers
7. *(separately)* Web Worker
8. *(only when the catalog approaches 200)* Tier 2, then Tier 3

Commit and push after each self-contained piece rather than one commit at the
end.

---

## 9. Report back

State plainly, measured rather than estimated:

- Runtime before and after, per tier, as a median of 5 runs
- The `diff` proving the audit output is unchanged (or, for Tier 2, exactly what
  changed and why)
- The re-measured scaling curve, and the catalog size the new code supports
- Anything in §3 that turned out **not** to be worth what this document claims —
  the estimates there are apportioned from a profile, not individually measured,
  and being wrong about one is expected and worth saying
