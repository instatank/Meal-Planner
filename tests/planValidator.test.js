import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIER,
  formatViolations,
  repairWeek,
  resolveWeek,
  validateAndRepairWeek,
  validateWeek
} from '../src/lib/planValidator.js';
import { selectWeek } from '../src/lib/planOptimizer.js';
import { getRules } from '../src/lib/rules.js';

const DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];

const meal = ({ name, p, c = 20, f = 10, cal, cuisine = 'continental', weight = 'Medium', family = 'vegetarian', fibre = true, primaryIngredient = null }) => ({
  name,
  canonical_name: name,
  protein: p,
  cal,
  macros: { p, c, f },
  cuisine,
  meal_weight: weight,
  has_fibre: fibre,
  tags: { protein_family: family },
  primary_ingredient: primaryIngredient
});

/**
 * Sized to satisfy the rubric, not just the macro budgets: R1 needs 21
 * distinct dishes in a week, R2 needs at least 3 egg-anchored breakfasts and
 * at least 3 that are not, and R3 needs 7 distinct Indian lunches and 7
 * distinct non-Indian dinners. The previous 4+8 fixture predates all three
 * and could not produce a legal week at all.
 */
const catalog = () => ({
  breakfast: [
    meal({ name: 'BE1', p: 40, c: 30, cal: 520, primaryIngredient: 'egg_whole' }),
    meal({ name: 'BE2', p: 39, c: 30, cal: 515, primaryIngredient: 'egg_whole' }),
    meal({ name: 'BE3', p: 38, c: 29, cal: 510, primaryIngredient: 'egg_white' }),
    meal({ name: 'B4', p: 38, c: 30, cal: 510, cuisine: 'indian' }),
    meal({ name: 'B5', p: 37, c: 29, cal: 505, cuisine: 'asian' }),
    meal({ name: 'B6', p: 36, c: 28, cal: 500 }),
    meal({ name: 'B7', p: 35, c: 28, cal: 495 }),
    meal({ name: 'B8', p: 34, c: 28, cal: 490 })
  ],
  lunchDinner: [
    meal({ name: 'LI1', p: 48, c: 35, cal: 600, cuisine: 'indian', family: 'chicken' }),
    meal({ name: 'LI2', p: 47, c: 35, cal: 595, cuisine: 'indian', family: 'fish' }),
    meal({ name: 'LI3', p: 46, c: 34, cal: 590, cuisine: 'indian' }),
    meal({ name: 'LI4', p: 45, c: 34, cal: 585, cuisine: 'indian' }),
    meal({ name: 'LI5', p: 44, c: 33, cal: 580, cuisine: 'indian', family: 'chicken' }),
    meal({ name: 'LI6', p: 43, c: 33, cal: 575, cuisine: 'indian' }),
    meal({ name: 'LI7', p: 42, c: 32, cal: 570, cuisine: 'indian' }),
    meal({ name: 'DN1', p: 48, c: 35, cal: 600, family: 'chicken' }),
    meal({ name: 'DN2', p: 47, c: 35, cal: 595, cuisine: 'asian', family: 'fish' }),
    meal({ name: 'DN3', p: 46, c: 34, cal: 590, cuisine: 'asian' }),
    meal({ name: 'DN4', p: 45, c: 34, cal: 585 }),
    meal({ name: 'DN5', p: 44, c: 33, cal: 580, family: 'chicken' }),
    meal({ name: 'DN6', p: 43, c: 33, cal: 575, cuisine: 'asian' }),
    meal({ name: 'DN7', p: 42, c: 32, cal: 570 })
  ],
  snack: []
});

const rules = () => getRules('high_protein', { dailyProteinTarget: 132 });

const validWeek = (database, ruleset) =>
  selectWeek({ mealDatabase: database, rules: ruleset, targetDateKeys: DATES, preferences: {} }).days;

const codes = (result) => result.violations.map((v) => v.code).sort();

// ─── Validation ─────────────────────────────────────────────────────────────

test('a week produced by the optimizer validates clean', () => {
  const ruleset = rules();
  const result = validateWeek({ days: validWeek(catalog(), ruleset), rules: ruleset });

  assert.equal(result.valid, true, formatViolations(result.violations));
  assert.deepEqual(result.violations, []);
  assert.equal(result.summary.dayCount, 7);
});

