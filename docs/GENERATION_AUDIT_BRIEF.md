# Generation Quality Audit — brief

**Status:** Not started. This is a diagnosis-and-design brief, not an
implementation ticket.
**Why it exists:** the founder has iterated on rules, models and prompts many
times and keeps getting weeks that are obviously wrong on sight. Each fix has
been correct in isolation and the output has not become reliably good. That
pattern is the subject of this audit, not any individual rule.

---

## 1. Read this before proposing anything

**Do not start by adding or tuning rules.** That is what has been tried, and the
recurrence is the evidence it is not the lever. Two of the three defects found
most recently were not "wrong thresholds":

- A whole day repeating verbatim broke **no rule at all** — the rule did not
  exist. Per-meal repeat caps allow each meal twice, so two identical days were
  legal.
- The auto-generation path **never called the validator**. It wrote the model's
  answer straight to storage. Every week-level rule was advisory on the path
  that was actually producing the founder's weeks.

Both are now fixed (commit `86d5840`). They are described here because they
characterise the failure mode: **rules are added to the component that is easy
to reason about, then not enforced on the path that reaches the user.**

---

## 2. The architecture, and where it leaks

```
Phase 1  planOptimizer.js   enumerate legal days → beam-search a whole week
                            that satisfies every week-level rule
                                    │
                            emits: a valid reference week
                                   AND flat per-slot shortlists
                                    │
Phase 2  planService.js     AI picks one name per slot per date from the
                            shortlist enums
                                    │
Phase 3  planValidator.js   validate, repair deterministically
                                    │
                            written to Firestore
```

**The leak is between Phase 1 and Phase 2.** Phase 1 solves a *week*. What it
hands over is a per-date, per-slot list of names — a structure that has thrown
away every week-level property it just worked to satisfy. The AI then picks
freely from those lists. Nothing in the shortlist representation prevents it
choosing the same three meals on two different dates, or spending the whole
red-meat budget, or anchoring five dinners on the same ingredient.

Phase 3 is therefore the *only* thing standing between a recombined week and
the user. That is a fragile position for it to be in, and it is exactly the
position that produced the reported bug when one caller forgot to run it.

**Questions this audit should answer:**

- Should Phase 2 exist at all in its current form? What does the AI's
  recombination add over Phase 1's already-valid week? Measure it — do not
  assume the answer is "variety".
- If it stays, should it be re-shaped so week-level rules are *structurally*
  unbreakable (e.g. the AI picks between whole candidate *weeks*, or between
  whole *days*, rather than independently per slot)?
- Is Phase 3's repair strategy right? It currently repairs Tier-1 only —
  budgeted (Tier-2) violations are detected and then ignored.

---

## 3. The catalog is about to become the moving part

The founder is going to edit the meal database heavily and continuously —
removing dishes that never get cooked, adding ones that do. **The current
process for this is not defined and does not scale.** Today a meal is added by
an agent hand-writing an object into a 2,200-line JS file, with correctness
resting on that agent remembering to also update `handAuthoredTags`, run
`db:pack`, and re-run the audit.

Recent evidence that this is fragile:

- Meals were added that the founder found implausible on sight (a paneer and
  egg-white bhurji; a rajma-and-paneer bowl). They were nutritionally valid and
  culturally odd. **Nothing in the pipeline checks whether a dish is a thing a
  person would actually cook.**
- Two classification bugs shipped and were caught only by chance: mackerel and
  sardines classified `vegetarian`; `\bprawn\b` not matching "prawns".
- A `chickpea_pasta` entry was nearly stored as dry weight in a table where
  every comparable ingredient is cooked weight.

**Questions this audit should answer:**

- What is the right *authoring interface* for meals? A schema plus a validator
  the founder can run? A review queue? Something in the app itself?
- What automated checks should gate a meal entering the catalog, beyond the
  existing macro/calorie consistency test?
- How should "this dish is culturally implausible" be caught, given it is a
  judgement no macro check will ever make?
- The founder wants a select-and-add flow for meals they have eaten. That is
  parked, but design for it — it is the intended growth path.

---

## 4. What good looks like

The founder's stated standard, in their words: a plan should be **protein +
vegetables + carbs**, varied, with one Indian and one international meal most
days, and no ingredient dominating the week.

Note that only part of that is currently expressed anywhere in code. There is
no rule about a meal being a *complete plate*. "Overuse of paneer in all kinds
of absurd ways" is a real observation with no corresponding check.

**Questions this audit should answer:**

- What is the smallest set of properties that, if guaranteed, would make a week
  acceptable on sight? Derive it from the founder's actual complaints, which are
  in the git log and in `docs/` — not from first principles.
- Which of those are currently unexpressed, and which are expressed but
  unenforced on some path?
- Is the three-tier model (hard / budgeted / scored) still the right shape?

---

## 5. Constraints on your recommendations

- **This is a single-household app.** Do not design for scale, multi-tenancy, or
  a meal catalog in the thousands. Roughly 110 meals today, plausibly 200. The
  founder has explicitly and repeatedly asked for less sophistication, not more.
- **The founder is non-technical.** Any process you propose that requires them
  to hand-edit JavaScript, run a build step, or reason about a beam search is
  the wrong answer.
- **Prefer deleting a mechanism to adding one.** If Phase 2 cannot justify
  itself, saying so is a valid and valuable outcome.
- **`main` auto-deploys to Vercel production.** Do not merge without the audit,
  the full suite, and a build passing.

---

## 6. What to produce

A written recommendation, not code. Specifically:

1. **A diagnosis** of why plan quality has stayed unreliable across many
   iterations. Ground it in the code and the git history, not in speculation.
2. **A decision on Phase 2** — keep as-is, re-shape, or remove — with the
   measurement that justifies it. If you recommend keeping it, show what it
   contributes that Phase 1 alone does not.
3. **A meal-database management process** the founder can actually operate,
   covering add, edit, remove, and review.
4. **The rule set that follows from §4**, including which existing rules should
   be deleted. A shorter list that is fully enforced beats a longer list that is
   partly advisory.
5. **A prioritised implementation plan**, smallest-first, each step independently
   shippable and verifiable by `npm run audit:generation`.

State plainly anything you could not determine, and anything you think the
founder is wrong about — including anything in this brief.

---

## 7. Orientation

| File | What it is |
|---|---|
| `CLAUDE.md` | Start here. Rule model, pipeline, sync invariants, gotchas. |
| `src/lib/rules.js` | Every threshold. Single source of truth. |
| `src/lib/planOptimizer.js` | Phase 1 — enumeration, scoring, beam search. |
| `src/lib/planService.js` | Phase 2 — the AI call and its tool schema. |
| `src/lib/planValidator.js` | Phase 3 — validation and deterministic repair. |
| `src/data/mealDatabase.js` | The catalog. 110 meals. |
| `src/data/ingredients.js` | 92 ingredients. All macros derive from here. |
| `src/App.jsx` | Both generation entry points: `handleRegenerateWeek` and the auto-generation `useEffect` pair. |
| `npm run audit:generation` | Enumerates and scores; `--goal standard` for the other goal. |
| `docs/PHASE1_HANDOVER.md` §9 | What the rule model was measured against. |
| `docs/PHASE2_HANDOVER.md` §9–§10 | Catalog work and its measurements. |
| `docs/PHASE3_REPORT.md` | Optimizer performance work. Mostly not relevant here. |

Read the last ~15 commits. The founder's complaints are quoted in the commit
messages, which is the most direct record of what "wrong" has actually meant.
