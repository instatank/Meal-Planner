# The feedback and learning system

How the planner finds out whether it is doing a good job, and what it does
with the answer.

Shipped in one pass; every claim below was measured or tested rather than
assumed. Start with §1 if you want the shape, §4 if you want to change a
threshold, and §7 if you want to know what is wrong with it.

---

## 1. The shape

```
     you use the app                    you judge a week
   confirm / skip / swap                accept / reject
   edit / log something else            rate 1-5, reasons, a note
            │                                    │
            └────────────┬───────────────────────┘
                         ▼
              the event log  (one append-only array)
                         │
                         ▼
          preferenceLearning.js  ── dish-level + attribute-level,
                         │           shrunk by evidence, damped by
                         │           specificity, decayed by age
             ┌───────────┴───────────┐
             ▼                       ▼
   planOptimizer.js          InsightsPanel.jsx
   (Tier 3 — ranks,          (what it learned, and
    never gates)              what it has not)
```

Four files carry it:

| File | Holds |
| --- | --- |
| `src/lib/feedbackSchema.js` | Every event type, its fields, and how it reads as a signal. The single source of truth for *what is captured*. |
| `src/lib/planReview.js` | Week-level verdicts: accept/reject, rating, structured reasons, free text. |
| `src/lib/preferenceLearning.js` | Turns the log into preference over dishes and attributes. |
| `src/lib/feedbackAnalytics.js` | The objective readout: adherence, overrides, skips, most-rejected dishes. |

---

## 2. What is captured

Nine event types, defined once in `feedbackSchema.js`. Producers are checked
against those definitions by `tests/feedbackCapture.producers.test.js`, which
scans `App.jsx`, extracts all 11 `appendMealEvent` literals, and verifies each
one writes its required fields and no unknown ones.

That test is not ceremony. Audit finding #6 existed precisely because a
producer and a consumer disagreed across two files and nothing connected them:
`getCustomMealCandidates` grouped on `customMealText`, no producer wrote it,
and the promotion path was therefore empty for months without a single error.
The scan connects them. It was confirmed to bite by deleting a field and
watching it go red.

| Event | Records | Reads as |
| --- | --- | --- |
| `confirm` | meal, protein, cal | +1.0 for the meal |
| `skip` | **meal**, protein, cal | −0.6 |
| `swap` | from → to | −1.0 on `from` only |
| `edit` | original → replacement | −1.0 / +1.0 |
| `custom` | meal, what it displaced, **raw text**, source, **macros** | +1.0 / −0.6 |
| `plan_review` | verdict, rating, reasons, note, dishes | see §3 |
| `undo`, `regen`, `custom_promoted` | bookkeeping | nothing |

Bold marks fields that did not exist before this work. A skip used to record a
date and a slot but not the meal — "I will not eat this" without the "this",
the single largest hole in the capture surface.

**A swap credits only the meal left behind.** `handleSwap` advances through an
ordered list, so the meal arrived at was not chosen, it was next. Crediting it
would teach the planner that whatever sorts after a disliked dish is liked.

**Why `custom` records macros.** A custom meal logged three times in 45 days
becomes a promotion candidate, and a promoted meal enters the catalog the
optimizer trusts completely. `buildPromotedCustomMeal` used to assign every
one of them a flat `{p: 24, c: 42, f: 14}` — safe only because the path was
unreachable, since `getCustomMealCandidates` groups on `customMealText` and no
producer wrote it.

Closing that capture gap switched the path on. So promotion now takes the
**median** protein, calories, carbs and fat across every logged instance, and
**refuses** when no instance carried usable numbers. Median rather than mean:
one mistyped portion would drag a mean far enough to push the meal outside the
calorie bounds, and a hand-typed log is exactly where that happens. Declining
to promote beats promoting a fiction — an invented 24g of protein is not a
placeholder, it is a meal that can be planned to satisfy a floor it does not
meet. Promoted meals are flagged `macrosFromObservation: true`.

**The log is bounded** at 4000 events, newest kept — about three years at four
events a day. It lives in one Firestore document (1MB limit) mirrored into
localStorage (~5MB shared across all keys), and `saveToStorage` swallows a
quota error with a console warning. An unbounded log would not fail loudly; it
would silently stop recording one day. Trimmed on load *and* on append, since
a log can arrive already oversized from a device running an older build.