test('a meal below the per-meal protein floor is a Tier-1 violation', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);
  days[2] = { ...days[2], lunch: meal({ name: 'Lean', p: 8, c: 10, cal: 200 }), totals: undefined };

  const result = validateWeek({ days, rules: ruleset });

  assert.equal(result.valid, false);
  const found = result.violations.find((v) => v.code === 'meal_below_protein_floor');
  assert.ok(found);
  assert.equal(found.tier, TIER.HARD);
  assert.equal(found.slot, 'lunch');
  assert.equal(found.actual, 8);
  assert.equal(found.limit, 20);
});

test('the same meal twice in one day is a Tier-1 violation', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);
  days[0] = { ...days[0], lunch: database.lunchDinner[0], dinner: database.lunchDinner[0], totals: undefined };

  const result = validateWeek({ days, rules: ruleset });
  assert.ok(result.violations.some((v) => v.code === 'duplicate_meal_in_day'));
});

test('a day under the 50g sanity floor is a Tier-1 violation, but a 70g day is not', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);

  const tiny = { name: 'Tiny', canonical_name: 'Tiny', protein: 10, cal: 120, macros: { p: 10, c: 5, f: 3 }, cuisine: 'indian', tags: { protein_family: 'vegetarian' } };
  const belowFloor = [...days];
  belowFloor[0] = {
    dateKey: days[0].dateKey,
    breakfast: tiny,
    lunch: tiny,
    dinner: { ...tiny, name: 'Tiny D', canonical_name: 'Tiny D', cuisine: 'continental' }
  };
  assert.ok(
    validateWeek({ days: belowFloor, rules: ruleset }).violations.some((v) => v.code === 'day_below_sanity_floor')
  );

  // 70g: off-band but comfortably over the sanity floor. A pass, not a bug.
  // R3-legal on purpose: this test is about the sanity floor, so the day must
  // not trip any other hard rule and muddy the assertion below.
  const flex = { name: 'Flex', canonical_name: 'Flex', protein: 24, cal: 300, macros: { p: 24, c: 10, f: 8 }, cuisine: 'indian', tags: { protein_family: 'vegetarian' } };
  const flexDay = [...days];
  flexDay[0] = {
    dateKey: days[0].dateKey,
    breakfast: { ...flex, name: 'Flex B', canonical_name: 'Flex B', protein: 22 },
    lunch: { ...flex, name: 'Flex L', canonical_name: 'Flex L' },
    dinner: { ...flex, name: 'Flex D', canonical_name: 'Flex D', cuisine: 'continental' }
  };
  const result = validateWeek({ days: flexDay, rules: ruleset });
  assert.ok(!result.violations.some((v) => v.code === 'day_below_sanity_floor'));
  assert.ok(!result.hardViolations.some((v) => v.dateKey === days[0].dateKey));
});

test('R1 is validated against the generated week plus locked days', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);

  // Force one Indian dish into two lunch slots — one over R1's ceiling of 1.
  for (const index of [0, 1]) {
    days[index] = { ...days[index], lunch: database.lunchDinner[0], totals: undefined };
  }
  const result = validateWeek({ days, rules: ruleset });
  const found = result.violations.find((v) => v.code === 'dish_repeat_exceeded');
  assert.ok(found, formatViolations(result.violations));
  assert.equal(found.limit, 1);

  // A locked day pushes an otherwise-legal week over the same ceiling: every
  // dish in a clean week is already used once, so re-using any of them costs.
  const clean = validWeek(database, ruleset);
  const locked = {
    '2026-08-02': {
      breakfast: database.breakfast[0],
      lunch: clean[0].lunch,
      dinner: clean[0].dinner
    }
  };
  const lockedResult = validateWeek({ days: clean, rules: ruleset, lockedDays: locked });
  assert.ok(lockedResult.violations.some((v) => v.code === 'dish_repeat_exceeded'));
});

test('R1 lets the pinned dish through at its higher allowance', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);

  // Same forced repeat as above, but declared as the pin.
  for (const index of [0, 1]) {
    days[index] = { ...days[index], lunch: database.lunchDinner[0], totals: undefined };
  }
  const pinned = database.lunchDinner[0].name;
  const result = validateWeek({ days, rules: ruleset, pinnedDish: pinned });
  assert.ok(
    !result.violations.some((v) => v.code === 'dish_repeat_exceeded' && v.message.startsWith(pinned)),
    formatViolations(result.violations)
  );
});

