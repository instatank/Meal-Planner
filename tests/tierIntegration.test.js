import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { getRules } from '../src/lib/rules.js';
import {
  buildHistoryCounts,
  buildWeekPlan,
  daySignatureCollisions,
  mealFacts
} from '../src/lib/planOptimizer.js';
import { validateWeek } from '../src/lib/planValidator.js';
import { TIER, resolveMealTiers, softenTiers } from '../src/lib/mealTiers.js';
import { deriveSignatureIngredients } from '../src/lib/mealDataLayer.js';
import { buildSelectWeekTool } from '../src/lib/planService.js';

const rules = getRules('high_protein');
const DATES = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
const SLOTS = ['breakfast', 'lunch', 'dinner'];

const plan = (options = {}) =>
  buildWeekPlan({ mealDatabase, rules, targetDateKeys: DATES, historyMap: {}, preferences: {}, ...options });

const uses = (week, name) =>
  week.days.reduce((total, day) => total + SLOTS.filter((slot) => day[slot]?.name === name).length, 0);

const byName = (name) =>
  [...mealDatabase.breakfast, ...mealDatabase.lunchDinner].find((meal) => meal.name === name);

// ─── R5 — no signature ingredient twice in a day ────────────────────────────

test('R5: no generated day names the same ingredient in two slots', () => {
  // Before this rule, 5 of 7 days did — egg bhurji + egg curry, a paneer
  // breakfast + palak paneer lunch, jowar roti twice. Every one passed the
  // weekly anchor cap, because that cap counted one anchor ingredient per meal
  // and spent both of the week's two `cheese_soft` slots on a single day.
  const week = plan();
  for (const day of week.days) {
    assert.deepEqual(
      daySignatureCollisions(day, rules.hard.maxSameSignatureIngredientPerDay),
      [],
      `${day.dateKey}: ${SLOTS.map((slot) => day[slot].name).join(' | ')}`
    );
  }
});

test('R5: the validator rejects a colliding day the optimizer would never build', () => {
  const week = plan();
  const paneerLunch = byName('Palak paneer + jowar roti');
  const paneerBreakfast = byName('Paneer paratha + curd');
  assert.ok(paneerLunch && paneerBreakfast);

  const days = week.days.map((day, index) =>
    (index === 0 ? { ...day, totals: null, breakfast: paneerBreakfast, lunch: paneerLunch } : day)
  );
  const result = validateWeek({ days, rules, preferences: {} });
  const collision = result.violations.find((v) => v.code === 'signature_ingredient_repeated_in_day');

  assert.ok(collision, 'a paneer breakfast beside a paneer lunch must be a violation');
  assert.equal(collision.scope, 'day', 'day-scoped so repair replaces only this day');
  assert.equal(collision.actual, 'paneer');
});

test('signature ingredients see what the anchor alone could not', () => {
  // `Moong dal chilla + paneer + hung curd` anchors on the chilla, so the
  // paneer in it was invisible to every cheese rule in the system.
  const meal = byName('Moong dal chilla + paneer + hung curd');
  assert.ok(deriveSignatureIngredients(meal).includes('paneer'));
  assert.notEqual(meal.primary_ingredient, 'paneer');
  assert.ok(mealFacts(meal).signatureFamilies.includes('cheese_soft'));
});

// ─── Tiers ──────────────────────────────────────────────────────────────────

test('a staple may repeat in a week; an occasional meal may not', () => {
  const favourite = 'Paneer tikka + jowar roti + salad';

  const asOccasional = plan({ tiers: { [favourite]: TIER.OCCASIONAL } });
  assert.ok(uses(asOccasional, favourite) <= 1);

  const asStaple = plan({ tiers: { [favourite]: TIER.STAPLE } });
  assert.ok(
    uses(asStaple, favourite) > 1,
    'marking a meal a staple must actually bring it back — the whole point of tiers'
  );
});

test('an excluded meal never appears, and the week is still valid without it', () => {
  const banned = 'Acai bowl (protein-boosted)';
  const week = plan({ tiers: { [banned]: TIER.EXCLUDED } });

  assert.equal(uses(week, banned), 0);
  assert.equal(validateWeek({ days: week.days, rules, preferences: {}, tiers: { [banned]: TIER.EXCLUDED } }).valid, true);
});

test('the validator honours the same tier caps the optimizer planned under', () => {
  // If it did not, every week containing a staple would be "repaired" back
  // into a week without one.
  const favourite = 'Paneer tikka + jowar roti + salad';
  const tiers = { [favourite]: TIER.STAPLE };
  const week = plan({ tiers });

  assert.ok(uses(week, favourite) > 1);
  assert.equal(validateWeek({ days: week.days, rules, preferences: {}, tiers }).valid, true);

  const withoutTiers = validateWeek({ days: week.days, rules, preferences: {} });
  assert.ok(
    withoutTiers.violations.some((v) => v.code === 'dish_repeat_exceeded'),
    'and without the tier table the same week is correctly seen as repeating'
  );
});

