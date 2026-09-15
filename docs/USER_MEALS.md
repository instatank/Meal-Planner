# Adding your own meals

How a dish you type into the app becomes a dish the planner plans, what stops a
made-up number reaching a week, and how the whole thing gets folded back into
the repo.

Companion to `docs/MEAL_TIERS.md` (how often a dish appears) and
`docs/FEEDBACK_SYSTEM.md` (what the app learns from what you do). This one is
about a dish *existing* in the first place.

---

## 1. The hazard this is built around

The optimizer trusts catalog macros completely. A meal that says it has 30g of
protein is placed to satisfy the 20g per-meal floor, counted toward the 714g
weekly floor, and scored against the 108–132g daily band. It is not a display
figure — it is the input to every hard rule in `rules.js`.

This is not hypothetical. `buildPromotedCustomMeal` used to stamp every
promoted meal with a flat `{p: 24, c: 42, f: 14}`. That was survivable only
because the code path was unreachable; the moment an unrelated fix
(`customMealText` finally getting a producer) switched it on, it became a
function that could write fiction straight into the planner. CLAUDE.md records
it as a pattern worth remembering: *"safely unreachable" is a temporary
property.*

So the rule for this feature is stated once and enforced structurally:

> **No meal reaches the planner without an ingredient rollup.**
> Not an estimate of its protein. An actual list of ingredients from
> `ingredients.js`, with quantities, run through the same `computeMacros`
> every shipped dish uses.

Everything below is the consequence of that one sentence.

---

## 2. Two stores, one door

| Store | Key | Who can see it | What it holds |
| --- | --- | --- | --- |
| **Drafts** | `meal-drafts` | Only the Add-meals screen | A name, a slot, maybe some parts. **The planner cannot reach this.** |
| **User catalog** | `meal-user-catalog` | Everything — planner, optimizer, tiering, learner | Fully-built meals with computed macros |

`mergedMealDatabase` merges the user catalog into the shipped one, which is why
an approved meal needs no new plumbing anywhere: it is already the same shape
as a shipped dish, because it came out of the same function.

The single door between the stores is **approval**, and it is shut unless
`buildUserCatalogMeal` returns a meal. It returns `null` — with a reason the
screen shows — when there is no name, no resolvable parts, or a rollup that
comes out at zero calories. Refusing costs one dish; approving a fiction costs
the integrity of every week that plans it.

### Why not one store with a flag?

Because then every consumer of that store has to remember the flag, and exactly
one of them forgetting is the whole failure mode. A draft is also not a worse
meal — it is a different object, with a status and a lifecycle. Keeping them
apart makes "the planner cannot see a draft" a property of the data model
rather than a rule people have to follow.

---

## 3. How a draft gets its ingredients

### 3.1 Estimated (`mealIngestService.js`)

Claude is asked to express the dish in the ingredients the app already has. The
tool schema's `ingredientId` is an **`enum` of the real ids**, built per request
from the live catalog — so an id that does not exist is structurally
impossible, the same guarantee `planService.buildSubmitPlanTool` gets from
per-slot meal-name enums, applied one level down.

Three things the prompt insists on, each for a reason:

- **Portions, not macros.** The model never supplies a protein or calorie
  figure. Those come from `computeMacros` over IFCT/USDA numbers. Asking for
  both is how a meal ends up with a stated protein its own ingredients
  contradict, and nothing to say which is right.
- **Name what you cannot map.** Kokum forced into "tamarind" to satisfy the
  schema is a wrong dish presented as a right one. `"kokum"` in `unmatched` is
  a one-line ingredient to add. The unmatched list across all drafts *is* the
  ingredient backlog, and the ingestion script prints it ranked by how many
  dishes each would unblock.
- **Decline rather than guess.** An unrecognised dish returns empty `parts` and
  `confidence: low`. That lands as `unresolved`, which is a real state with its
  own copy on screen — not an error.

### 3.2 Corrected

The estimate is shown as **ingredients with editable quantities**, never as an
editable protein figure. Quantity is the only input worth correcting and the
one thing the person who ate the dish reliably knows. An editable output would
invite correcting the number instead of the ingredient, and an edited output is
precisely the fiction this design exists to prevent.

### 3.3 Authored

Some dishes need a new ingredient with a real source behind it. Those stay
`unresolved` and travel in the export. That is the intended slow path, not a
failure — see §4.

---

## 4. Getting them back into the repo

An approved meal already works: it syncs, it is planned, it can be tiered and
rated. What it does *not* have is a sourced nutrition figure or a place in
`src/data/mealDatabase.js`, so it carries `portionsEstimated: true` and lives
only in this user's data.

