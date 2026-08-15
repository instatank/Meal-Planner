# Meal Plan Quality Rubric — v1

Four rules. A week starts at 100 and loses points for violations. **Ship at 85+.**

Everything already enforced in `rules.js` (protein band, calorie bounds, carb
cap, anchor family caps, no duplicate days) stays a hard gate — pass/fail, not
scored. This rubric only scores weeks that already passed those gates.

---

## R1 — No dish repeats · −15 each

Every dish appears at most once per week. Applies to all three slots.

**Exception: the pin.** One dish may be pinned, up to 3 appearances. Optional —
if nothing is pinned, everything must vary.

```
violations = Σ over dishes:
    pinned dish:  max(0, count - 3)
    everything else: max(0, count - 1)
penalty = 15 × violations
```

Catches: kofta+dal twice, aloo paratha twice, prawn curry twice.

## R2 — Eggs 3–4 breakfasts a week · −10 if outside

Not a pin. A standing constant that does not fluctuate. Counts breakfasts
anchored on egg.

```
penalty = 10 if egg_breakfasts < 3 or egg_breakfasts > 4, else 0
```

Note this is a **floor as well as a ceiling** — a week with one egg breakfast is
wrong, not just a week with six.

## R3 — Indian lunch, international dinner · −5 per day

Per day, across lunch and dinner:

| pattern | penalty |
| --- | --- |
| Indian lunch + non-Indian dinner | 0 |
| non-Indian lunch + Indian dinner | −5 |
| both Indian, or both non-Indian | −5 |

Replaces the current symmetric rule, which accepts either direction.

## R4 — One flatbread/pasta meal per day · −5 per day

If lunch is roti / bread / pasta, dinner should be rice or no carb, and vice
versa. Breakfast exempt.

Needs one field on each lunch/dinner meal: `carb_type` = `flatbread_pasta` |
`rice` | `none`. Derive it once from the meal's parts and store it — do not
infer it from the dish name at runtime.

```
penalty = 5 × days where lunch and dinner are both flatbread_pasta
```

Soft by design. The user's own ideal week breaks this once (roti lunch, pizza
dinner) and that week is acceptable.

---

## Output

```js
{
  total: 85,
  passed_gates: true,
  violations: [
    "R1: Kofta + dal + jowar roti appears 2× (-15)"
  ]
}
```

The `violations` strings matter as much as the number — they are what a retry
gets fed, and what makes a low score actionable.

---

## Calibration — do this before trusting the scorer

1. Score every week in `docs/rejections/`. Each must land **below 85**.
2. Score the hand-written ideal week and the `standard`-goal week the user said
   he'd have shipped. Each must land **at or above 85**.
3. If either disagrees, the rubric is wrong — adjust and record why below.

**Expected result on the ideal week:** −5 on R4 (Saturday roti lunch + pizza
dinner), −0 on R1 if scrambled eggs + toast is pinned at 3. Scores 95. If it
scores lower, check the pin is applied before touching any weights.

---

## Deliberately not included

- **No LLM judge.** Every rejection recorded so far is a counting problem.
  Revisit only if calibration shows weeks scoring 85+ that are still rejected.
- **No breakfast archetype layer.** R1 already catches repeated parathas; the
  residual case (two *different* paratha dishes, or idli+sambar and dosa+sambar
  in one week) is left uncaught on purpose. Add it only if it turns out to be
  annoying in practice.
- **No snack slot, no weekend rules, no cross-week novelty, no slot
  preferences.** All were considered and cut. Any of them can be added later as
  one more numbered rule.

## Calibration log

_(append adjustments and reasons here)_