test('R2 is a hard gate, so a Phase-2 recombination cannot slip past', () => {
  const ruleset = rules();
  const database = catalog();

  // R2: swap every egg breakfast out and the week falls under the floor.
  const noEggs = validWeek(database, ruleset).map((day) => ({
    ...day,
    breakfast: database.breakfast[7],
    totals: undefined
  }));
  assert.ok(
    validateWeek({ days: noEggs, rules: ruleset }).violations
      .some((v) => v.code === 'egg_breakfasts_below_floor'),
    'a week with no egg breakfasts must be caught'
  );
});

test('R3 is budgeted: two wrong-way days are allowed, a third is not', () => {
  // R3 used to be a Tier-1, day-scoped violation — one Indian dinner anywhere
  // made the week invalid. By founder decision it is now judged 5 of 7, the
  // same shape as the protein band and the carb cap.
  const ruleset = rules();
  const database = catalog();
  const indianDinner = database.lunchDinner[1];
  assert.equal(indianDinner.cuisine, 'indian', 'fixture assumption');

  const breakDays = (count) => {
    const days = validWeek(database, ruleset);
    for (let i = 0; i < count; i += 1) days[i] = { ...days[i], dinner: indianDinner, totals: undefined };
    return days;
  };

  const twoWrong = validateWeek({ days: breakDays(2), rules: ruleset });
  assert.ok(
    !twoWrong.violations.some((v) => v.code === 'cuisine_direction_budget_exceeded'),
    formatViolations(twoWrong.violations)
  );
  assert.ok(
    !twoWrong.violations.some((v) => v.code === 'cuisine_direction_wrong'),
    'R3 must no longer produce a day-scoped hard violation'
  );

  const threeWrong = validateWeek({ days: breakDays(3), rules: ruleset });
  const budget = threeWrong.violations.find((v) => v.code === 'cuisine_direction_budget_exceeded');
  assert.ok(budget, formatViolations(threeWrong.violations));
  assert.equal(budget.tier, TIER.BUDGETED);
  assert.equal(budget.actual, 4);
  assert.equal(budget.limit, 5);
});


test('the red-meat cap and the weekly protein floor are validated', () => {
  const ruleset = rules();
  const steak = meal({ name: 'Steak', p: 50, c: 30, cal: 600, family: 'red_meat' });
  const days = DATES.map((dateKey) => ({
    dateKey,
    breakfast: meal({ name: 'B1', p: 40, c: 30, cal: 520 }),
    lunch: steak,
    dinner: meal({ name: 'L1', p: 48, c: 35, cal: 600, family: 'chicken' })
  }));

  const result = validateWeek({ days, rules: ruleset });
  const redMeat = result.violations.find((v) => v.code === 'red_meat_cap_exceeded');
  assert.ok(redMeat);
  assert.equal(redMeat.actual, 7);
  assert.equal(redMeat.limit, 3);

  const lean = meal({ name: 'Lean', p: 20, c: 10, cal: 250 });
  const thinWeek = DATES.map((dateKey) => ({
    dateKey,
    breakfast: meal({ name: 'B1', p: 20, c: 10, cal: 200 }),
    lunch: lean,
    dinner: meal({ name: 'Lean2', p: 20, c: 10, cal: 250 })
  }));
  const floorResult = validateWeek({ days: thinWeek, rules: ruleset });
  const floorViolation = floorResult.violations.find((v) => v.code === 'weekly_protein_below_floor');
  assert.ok(floorViolation);
  assert.equal(floorViolation.actual, 420);
  assert.equal(floorViolation.limit, 785);
});