---

## 3. Week-level review

Three layers, in descending order of how mechanical they are:

1. **Verdict + rating (1–5).** Always comparable, trends over time. **3 is the
   explicit neutral point** and the UI says so, so the learner reads
   `rating − 3` and a middling week moves nothing at all.
2. **Structured reasons.** A fixed vocabulary whose entries name *the same
   attribute keys the learner extracts from meals*. So "too much roti" and
   three roti lunches swapped away land in the same bucket and reinforce each
   other, instead of being two unrelated facts.
3. **A free-text note**, kept verbatim, never parsed. Not decoration — it is
   the only layer that can say something the vocabulary has no word for.

Free text alone was the old design, and it cannot be learned from: "too much
roti this week" and "way too many flatbreads" are one complaint and no counter
was ever going to notice. Parsing them means another model call on every read.

Notes on the design:

- Reason chips are **filtered by verdict**. A stray tap on "good variety"
  inside a rejection would file a positive signal in a negative verdict that
  nothing downstream could disentangle.
- The dish list is stored **on the event**, not re-derived from `mealPlans`.
  Weeks get regenerated, and a review of the week as it stood is not a review
  of whatever replaced it.
- An unrecognised verdict falls back to **rejected**. Failing closed matters: a
  corrupted verdict counted as an accept teaches the planner that a week the
  user hated was good.
- Legacy `rejected-plans` entries are folded into the reader and keep
  `rating: null`. Inventing a 1 because a week was rejected would put a
  fabricated number into the average the dashboard shows.
- `rejected-plans` is still written on rejection, so `scripts/scorePlan.mjs`
  and the export path keep working unchanged.

---

## 4. How learning works

### Why attributes, not just dish names

The previous model counted confirms and swaps against a dish *name*. With 110
meals and a week touching 21, a dish is seen a handful of times a year, so the
counters sit near zero forever. And it cannot represent what people actually
have opinions about: nobody dislikes "Rajma chawal + raita", they dislike
heavy legume lunches, or flatbread twice a day.

Every observation is now credited twice — to the dish, and to each of ten
attributes it carries:

`cuisine` · `primary` (anchor ingredient) · `family` (protein type) · `carb`
(starch form) · `carbLevel` · `weight` · `format` · `effort` · `fatHeavy` ·
`fibre`

Three swaps away from three paneer dishes are three near-zero dish signals but
one clear `primary:paneer` signal — which generalises to paneer dishes never
served.

### Why attributes are weighted by how much they narrow things down

**This is the finding that changed the design.** Measured on the real catalog,
the ten dimensions produce 72 keys, but they are wildly uneven:

| Key | Meals | Specificity |
| --- | --- | --- |
| `fibre:yes` | 91 / 110 | 0.04 |
| `effort:medium` | 70 | 0.10 |
| `cuisine:indian` | 42 | 0.21 |
| `weight:heavy` | 32 | 0.26 |
| `primary:paneer` | 10 | 0.51 |
| `primary:beef_steak` | 3 | 0.77 |

Crediting all keys equally means **one observation reaches a median of 110 of
110 meals**. That is not generalisation, it is smearing: evidence is diluted
into buckets that cannot distinguish any two plans, and the dashboard then
reports "you like fibre" as though it were a finding.

So each key carries `specificity = log(N/df) / log(N)` — standard inverse
document frequency — and the optimizer multiplies a learned score by it.
Buckets still accumulate and are still displayed, with coverage beside them,
so a broad signal reads as broad rather than being silently dropped or
silently overweighted.

### The three constants

All in `preferenceLearning.js`, all documented at their definition:

| Constant | Value | Why |
| --- | --- | --- |
| `PRIOR_STRENGTH` | 6 | Shrinkage. `score = net / (evidence + 6)`, so one event moves a bucket by at most 1/7 and an empty bucket is exactly 0 — not "unknown treated as neutral-ish". |
| `MIN_EVIDENCE_TO_APPLY` | 2.5 | Below this a bucket is shown but withheld from the optimizer. **Not 3**, because evidence is recency-weighted and three real observations never sum to 3: three across a week come to 2.88, across a month 2.60. A floor of 3 rejects exactly the pattern it was written to admit. Three across *three months* sum to 2.04 and correctly stay out. |
| `RECENCY_HALF_LIFE_DAYS` | 70 | Tastes move. A half-life rather than a cutoff, so old evidence fades instead of falling off a cliff and flipping a score on a date boundary. |

