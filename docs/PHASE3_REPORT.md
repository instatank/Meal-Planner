# Phase 3 Report — Unblock the Optimizer

**Branch:** `claude/meal-planner-phase3-optimizer-b99g6k`
**Base:** `18f031a` (`main` at time of work)
**Date:** 2026-08-05
**Scope executed:** Tier 1 only — waste removal, no behaviour change.

---

## 0. Read this first — the brief's premises did not match the repo

The task pointed at `docs/PHASE3_HANDOVER.md`. **That file does not exist in this
repository.** Its §2 profile, §3 waste-site list with line numbers, §5 acceptance
criteria, §6 diff recipe and §8 commit sequence were therefore all unavailable.

The task also cited `docs/PHASE2_HANDOVER.md` §9/§10, and §10.4 as where this work
was first identified. **That file has no §9 or §10** — it runs §1–§8 and is the
*brief for* Phase 2, not a record of it.

**Phase 2 has not shipped.** Measured on the base commit:

| Quantity | Brief stated | Actually measured on `18f031a` |
| --- | --- | --- |
| Catalog size | 97 meals | **41** (7 breakfast, 26 lunchDinner, 8 snack) |
| Joint Tier-2 compliance | 12.1% | **0.9%** |
| Day candidates enumerated | 72,930 | **3,250** |
| Deterministic pass cost | ~2,000 ms | **~185 ms** warm / ~310 ms cold |
| Beam search share | ~350 ms of 2,000 ms | see §3 — overstated ~2× |

### Why the work was done anyway rather than blocked

The numbers reconcile once you assume the brief was written against the
*post-Phase-2* catalog. Synthesising a 99-meal catalog in memory (see §6.3)
reproduces the brief's profile almost exactly:

```
99 meals → 114,114 candidates → 1,846 ms
```

versus the brief's "97 meals → 72,930 candidates → ~2,000 ms". Same order of
magnitude, same shape, same conclusion. The optimisation is therefore the correct
preparation for the catalog growth queued behind it — it is simply being done
*before* Phase 2 rather than after.

Proceeding was safe because the acceptance test was restated in the task message
itself (byte-identical audit output except the runtime line; planner regression
snapshot unmoved), so §5 was not actually needed to execute faithfully. Nothing
in `src/lib/rules.js` or `src/data/` was touched, and no threshold was changed.

**A reviewer should confirm whether Phase 2 was expected to have landed before
this branch.** If a 97-meal catalog exists elsewhere and simply was not merged,
the measurements in §4 should be re-taken against it. The equivalence proof in
§5 is catalog-independent and still holds.

---

## 1. What changed

Five commits, `src/lib/planOptimizer.js` plus one test:

```
df5661f perf(optimizer): memoise per-meal derived facts
00e6f3f perf(optimizer): stop redoing work the enumeration already knows
448b792 perf(optimizer): score the candidate set once, not twice
865b23e perf(optimizer): select the shortlist's 60 instead of sorting all of them
49d8a92 docs: test count is 103 after the optimizer selection test

 CLAUDE.md                   |   2 +-
 src/lib/planOptimizer.js    | 331 ++++++++++++++++++++++++++++++++-----------
 tests/planOptimizer.test.js |  51 +++++++
```

### 1.1 `df5661f` — memoise per-meal derived facts

Every per-meal derivation the scorer needs — protein family, fibre score, the
heavy / carb-heavy / fat-heavy shape flags, the repeated-family check — is a pure
function of one meal, but the search called them once per *combination*.

At 114k candidates, `getProteinFamily` alone ran its regexes ~340,000 times to
answer 99 distinct questions.

`mealFacts(meal)` computes each meal's derived properties once and caches them in
a `WeakMap` keyed by object identity. It sits *in front of* the existing exported
accessors rather than restating them, so the two cannot drift apart.

`scoreDayStandalone` now walks a day's three meals once instead of ten times
(it previously ran seven separate `filter`/`map` passes plus three more).

**Correctness note:** the user-preference loop was deliberately left as its own
pass accumulating into `score` in the original order. Floating-point addition is
not associative; batching those terms into a subtotal and adding it once shifts
the low bits and can flip a tie in the candidate sort. This was caught before
measurement, not after.