test('with no tier table the engine behaves exactly as it did before tiers', () => {
  const week = plan();
  const counts = {};
  for (const day of week.days) for (const slot of SLOTS) counts[day[slot].name] = (counts[day[slot].name] || 0) + 1;
  assert.ok(Object.values(counts).every((count) => count <= rules.hard.maxDishRepeatsPerWeek));
});

test('a week built from behaviour-derived tiers passes the validator', () => {
  const favourite = 'Paneer tikka + jowar roti + salad';
  const events = Array.from({ length: 6 }, (_, i) => ({
    type: 'confirm',
    mealName: favourite,
    timestamp: `2026-08-0${i + 1}T12:00:00.000Z`
  }));
  const servedMap = {};
  for (let i = 0; i < 6; i += 1) servedMap[`2026-08-0${i + 1}`] = { lunch: favourite };

  const { tiers } = resolveMealTiers({
    events,
    servedMap,
    mealNames: [...mealDatabase.breakfast, ...mealDatabase.lunchDinner].map((meal) => meal.name),
    nowMs: Date.parse('2026-09-06T00:00:00Z')
  });

  assert.equal(tiers[favourite], TIER.STAPLE);
  const week = plan({ tiers });
  assert.ok(uses(week, favourite) > 1);
  assert.equal(validateWeek({ days: week.days, rules, preferences: {}, tiers }).valid, true);
});

// ─── The confirmed-history regression ───────────────────────────────────────

test('a confirmed history entry is visible to the recency counts', () => {
  // `handleConfirm` wrote `{ meal: name }` while every consumer reads `.name`,
  // so a confirmed day resolved to an empty name and vanished from history.
  // Combined with `historyMap[d] = mealHistory[d] || mealPlans[d]`, confirming
  // one meal removed the whole day from the signal — the only days that
  // reached it were the ones the user had ignored.
  const confirmed = { meal: 'Prawn curry + rice', name: 'Prawn curry + rice', protein: 45, confirmed: true };
  const counts = buildHistoryCounts({ '2026-09-01': { breakfast: confirmed } });

  assert.ok(counts['Prawn curry + rice'] > 0, 'a confirmed meal must reach the recency counts');
  assert.equal(Object.keys(buildHistoryCounts({ '2026-09-01': { breakfast: { meal: 'X' } } })).length, 0,
    'and the old shape is still correctly unreadable, which is why the writer had to change');
});

// ─── Phase 2 chooses between complete weeks ─────────────────────────────────

test('the optimizer offers several complete weeks and every one is legal', () => {
  // The old Phase 2 assembled a week from flat per-slot shortlists. Sampling
  // that schema 400 times produced 0 legal weeks. Choosing between finished
  // weeks makes an illegal answer unrepresentable instead of merely detected.
  const week = plan();
  assert.ok(week.alternatives.length > 0, 'the beam already holds these; they used to be discarded');

  for (const alternative of week.alternatives) {
    const result = validateWeek({ days: alternative.days, rules, preferences: {} });
    assert.equal(result.valid, true, result.violations.map((v) => v.code).join(', '));
    assert.equal(alternative.days.length, DATES.length);
  }
});

test('every alternative is a genuinely different week, not a re-ordering', () => {
  const week = plan();
  const keys = new Set([week.days.map((d) => d.nameKey).join('#')]);
  for (const alternative of week.alternatives) keys.add(alternative.days.map((d) => d.nameKey).join('#'));
  assert.equal(keys.size, week.alternatives.length + 1);
});

test('the selection tool constrains the model to the offered week ids', () => {
  const tool = buildSelectWeekTool(['week_1', 'week_2', 'week_3']);
  assert.deepEqual(tool.input_schema.properties.week_id.enum, ['week_1', 'week_2', 'week_3']);
  assert.deepEqual(tool.input_schema.required, ['week_id']);
  assert.equal(tool.input_schema.additionalProperties, false);
});

// ─── Degradation rather than failure ────────────────────────────────────────

