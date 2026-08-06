# Phase 3 Integration — reconcile the optimizer work with the expanded catalog

**Status:** Ready to build. Nothing implemented yet.
**Prerequisite reading:** this file, then `docs/PHASE3_REPORT.md` (on the
optimizer branch), then `CLAUDE.md`.
**Scope:** a merge and a re-verification. **No new features, no new meals, no
new optimisations.**

---

## 1. The situation

Two branches exist. **Neither is merged to `main`, and each is missing the
other's work.**

| | `claude/meal-planner-phase2-database-fd0pu2` | `claude/meal-planner-phase3-optimizer-b99g6k` |
|---|---|---|
| Base | `18f031a` | `18f031a` (**same base — they diverged**) |
| Catalog | **97 meals**, 83 ingredients | 41 meals, 68 ingredients |
| Tests | **124** | 103 |
| Optimizer | original, ~2,000ms at 97 meals | **Tier 1 done, 4.9× faster** |
| Docs | Phase 2 §9/§10, `PHASE3_HANDOVER.md` | `PHASE3_REPORT.md` |

### How this happened

Phase 2 was completed on a branch and **never merged to `main`**.
`docs/PHASE3_HANDOVER.md` was committed to that same unmerged branch. The Phase 3
session was started from `main`, so it could see neither the handover nor the
97-meal catalog. Its §0 correctly reports "the handover does not exist" and
"Phase 2 has not shipped" — that was an accurate description of `main`.

**This is a process failure on our side, not a fault in the Phase 3 work.** The
Phase 3 agent behaved well: it detected the mismatch, reconstructed the intent by
synthesising a 99-meal catalog, verified the optimisation was still the right
work, and said clearly what a reviewer should check. Its report is trustworthy.

### The consequence

Merging the optimizer branch as-is **reverts all of Phase 2** — 56 meals, 15
ingredients, the tag-derivation work, the fibre grams, 21 tests, and two docs.

---

## 2. Order of operations — this matters

**Replay the optimizer work on top of the catalog, never the reverse.**

The Phase 2 branch is the trunk. The optimizer branch contributes changes to
exactly three files:

```
src/lib/planOptimizer.js      (the Tier 1 work — 331 lines changed)
tests/planOptimizer.test.js   (+1 test: shortlist tie-break stability)
CLAUDE.md                     (test-count line only — discard, ours is newer)
```

Everything else on that branch is either untouched or is the pre-Phase-2 state of
a file Phase 2 rewrote. **Do not take those.**

Suggested mechanics — cherry-pick the four perf commits onto a branch cut from
Phase 2, resolving `planOptimizer.js` in favour of the optimizer version *except*
where §3 below says otherwise:

```
df5661f  perf(optimizer): memoise per-meal derived facts
00e6f3f  perf(optimizer): stop redoing work the enumeration already knows
448b792  perf(optimizer): score the candidate set once, not twice
865b23e  perf(optimizer): select the shortlist's 60 instead of sorting all of them
```

Skip `49d8a92` (test-count doc edit — wrong for the merged tree) and `1be8480`
(the report; copy the file across instead, it is worth keeping).

---

## 3. The merge hazard — read before resolving any conflict

Phase 2 fixed two silent protein-family classification bugs. **The fix lives in
both `mealDataLayer.js` and `planOptimizer.js`, and the optimizer branch predates
it, so it carries the old patterns.**

| | Phase 2 (correct) | Optimizer branch (stale) |
|---|---|---|
| fish pattern | includes `mackerel`, `sardines?`, `anchov(y\|ies)` | omits them |
| red meat | `keema`/`kofta` only count when nothing else identifies the protein | `keema`/`kofta` always count |

If the resolution takes the optimizer branch's `planOptimizer.js` wholesale:

- `Mackerel & quinoa salad` and `Sardines on toast + avocado` become
  **vegetarian** again.
- `Soya keema curry + jowar roti` becomes **red meat** again and starts spending
  the 3-per-week red-meat budget.
- `Kofta + dal + jowar roti` regresses the same way.

**And it gets worse than before:** `mealFacts()` now caches protein family in a
`WeakMap`, so a wrong answer is computed once and reused everywhere. The bug
would be both reintroduced and hardened.

**Required:** after merging, `FAMILY_PATTERNS` and `FAMILY_COUNT_PATTERNS` in
`planOptimizer.js` must match Phase 2's versions, and `inferProteinFamily` in
`mealDataLayer.js` must retain its `hasDefiniteRedMeat` / `hasVegetarianProtein` /
`hasAmbiguousMince` structure. `tests/mealDatabase.derivation.test.js` and the
catalog tests should catch a regression — confirm they do rather than assuming.

---

## 4. Re-verification — the equivalence proof must be redone at 97 meals