**Cache assumption:** keyed by object identity, which assumes a meal object is
not mutated in place after being scored. Nothing in the app does this — meals come
from the static catalog or from fixtures, and edits replace the object rather than
patch it. If a future feature starts patching meal objects in place, this cache
must be invalidated.

### 1.2 `00e6f3f` — stop redoing work the enumeration already knows

Three pieces of bookkeeping around `enumerateFeasibleDays`:

1. **Redundant admissibility re-check.** Both meal pools are pre-filtered for
   admissibility at the top of the function, and then `satisfiesDayHardConstraints`
   re-checked exactly that for all three meals of every combination. What genuinely
   varies per combination is only the same-meal cap and the protein sanity floor,
   so those are now checked inline via `withinSameMealCap`. Rejected combinations
   no longer allocate a day object on the way to being discarded, and the
   breakfast+lunch macro subtotals are hoisted out of the innermost loop.
2. **Double summation.** `annotateDay` summed the day a second time immediately
   after `satisfiesDayHardConstraints` had already summed it. It now accepts an
   optional pre-computed `totals`.
3. **Repeated string joins.** The candidate sort tie-breaker and the beam's
   per-candidate hash both rebuilt `mealNames.join('|')` on every call — the beam
   once per (node, candidate, day), i.e. `beamWidth` identical copies. The join is
   precomputed once per candidate as `nameKey`, and the beam's tie-breaker is
   hoisted to once per (candidate, day).

`satisfiesDayHardConstraints` itself was left untouched — it is exported and used
by the validator, and the inline check is deliberately a specialisation of it for
the one caller that has already established the pre-conditions.

### 1.3 `448b792` — score the candidate set once, not twice

The week search and the shortlist builder each independently computed the same
number for every candidate: `scoreDayStandalone` less the history penalty. Two
full scoring passes to answer one question; at Phase-2 scale the second pass cost
about as much as the beam search it fed.

New export `scoreCandidates(candidates, { rules, preferences, historyMap })` does
it once. `buildWeekPlan` calls it and passes the result to both consumers via a
new optional `scoredCandidates` parameter. Either function still scores for itself
when called standalone, so the exported API is backwards-compatible.

The score is now stamped on the candidate rather than carried in a wrapper object
built per candidate — the search allocated one such object for each of 114k
candidates, then discarded all but `maxCandidates` (960) of them immediately.

Both consumers sort a **copy**, so the original candidate order each relies on for
its own stable sort is preserved.

### 1.4 `865b23e` — select the shortlist's 60 instead of sorting all of them

`buildSlotShortlists` sorted the entire candidate set to keep the best 60 — at
Phase-2 scale, sorting 114,114 candidates to use 60 of them.

`topByBaseScore(candidates, limit)` maintains a bounded list of the best `limit`
instead. Most candidates fail a single comparison against the worst kept entry and
cost nothing further; survivors are placed by binary search into a list of 60.

**The subtle part.** Selection is only safe here if it breaks ties the way the
stable sort it replaces did — earliest candidate first. That falls out of the
strict `>` test: a candidate displaces the worst kept entry only when it scores
*strictly* higher, so among equal scores the earliest-seen one stays.

This is pinned by a new test (§5.4) that compares against a stable-sort reference
at deliberately high tie density, and was mutation-tested (§5.5).

---

## 2. Acceptance criteria

### 2.1 Audit output — the complete diff, nothing excluded

```
$ diff baseline-audit.txt after-final.txt
32c32
< optimizer runtime                 287ms over 3250 candidates
---
> optimizer runtime                 207ms over 3250 candidates
```

One line, and it is the runtime line. All 51 other lines — combination counts,
compliance percentages, the seven generated days with their meals and macros,
distinct meal count, red-meat count, all seven acceptance criteria, and the
catalog-headroom section — are byte-identical.

### 2.2 Regression suite

```
# tests 103
# pass 103
# fail 0
```

102 before; the one addition is the tie-break test in §5.4. The planner regression
snapshot did not move.

---

## 3. Where the time actually went — the brief's apportionment was wrong

The task warned that §3's per-item estimates were apportioned from an aggregate
profile rather than individually measured, and asked me to say so if one did not
hold up. **The headline claim does not hold up.**