---

## 5. Why this cannot wreck a plan

Three independent guards. A learning system that can make plans worse is worse
than no learning system.

1. **Tier 3 only.** Learned preference ranks legal plans; it is never consulted
   where legality is decided. It cannot reach the protein floor, the repeat
   caps, the red-meat cap or the egg-breakfast rule however confident it gets.
2. **Shrinkage.** Bounded to (−1, 1) and pulled toward 0 by lack of evidence.
3. **An evidence floor.** Below it, visible in the dashboard, invisible to the
   optimizer.

Tested in `tests/planOptimizer.learned.test.js`:

- With no learned model, `scoreDayStandalone` returns a **bit-identical**
  result (`Object.is`, 500 real candidates) and `buildWeekPlan` returns a
  byte-identical week and summary. Not "close enough" — the block is skipped
  rather than adding zero, which matters because the neighbouring preference
  pass carries a warning that float addition is not associative and reordering
  can flip a tie in the candidate sort.
- With **every attribute in the catalog set to −1** — a maximally hostile
  model — the optimizer still returns a complete, feasible seven-day week that
  clears the weekly protein floor.
- A learned attribute moves days containing it and leaves days without it
  bit-identical.

---

## 6. Cost

| Measure | Before | After |
| --- | --- | --- |
| `audit:generation` end to end | 1045ms | 1041ms (median of 3, 23688 candidates) |
| Scoring pass, no learned model | 23.0ms | 23.0ms (block skipped) |
| Scoring pass, **saturated** model | — | 89.5ms |
| Bundle | 796KB / 204KB gz | 819KB / 212KB gz |

The saturated case scores all 72 catalog attributes, which the evidence floor
makes unreachable in practice. It is +289% on the scoring pass and **+6.4% on
the full run**, because the pass is 2% of the run. Worth stating both ways.

`attributeKeys` is memoised into `mealFacts` for the reason everything else
there is: the search scores combinations, not meals, so computing ten
derivations per candidate would run them ~100k times to answer 110 distinct
questions.

---

## 7. Known limits

**Exposure bias — the real one.** The planner shows what it already believes
you like, so disliked attributes stop appearing, stop accruing evidence, and
freeze at whatever score they had. A cuisine seen twice is indistinguishable
from one you have no opinion about.

This is **not corrected for**. The honest responses in place instead: every
bucket reports its `exposure`, `getUnderexploredAttributes` names what the
planner is starving (ranked by how much catalog sits behind the gap), and the
dashboard shows both under "Barely tried". Fixing it properly means deliberate
exploration — occasionally planning *against* current belief — which trades a
worse week now for a better model later. That is a product decision about
whose week gets spent on it.

**The legacy dish-name counters still exist.** `derivePreferencesFromEvents`
keeps exactly its audited behaviour (confirm +2, swap −1.2) and is still what
is persisted to `meal-preferences`. The learned model is additive and derived
fresh from the log on every boot, never stored — storing a derived value
beside what it derives from is how the two drift, a failure this codebase has
already paid for twice. The two models are deliberately separate so a
regression in one cannot be hidden by the other. Merging them is a later call,
once there is enough real data to say which weights are right.

**Free-text notes are stored and displayed, never interpreted.** Reading them
needs a model call per review. The structured reasons exist so the common
cases become numbers without one.

**Nothing has been calibrated against real usage.** Every constant here is a
defensible prior, not a fitted value. The system is built so that is safe —
with no evidence it changes nothing, and it shows its working — but the first
real question to ask after a month of use is whether `PRIOR_STRENGTH` and
`RECENCY_HALF_LIFE_DAYS` match how this user actually behaves.

---

## 8. Seeing it

The dashboard is in the app, above the week action buttons: **"What the
planner has learned"**. It shows adherence, week verdicts and ratings, the
signals currently steering plans (with evidence counts and catalog coverage),
signals forming but not yet applied, dishes repeatedly turned down, and the
under-explored gaps.

To see a component render without signing in, `npx vite` and open
`/harness.html` — the app gates on Google auth before the main component
mounts, so this is the only way in a container. `?modal=1` renders the review
sheet. It is dev-only: vite takes just `index.html` as a build entry.