test('Tier-2 budgets only fire once more than 2 of 7 days miss', () => {
  const ruleset = getRules('high_protein', { dailyProteinTarget: 132 });
  // Lunch Indian, dinner not — R3-compliant, so this test isolates the protein
  // budget rather than also tripping the cuisine-direction budget that R3
  // became. (The fixture used to be the other way round, which was invisible
  // while R3 was checked per day and this test only looked at week scope.)
  const strong = (dateKey) => ({
    dateKey,
    breakfast: meal({ name: 'B1', p: 37, c: 30, cal: 600 }),
    lunch: meal({ name: 'L1', p: 48, c: 35, cal: 620, family: 'chicken', cuisine: 'indian' }),
    dinner: meal({ name: 'L2', p: 47, c: 35, cal: 620, family: 'fish' })
  });
  const flex = (dateKey) => ({
    dateKey,
    breakfast: meal({ name: 'B4', p: 22, c: 10, cal: 200 }),
    lunch: meal({ name: 'L7', p: 24, c: 10, cal: 260, cuisine: 'indian' }),
    dinner: meal({ name: 'L8', p: 24, c: 10, cal: 260 })
  });

  // 5 strong + 2 flex — exactly at budget, and the weekly floor still holds.
  const atBudget = [...DATES.slice(0, 5).map(strong), ...DATES.slice(5).map(flex)];
  const okResult = validateWeek({ days: atBudget, rules: ruleset });
  assert.ok(!okResult.violations.some((v) => v.tier === TIER.BUDGETED), formatViolations(okResult.violations));
  assert.equal(okResult.summary.daysProteinInBand, 5);

  // 4 strong + 3 flex — one miss too many.
  const overBudget = [...DATES.slice(0, 4).map(strong), ...DATES.slice(4).map(flex)];
  const badResult = validateWeek({ days: overBudget, rules: ruleset });
  const budgetViolation = badResult.violations.find((v) => v.code === 'protein_band_budget_exceeded');
  assert.ok(budgetViolation);
  assert.equal(budgetViolation.tier, TIER.BUDGETED);
  assert.equal(budgetViolation.actual, 4);
  assert.equal(budgetViolation.limit, 5);
});

// ─── Resolution of model output ─────────────────────────────────────────────

test('meal names resolve by canonical name, and a near-miss is reported not swallowed', () => {
  const ruleset = rules();
  const database = catalog();
  const { days, violations } = resolveWeek({
    days: [
      { dateKey: '2026-08-03', breakfast: 'BE1', lunch: 'LI1', dinner: 'DN1' },
      { dateKey: '2026-08-04', breakfast: 'BE2', lunch: 'Chicken Curry (invented)', dinner: 'DN2' }
    ],
    mealDatabase: database,
    rules: ruleset
  });

  assert.equal(days[0].breakfast.name, 'BE1');
  assert.equal(days[0].lunch.name, 'LI1');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].code, 'unresolved_meal');
  assert.equal(violations[0].slot, 'lunch');
  assert.equal(violations[0].dateKey, '2026-08-04');
});

// ─── Repair ─────────────────────────────────────────────────────────────────

test('repair leaves an already-valid week untouched', () => {
  const ruleset = rules();
  const days = validWeek(catalog(), ruleset);
  const before = days.map((day) => day.mealNames.join('|'));

  const result = repairWeek({ days, mealDatabase: catalog(), rules: ruleset });

  assert.equal(result.repaired, false);
  assert.equal(result.strategy, 'none');
  assert.deepEqual(result.days.map((day) => day.mealNames.join('|')), before);
});

test('repair replaces only the days carrying a hard violation', () => {
  const ruleset = rules();
  const database = catalog();
  const days = validWeek(database, ruleset);
  const untouchedBefore = days.slice(1).map((day) => day.mealNames.join('|'));

  days[0] = {
    dateKey: days[0].dateKey,
    breakfast: meal({ name: 'Lean B', p: 5, c: 5, cal: 80 }),
    lunch: days[0].lunch,
    dinner: days[0].dinner
  };

  const result = repairWeek({ days, mealDatabase: database, rules: ruleset });

  assert.equal(result.repaired, true);
  assert.equal(result.strategy, 'replaced_invalid_days');
  assert.equal(result.validation.valid, true, formatViolations(result.validation.violations));
  assert.deepEqual(
    result.days.slice(1).map((day) => day.mealNames.join('|')),
    untouchedBefore,
    'days that were fine are preserved'
  );
});

test('repair rebuilds the whole week when only weekly budgets are blown', () => {
  const ruleset = rules();
  const database = catalog();

  // Every day legal on its own, but far too lean for the weekly floor.
  const lean = meal({ name: 'Lean', p: 21, c: 8, cal: 240 });
  database.lunchDinner.push(lean);
  const days = DATES.map((dateKey) => ({
    dateKey,
    breakfast: database.breakfast[3],
    lunch: lean,
    dinner: lean
  }));

  const before = validateWeek({ days, rules: ruleset });
  assert.equal(before.valid, false);

  const result = repairWeek({ days, mealDatabase: database, rules: ruleset });
  assert.equal(result.strategy, 'regenerated_week');
  assert.equal(result.validation.valid, true, formatViolations(result.validation.violations));
  assert.ok(result.validation.summary.totalProtein >= result.validation.summary.proteinFloor);
});