Measured at 114,114 candidates on the base commit, by timing each phase directly:

| Phase | Cost | Brief's characterisation |
| --- | --- | --- |
| `enumerateFeasibleDays` | 348 ms | — |
| `scoreDayStandalone` × N (in `selectWeek`) | 518 ms | — |
| Candidate clone `{...c, baseScore}` | 65 ms | — |
| Sort (with join tie-break) | 175 ms | — |
| **Beam search alone** | **165 ms** | *"already bounded at 960 candidates and costs ~350 ms"* |
| `buildSlotShortlists` (second full scoring pass) | 541 ms | — |
| **Total** | **1,811 ms** | ~2,000 ms ✓ |

The beam search is **~165 ms, not ~350 ms** — overstated by roughly 2×.

The brief's *thesis* survives intact, and is if anything stronger than stated:
"roughly 1,600 ms is bookkeeping around it" is correct — it is closer to
1,650 ms, i.e. **91% of the pass was bookkeeping**, not the search.

The single largest item was not on the brief's radar as described: the
**duplicate scoring pass in `buildSlotShortlists` (541 ms)**, which alone was
larger than the entire beam search plus the sort combined.

---

## 4. Measurements — median of 5, profiled not estimated

Method: `buildWeekPlan` called with a warmup run discarded, then 5 timed runs,
median reported. Run three times independently on each revision to check stability;
figures below are representative.

| Scenario | Baseline `18f031a` | After | Speedup |
| --- | --- | --- | --- |
| Real catalog (41 meals, 3,250 candidates), warm | 184 ms | **96 ms** | 1.9× |
| Real catalog, audit-reported (cold, JIT-dominated) | 310 ms | **219 ms** | 1.4× |
| Synthetic 99-meal catalog (114,114 candidates), warm | 1,846 ms | **375 ms** | **4.9×** |
| Synthetic 165-meal catalog (553,410 candidates), warm | ~9,000 ms | **1,882 ms** | 4.8× |

The ~2 s of blocked main thread the brief was written to eliminate lands at
**~0.38 s** at the catalog size that produces it.

The cold/audit number improves least because a single cold call is dominated by
V8 JIT compilation rather than steady-state work. In the browser the pass runs
once per regeneration, so the realistic figure sits between the two — but the
scaling behaviour is what matters here, and that is the 4.9×.

### 4.1 Remaining cost distribution (after, at 114k candidates)

| Phase | Cost |
| --- | --- |
| Enumeration + annotation | ~66 ms |
| `scoreCandidates` (single pass) | ~65 ms |
| Sort in `selectWeek` (full sort, feeds stratified trim) | ~135 ms |
| Beam search | ~80 ms |
| Shortlist selection | small (bounded) |

The largest remaining item is the full sort in `selectWeek`. It was **not**
removed: `trimCandidatePool` consumes the globally sorted order to take the best
of each of 8 budget-compliance classes and then backfill, so a partial sort cannot
serve it without restructuring the trim itself. That restructuring changes which
candidates the search sees and is therefore Tier 2 — explicitly out of scope.

---

## 5. Evidence of no behaviour change

Four independent checks, in increasing order of strength.

### 5.1 Audit output
Byte-identical apart from the runtime line (§2.1).

### 5.2 Full test suite
103/103 pass, including the existing planner regression and determinism tests.

### 5.3 Full plan **and shortlists** dumped and diffed against the baseline

The audit never prints the shortlists, so §2.1 alone does not cover them — and the
shortlists are exactly what commits `448b792` and `865b23e` touch. A `git worktree`
was created at `18f031a` and both revisions were driven through the same harness,
serialising the complete result:

- `candidateCount`, `feasible`, full `summary`
- all 7 days: `mealNames`, `totals`, all three Tier-2 verdict flags
- **full `shortlists`** (every slot, every date, in order) and `stats`

across **2 goals × 3 scenarios** (plain / with-preferences / with-history):

```
PLAN + SHORTLISTS BYTE-IDENTICAL ACROSS ALL SCENARIOS
```

Repeated at the synthetic 99-meal catalog, which exercises the trimming, tie-
breaking and selection paths far harder than 3,250 candidates do:

```
SCALED (99-meal, 114k candidates) OUTPUT BYTE-IDENTICAL
```

### 5.4 New test — `shortlist selection breaks ties exactly as a stable descending sort would`

Added to `tests/planOptimizer.test.js`. 200 trials with a seeded deterministic PRNG,
pools up to 200 candidates, limits up to 60, and only 1–4 distinct scores so most
comparisons are ties. Compares `buildSlotShortlists` driven by the bounded selection
against the same function driven by a stable-sort reference.

### 5.5 Mutation testing of that test

The test was verified to actually fail when the invariant is broken:

- Inverting the tie order (`kept[mid].baseScore < score` → `<=`) → **test fails**:
  `bounded selection diverged from the stable sort (size 196, limit 29)`.

Worth recording honestly: the *first* mutation tried (`score > worst` → `score >= worst`)
**passed**. On inspection that variant is a genuine no-op rather than a gap in the
test — an equal-scoring candidate is inserted after its ties, at index `limit`,
and immediately popped. The test is sound; the first mutation was a poor choice.

A separate 3,000-trial randomised fuzz (scratchpad, not committed) also found zero
divergences.

---

## 6. How to reproduce

### 6.1 Acceptance diff

```bash
git checkout 18f031a
npm run audit:generation 2>&1 | grep -v '^npm notice' > /tmp/baseline-audit.txt

git checkout claude/meal-planner-phase3-optimizer-b99g6k
npm run audit:generation 2>&1 | grep -v '^npm notice' > /tmp/after-audit.txt

diff /tmp/baseline-audit.txt /tmp/after-audit.txt   # expect: only the runtime line
npm run test:logic                                   # expect: 103 pass, 0 fail
```

### 6.2 Equivalence harness

Create a worktree at the base commit and import `buildWeekPlan` from each root in
turn, serialising `days`, `summary`, `shortlists` and `stats` to JSON, then `diff`
the two dumps. Vary goal (`high_protein`, `weight_loss`), `preferences` and
`historyMap` — the scoring paths those touch are the ones most at risk.

### 6.3 Scaled-catalog profiling

The 99- and 165-meal catalogs are synthesised **in memory only** by cloning the
real catalog with distinct names and jittered macros
(`protein/cal × (1 + copyIndex × 0.037)`). `src/data/` is never written to.

Note this is a *scaling* proxy, not a prediction of the real Phase 2 catalog: the
jitter changes the macro distribution and therefore the Tier-2 compliance mix. It
is valid for measuring cost-vs-candidate-count and for equivalence testing, which
is all it is used for. Do not quote its compliance percentages as Phase 2 forecasts.

---

## 7. What was deliberately not done

- **Tier 2 and Tier 3** — out of scope by instruction; both change which candidates
  the search sees.
- **The full sort in `selectWeek`** — see §4.1. Removing it requires restructuring
  `trimCandidatePool`, which is Tier 2.
- **Any threshold in `src/lib/rules.js`** — untouched. No rule change was needed;
  the premise that one might be was not encountered.
- **Anything in `src/data/`** — untouched.
- **No PR opened** — not requested.

---

## 8. Notes for whoever picks this up

1. **Re-measure after Phase 2 lands.** All figures above at "99 meals" come from a
   synthetic catalog. Once the real one exists, re-run `npm run audit:generation`
   and the profiling harness; the acceptance-diff method in §6.1 still applies
   against whatever the then-current baseline is.
2. **The `mealFacts` cache assumes meals are immutable.** See §1.1. This is the one
   assumption in the change that a future feature could invalidate.
3. **`scoreCandidates` is now the single definition of a candidate's base score.**
   If a future change needs a third consumer, pass `scoredCandidates` through
   rather than adding a fourth scoring pass — that pattern is what cost 541 ms.
4. **The next real win is the `selectWeek` sort**, and it is a Tier-2-shaped change
   because it means reworking the stratified trim. Worth doing only if the catalog
   goes well past 200 meals.
5. **`docs/PHASE3_HANDOVER.md` is still missing.** If it exists somewhere outside
   the repo, cross-check §3's waste-site list against §1 here — the four sites
   addressed were derived from direct profiling, not from that document, so the
   correspondence is unverified.