The handover is a clipboard paste, because the two obvious routes are both
closed: there is no local checkout to run a Firestore reader from, and no admin
credentials to read Firestore with. This is the same constraint that makes
`generateConsolePaste.mjs` the preferred plan-push path over `pushMealPlan.mjs`.

1. **In the app** — Add-meals panel → **"Copy for the database"**. Emits
   `buildIngestionPayload`: approved meals with their parts and tiers, plus
   every draft and its unmatched components.
2. **In a session** — paste it into a file and run:
   ```
   node scripts/ingestUserMeals.mjs payload.json
   ```
3. **The script** rebuilds every meal from *this checkout's* `ingredients.js`
   (the browser may be on an older bundle), skips anything already in the
   catalog or naming an unknown ingredient, and prints paste-ready
   `baseMealsList` entries, a macro table with warnings, the `handAuthoredTags`
   cuisine lines, and the ingredient backlog.
4. **A human decides.** The script never edits `mealDatabase.js`. The generated
   `nutrition_source` says `REPLACE with a real source after checking` on
   purpose — leaving a confident-looking source string on an unchecked estimate
   is how a guess gets laundered into a reference.
5. `npm run test:logic` and `npm run audit:generation`.

---

## 5. What the screen warns about before you approve

Both warnings exist because the alternative is discovering the problem three
weeks later and concluding the feature is broken — the lesson the tiering
screen already learned about thin staples.

| Warning | Why it matters |
| --- | --- |
| Protein under `minMealProtein` (20g) on a lunch/dinner dish | Hard rule. The dish is legal to add and **can never be planned**. |
| Calories over the daily upper bound | Almost always a portion an order of magnitude too large. |
| Macro/calorie mismatch | `validateMacroCalorieConsistency` disagreeing usually means a quantity is wrong. |

The protein warning is deliberately **not** shown for breakfast or snacks: the
floor is a lunch/dinner rule, and warning everywhere trains people to ignore
warnings.

---

## 6. Design decisions worth not re-litigating

**Duplicates are checked twice — at add and at approve.** R1's weekly cap is
per dish name, so two records for one dish are two independent caps and "once a
week" quietly becomes twice. The catalog can grow while a draft sits in the
queue (another device, a promoted custom meal), so the check at approval is not
redundant.

**`meal_added` carries no learning signal.** "You added it, so you like it" is
true and still wrong to encode: the learner weights dishes by how recently you
*ate* them, so a brand-new dish with a positive prior would outrank dishes with
a real record behind them. That is rewarding novelty, not learning taste. You
already have a direct channel for "plan this often" — the tier you set on the
same screen, which is a hard cap plus a Tier-3 affinity rather than a guess.

**No tier is written unless you choose one.** An untouched tier map is what
makes the planner bit-identical for someone with no opinion (`mealTiers.js`).
Defaulting every added meal to `occasional` would write an entry for every dish
and quietly end that guarantee, for no behavioural gain — `occasional` is the
default anyway.

**`buildCatalogMeal` moved out of `mealDatabase.js`.** It was a private
`buildMeal` there. A user meal has to come out of the same pipeline byte for
byte, or it is a second class of meal with its own drift —
`docs/CONSISTENCY_AUDIT.md` is a list of what happens when a fact gets a second
home, and "what a meal object is" is a fact worth keeping to one.
`tests/userMeals.test.js` asserts the two paths agree field by field.

**Removal only ever touches `isUserAdded` entries.** A name collision with a
shipped dish would otherwise delete the shipped one from the merged view, with
no way to undo it from that screen.

---

## 7. Known limits

- **Portions are estimated, and the data says so.** `nutrition_source` contains
  the word "assumption", so `inferSourceType` returns `user_assumption`,
  confidence drops to 0.58 and `needs_review` flips on. That is correct and
  should stay until a real pass replaces the figures — but nothing currently
  *acts* on `needs_review`.
- **No new ingredients from the app.** By design: an ingredient needs a real
  per-100g source, which is a research task, not a form. The `unmatched` list
  is how one gets requested.
- **`components` is not populated.** The shipped catalog carries a
  `components: { protein, carb, veg, style }` block used by `inferEffort` and
  some display paths. A user meal has none, so it infers `effort` from calories
  alone. Low impact — `effort` is Tier 3 — but it is a real difference between
  a user meal and a shipped one.
- **Drafts are capped at 200** and de-duplicated by name, so two devices adding
  the same dish offline merge to one draft rather than two.