The optimizer branch proves byte-identical output **against the 41-meal catalog**.
Its report notes the argument is catalog-independent and that measurements should
be re-taken if a 97-meal catalog exists. It does, so re-take them.

**Baseline first, from the Phase 2 branch with the original optimizer:**

```bash
git checkout claude/meal-planner-phase2-database-fd0pu2
npm run audit:generation > /tmp/audit-97-before.txt
npm run test:logic 2>&1 | grep -E '^# (tests|pass|fail)'   # expect 124 passing
```

**Then, after the merge:**

```bash
npm run audit:generation > /tmp/audit-97-after.txt
diff <(grep -v 'optimizer runtime' /tmp/audit-97-before.txt) \
     <(grep -v 'optimizer runtime' /tmp/audit-97-after.txt) && echo "IDENTICAL ✓"
```

An empty diff is the contract. Every combination count, every percentage, all
seven chosen days, and the weekly protein total must be unchanged.

Two things specific to the bigger catalog that the 41-meal proof could not
exercise, and that must be checked deliberately:

1. **`mealFacts` cache keying.** It is a `WeakMap` on object identity, assuming
   meal objects are stable and never mutated. Phase 2 builds every meal through
   `buildMeal()` in `mealDatabase.js` (compute macros → derive tags → layer
   hand-authored tags → `enrichMealForDataLayer`). Confirm the exported objects
   are module-level singletons and that nothing downstream clones or mutates
   them. `buildPromotedCustomMeal` in `App.jsx` constructs meals at runtime —
   check it cannot produce a mutated object that lands in the cache.
2. **The derived tags Phase 2 added.** `has_fibre` is now derived from
   `macros.fibre >= 3`, and `planOptimizer.hasFibre` prefers the real number and
   only falls back to the name regex. Verify the memoised `mealFacts` preserves
   that precedence and did not re-freeze the old regex-first behaviour.

---

## 5. Acceptance criteria

1. `diff` in §4 is **empty** — audit output identical except the runtime line.
2. `npm run test:logic` green at **125 tests** (124 from Phase 2 + the optimizer
   branch's shortlist tie-break test). If the number differs, account for it.
3. The planner regression snapshot in `tests/planner.regression.test.js` is
   **unchanged from the Phase 2 branch's value** (`Mackerel & quinoa salad` at
   dinner). If it moves, the merge changed behaviour — stop and investigate.
4. Protein-family classification verified per §3: mackerel and sardines are
   `fish`, `Soya keema curry` and `Kofta + dal + jowar roti` are `vegetarian`,
   `Mutton keema` is still `red_meat`.
5. Catalog is **97 meals / 83 ingredients**, macro↔calorie consistency 97 of 97.
6. Runtime at the real 97-meal catalog measured as a **median of 5 runs** and
   recorded. Expect roughly 2,000ms → 400–600ms; the report's 4.9× was at
   114k candidates and ours is 72,930, so do not assume the same multiple.
7. **`docs/PHASE3_REPORT.md` is carried across** to the merged branch.

---

## 6. Then close the loop that caused this

Once the merged branch is green, **merge it to `main`.** This whole problem is
that two sessions branched from a `main` that was months behind the work. Long-
lived unmerged branches are the root cause, not a detail.

`main` auto-deploys to Vercel production, so:

- Confirm the audit passes and the full suite is green *before* merging.
- `npm run build` must succeed.
- Merge, then verify the deployment.

Update `CLAUDE.md`'s "Recent Architectural Shifts" and the Known Gotchas runtime
row with the post-merge numbers, and mark `docs/PHASE3_HANDOVER.md` as delivered
with a pointer to `PHASE3_REPORT.md`.

---

## 7. What is explicitly NOT in scope

- **Tier 2 and Tier 3** of `PHASE3_HANDOVER.md` §4. The report's §4.1 notes the
  full sort in `selectWeek` is the largest remaining cost and that removing it
  requires restructuring `trimCandidatePool`, which changes which candidates the
  search sees. That is Tier 2. Not now.
- **New meals.** A batch is queued, but it goes in *after* this merge is green,
  against a fast optimizer.
- **Any change to `src/lib/rules.js`.** Unchanged since Phase 1 and staying that
  way.
- **Re-litigating the optimizer work.** It was measured, reviewed and is sound.
  This phase moves it onto the right base; it does not second-guess it.

---

## 8. Report back

- The `diff` from §4, or an exact account of what changed and why
- Test count, and the planner regression snapshot value
- Protein-family spot-checks from §5.4
- Runtime before and after **on the real 97-meal catalog**, median of 5
- Whether `main` was merged, and whether the Vercel deployment came up clean
- Anything in §3 or §4.1–4.2 that turned out to be a non-issue — knowing which
  hazards were imaginary is worth as much as knowing which were real