test('repair reports catalog infeasibility rather than writing a bad week quietly', () => {
  const ruleset = rules();
  // A catalog that physically cannot reach the weekly protein floor.
  // R3-legal (an Indian lunch pool and a non-Indian dinner pool) so the week
  // fails for the reason under test — protein — and not for want of a day.
  const thin = {
    breakfast: [meal({ name: 'B', p: 20, c: 10, cal: 200, primaryIngredient: 'egg_whole' })],
    lunchDinner: [
      meal({ name: 'LI1', p: 20, c: 10, cal: 240, cuisine: 'indian' }),
      meal({ name: 'LI2', p: 20, c: 10, cal: 240, cuisine: 'indian' }),
      meal({ name: 'LI3', p: 20, c: 10, cal: 240, cuisine: 'indian' }),
      meal({ name: 'DN1', p: 20, c: 10, cal: 240 }),
      meal({ name: 'DN2', p: 20, c: 10, cal: 240 }),
      meal({ name: 'DN3', p: 20, c: 10, cal: 240 }),
      meal({ name: 'DN4', p: 20, c: 10, cal: 240 })
    ],
    snack: []
  };
  const days = DATES.map((dateKey) => ({
    dateKey,
    breakfast: thin.breakfast[0],
    lunch: thin.lunchDinner[0],
    dinner: thin.lunchDinner[1]
  }));

  const result = repairWeek({ days, mealDatabase: thin, rules: ruleset });

  assert.equal(result.validation.valid, false);
  assert.equal(result.catalogInfeasible, true);
  assert.ok(result.validation.violations.some((v) => v.code === 'weekly_protein_below_floor'));
});

test('validateAndRepairWeek regenerates a day whose meal name did not resolve', () => {
  const ruleset = rules();
  const database = catalog();
  const reference = validWeek(database, ruleset);
  const asNames = reference.map((day) => ({
    dateKey: day.dateKey,
    breakfast: day.breakfast.name,
    lunch: day.lunch.name,
    dinner: day.dinner.name
  }));
  asNames[3].dinner = 'Hallucinated Dinner Special';

  const result = validateAndRepairWeek({ days: asNames, mealDatabase: database, rules: ruleset });

  assert.equal(result.resolutionViolations.length, 1);
  assert.equal(result.resolutionViolations[0].code, 'unresolved_meal');
  assert.equal(result.repaired, true);
  assert.equal(result.validation.valid, true, formatViolations(result.validation.violations));
  assert.equal(result.days.length, 7);
  assert.ok(result.days.every((day) => day.breakfast && day.lunch && day.dinner));
  assert.deepEqual(result.days.map((day) => day.dateKey), DATES, 'no date is dropped');
});

test('formatViolations renders one readable line per violation', () => {
  const text = formatViolations([
    { tier: 1, code: 'day_below_sanity_floor', message: '2026-08-03 totals 30g protein' },
    { tier: 2, code: 'protein_band_budget_exceeded', message: 'Only 4 of 7 days are in the protein band' }
  ]);

  assert.equal(
    text,
    '- [tier 1] day_below_sanity_floor: 2026-08-03 totals 30g protein\n'
    + '- [tier 2] protein_band_budget_exceeded: Only 4 of 7 days are in the protein band'
  );
});

test('two identical days in a week are a Tier-1 violation', () => {
  // The per-meal weekly repeat caps allow each meal twice, so a whole day
  // repeating verbatim broke no rule — while being the single most obvious
  // defect a person sees in a generated plan. Reported from real use.
  const rules = getRules('high_protein');
  const catalogue = catalog();
  const day = (dateKey) => ({
    dateKey,
    breakfast: catalogue.breakfast[0],
    lunch: catalogue.lunchDinner[0],
    dinner: catalogue.lunchDinner[1]
  });

  const result = validateWeek({ days: [day(DATES[0]), day(DATES[1])], rules });
  const dup = result.violations.find((v) => v.code === 'duplicate_day_in_week');

  assert.ok(dup, `expected a duplicate_day_in_week violation, got: ${result.violations.map((v) => v.code).join(', ')}`);
  assert.equal(dup.tier, TIER.HARD);
});

test('selectWeek never emits the same day twice', () => {
  const rules = getRules('high_protein');
  const week = selectWeek({ mealDatabase: catalog(), rules, targetDateKeys: DATES, preferences: {} });
  const keys = week.days.map((d) => [d.breakfast, d.lunch, d.dinner].map((m) => m.name).join('|'));

  assert.equal(new Set(keys).size, keys.length, `duplicate day in generated week:\n  ${keys.join('\n  ')}`);
});
