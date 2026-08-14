import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeekPlan } from '../src/lib/planOptimizer.js';
import { validateWeek, formatViolations } from '../src/lib/planValidator.js';
import { getRules } from '../src/lib/rules.js';
import { mealDatabase } from '../src/data/mealDatabase.js';

/**
 * The Phase 1 acceptance criteria, measured against the real 41-meal catalog.
 *
 * Every number here is enumerated, not estimated: the optimizer walks all legal
 * day combinations and the validator re-derives the totals independently of the
 * search that produced them.
 */

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const rules = getRules('high_protein');

const generate = (targetDateKeys = WEEK, options = {}) =>
  buildWeekPlan({ mealDatabase, rules, targetDateKeys, preferences: {}, ...options });

test('AC1: at least 5 of 7 days have total protein in the 108-132g band', () => {
  const { days } = generate();
  const inBand = days.filter((day) => day.totals.protein >= 108 && day.totals.protein <= 132).length;

  assert.equal(days.length, 7);
  assert.ok(inBand >= 5, `only ${inBand} of 7 days in band: ${days.map((d) => d.totals.protein).join(', ')}`);
});

test('AC2: the weekly protein total is at least 714g (85% of the 840g nominal)', () => {
  const { days } = generate();
  // Summed here from the day totals rather than read off the optimizer's own
  // summary, so a bug in the search cannot hide behind its own bookkeeping.
  const total = days.reduce((sum, day) => sum + day.totals.protein, 0);

  assert.equal(rules.week.nominalProtein, 840);
  assert.equal(rules.week.proteinFloor, 714);
  assert.ok(total >= 714, `weekly protein ${total}g is below the 714g floor`);
});

test('AC3: no day falls below the 50g sanity floor', () => {
  const { days } = generate();
  for (const day of days) {
    assert.ok(
      day.totals.protein >= rules.hard.dailyProteinSanityFloor,
      `${day.dateKey} totals ${day.totals.protein}g`
    );
  }
});

test('AC4: at least 5 of 7 days are under the carb cap and within calorie bounds', () => {
  const { days } = generate();
  const underCarbs = days.filter((day) => day.totals.carbs <= 130).length;
  const inCalories = days.filter((day) => day.totals.calories >= 1600 && day.totals.calories <= 2200).length;

  assert.ok(underCarbs >= 5, `only ${underCarbs} of 7 days under 130g carbs`);
  assert.ok(inCalories >= 5, `only ${inCalories} of 7 days within 1600-2200 kcal`);
});

test('AC5: no Tier-1 violation appears anywhere in the generated week', () => {
  const { days } = generate();
  const result = validateWeek({ days, rules });

  assert.deepEqual(result.hardViolations, [], formatViolations(result.hardViolations));
});

test('AC6: weekly repetition and red-meat caps hold against the generated week', () => {
  const { days } = generate();

  const breakfastUse = {};
  const lunchDinnerUse = {};
  let redMeat = 0;
  for (const day of days) {
    breakfastUse[day.mealNames[0]] = (breakfastUse[day.mealNames[0]] || 0) + 1;
    for (const name of [day.mealNames[1], day.mealNames[2]]) {
      lunchDinnerUse[name] = (lunchDinnerUse[name] || 0) + 1;
    }
    redMeat += day.redMeatCount;
  }

  for (const [name, count] of Object.entries(breakfastUse)) {
    assert.ok(count <= 4, `${name} appears ${count} times at breakfast`);
  }
  for (const [name, count] of Object.entries(lunchDinnerUse)) {
    assert.ok(count <= 2, `${name} appears ${count} times at lunch/dinner`);
  }
  assert.ok(redMeat <= 3, `${redMeat} red-meat meals this week`);
});

test('AC7: the generated week passes the validator outright', () => {
  const { days } = generate();
  const result = validateWeek({ days, rules });

  assert.equal(result.valid, true, formatViolations(result.violations));
});

test('the three highest-protein dishes are reachable at dinner again', () => {
  // The old hard taper barred every `Heavy` meal from dinner, removing the
  // catalog's 61g, 56g and 46g dishes from the goal that needs them most.
  const { dayCandidates } = generate();
  const heavyDinners = new Set(
    dayCandidates
      .filter((day) => String(day.dinner.meal_weight) === 'Heavy')
      .map((day) => day.dinner.canonical_name)
  );

  assert.ok(heavyDinners.has('Chicken curry + jowar roti + dal'), '61g dish must be reachable at dinner');
  assert.ok(heavyDinners.has('Chicken curry + jowar roti'), '56g dish must be reachable at dinner');
  assert.ok(
    heavyDinners.has('Grilled salmon fillet + sauteed veg + spaghetti aglio e olio'),
    '46g dish must be reachable at dinner'
  );
});

test('tapering still shapes the result: dinner is rarely the biggest meal of the day', () => {
  const { days } = generate();
  const dinnerHeaviest = days.filter(
    (day) => day.dinner.cal > day.lunch.cal && day.dinner.cal > day.breakfast.cal
  ).length;

  assert.ok(dinnerHeaviest <= 3, `dinner was the largest meal on ${dinnerHeaviest} of 7 days`);
});

test('a partial-week regeneration stays within its pro-rated budgets', () => {
  const targetDateKeys = WEEK.slice(3); // 4 days
  const { days } = generate(targetDateKeys);
  const result = validateWeek({ days, rules });

  assert.equal(days.length, 4);
  assert.equal(result.valid, true, formatViolations(result.violations));
  assert.ok(days.filter((day) => day.proteinInBand).length >= 3, 'at least 3 of 4 days in band');
  assert.ok(
    days.reduce((sum, day) => sum + day.totals.protein, 0) >= 449,
    'pro-rated weekly floor of 449g for a 4-day run'
  );
});

test('generation stays comfortably inside the Vercel Hobby 10s function cap', () => {
  const started = Date.now();
  generate();
  const elapsed = Date.now() - started;

  // The deterministic phase runs in the browser, not the function, but a slow
  // optimizer would still push the whole regeneration past the cap.
  assert.ok(elapsed < 3000, `optimizer took ${elapsed}ms`);
});