test('a breakfast staple is now honoured outright, with no stepping down', () => {
  // This used to require the degradation ladder. Breakfast is the binding slot
  // and R3 (hard on all 7 days) plus an egg ceiling of 4 left the beam no room,
  // so asking for a breakfast staple produced a stepped-down week. Loosening R3
  // to a 5-of-7 budget and raising the egg ceiling to 5 — both founder
  // decisions — gave it the headroom, and the staple floor makes sure the
  // search actually spends it.
  const tiers = { 'Anda bhurji + toast': TIER.STAPLE };
  const week = plan({ tiers });

  assert.equal(week.tiersRelaxedFrom, undefined, 'no stepping down should be needed any more');
  assert.equal(validateWeek({ days: week.days, rules, preferences: {}, tiers }).valid, true);
  assert.ok(uses(week, 'Anda bhurji + toast') >= 1);
});

test('a staple is never silently dropped, even a light one the macros fight', () => {
  // `Scrambled eggs + toast` is 23g of protein and 284 kcal — the second
  // lightest breakfast in the catalog — so against a 120g target and a 1600
  // kcal floor the optimizer avoids it. With only a raised ceiling and no
  // floor it appeared *zero* times, which is the wrong answer to "I eat this
  // often". A human planner schedules it and makes the day up at lunch.
  const light = 'Scrambled eggs + toast';
  const tiers = {
    [light]: TIER.STAPLE,
    'Boiled eggs + ham sandwich': TIER.STAPLE,
    'Paneer tikka + jowar roti + salad': TIER.STAPLE
  };
  const week = plan({ tiers });

  for (const name of Object.keys(tiers)) {
    assert.ok(uses(week, name) >= 1, `${name} was marked a staple and never appeared`);
  }
  assert.equal(validateWeek({ days: week.days, rules, preferences: {}, tiers: week.tiersUsed || tiers }).valid, true);
});

test('the degradation ladder still exists for tiers that genuinely cannot fit', () => {
  // The ladder is the safety net, not the normal path. Verified on the tier
  // table directly so the test does not depend on finding a catalog state that
  // happens to be infeasible today.
  const staples = { A: TIER.STAPLE, B: TIER.REGULAR, C: TIER.OCCASIONAL };
  const once = softenTiers(staples);
  assert.deepEqual(once, { A: TIER.REGULAR, B: TIER.OCCASIONAL, C: TIER.OCCASIONAL });

  const twice = softenTiers(once);
  assert.deepEqual(twice, { A: TIER.OCCASIONAL, B: TIER.OCCASIONAL, C: TIER.OCCASIONAL });

  assert.equal(softenTiers(twice), null, 'nothing left to soften ends the ladder');
  assert.equal(softenTiers({ X: TIER.EXCLUDED }), null, 'an exclusion is a decision, not a preference to ease');
});

test('R3 is budgeted now, so the week may break the cuisine direction twice', () => {
  const week = plan();
  const compliant = week.days.filter((day) => day.cuisineDirectionOk).length;
  const required = week.days.length - 2;

  assert.ok(compliant >= required, `only ${compliant} of ${week.days.length} days follow R3`);
  assert.equal(validateWeek({ days: week.days, rules, preferences: {} }).valid, true);
});

test('every tier configuration yields a valid week and real alternatives', () => {
  const configurations = [
    null,
    { 'Paneer tikka + jowar roti + salad': TIER.STAPLE },
    { 'Anda bhurji + toast': TIER.STAPLE },
    { 'Paneer tikka + jowar roti + salad': TIER.STAPLE, 'Anda bhurji + toast': TIER.STAPLE },
    {
      'Paneer tikka + jowar roti + salad': TIER.STAPLE,
      'Anda bhurji + toast': TIER.STAPLE,
      'Prawn curry + rice': TIER.STAPLE,
      'Butter chicken + jowar roti': TIER.STAPLE
    }
  ];

  for (const tiers of configurations) {
    const week = plan(tiers ? { tiers } : {});
    const label = tiers ? Object.keys(tiers).join(' + ') : 'no tiers';
    const result = validateWeek({ days: week.days, rules, preferences: {}, tiers: week.tiersUsed || tiers });
    assert.equal(result.valid, true, `${label}: ${result.violations.map((v) => v.code).join(', ')}`);
    assert.ok(week.alternatives.length > 0, `${label}: no alternatives offered`);
  }
});

test('the best-effort fallback still honours the result contract', () => {
  // It can emit a week breaking the rules by design — that is what the
  // validator is for — but it must not hand back a shape callers cannot read.
  const week = buildWeekPlan({
    mealDatabase,
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {},
    // Every meal excluded except a handful, so nothing can satisfy the week.
    tiers: Object.fromEntries(
      [...mealDatabase.breakfast, ...mealDatabase.lunchDinner].map((meal) => [meal.name, TIER.EXCLUDED])
    )
  });
  assert.ok(Array.isArray(week.alternatives), '`alternatives` must never be undefined');
});
