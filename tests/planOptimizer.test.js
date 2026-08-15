import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_SLOTS,
  buildSlotShortlists,
  buildWeekPlan,
  enumerateFeasibleDays,
  isWeekWithinBudgets,
  selectWeek,
  summariseWeek
} from '../src/lib/planOptimizer.js';
import { anchorFamilyMaxPerWeek, anchorFamilyOf, getRules } from '../src/lib/rules.js';

const DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];

/** A meal with every field the optimizer reads, so fixtures stay explicit. */
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
 * A catalog with enough headroom that a compliant week is easy to find, so the
 * tests below isolate the accounting rather than the catalog's limitations.
 *
 * "Roomy" has a stricter meaning since the rubric landed. R1 needs 21 distinct
 * dishes in a week and R3 needs every lunch Indian and every dinner not, so a
 * week now needs at least 7 distinct Indian lunches, 7 distinct non-Indian
 * dinners and 7 distinct breakfasts — 3 of which must be egg-anchored for R2.
 * The old 4-breakfast / 8-lunch fixture could not satisfy that and made every
 * test using it fail for want of candidates rather than for the reason it was
 * testing.
 *
 * Breakfasts carry no `primaryIngredient` unless they are meant to be egg
 * ones, so they spend no anchor-family budget and leave the family-cap tests
 * to set up their own.
 */
const roomyCatalog = () => ({
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
    // Seven Indian dishes — the lunch pool R3 draws from.
    meal({ name: 'LI1', p: 48, c: 35, cal: 600, cuisine: 'indian', family: 'chicken' }),
    meal({ name: 'LI2', p: 47, c: 35, cal: 595, cuisine: 'indian', family: 'fish' }),
    meal({ name: 'LI3', p: 46, c: 34, cal: 590, cuisine: 'indian' }),
    meal({ name: 'LI4', p: 45, c: 34, cal: 585, cuisine: 'indian' }),
    meal({ name: 'LI5', p: 44, c: 33, cal: 580, cuisine: 'indian', family: 'chicken' }),
    meal({ name: 'LI6', p: 43, c: 33, cal: 575, cuisine: 'indian' }),
    meal({ name: 'LI7', p: 42, c: 32, cal: 570, cuisine: 'indian' }),
    // Seven that are not — the dinner pool.
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

const rulesFor = (overrides = {}) => {
  const base = getRules('high_protein', { dailyProteinTarget: 132 });
  return {
    ...base,
    ...overrides,
    hard: { ...base.hard, ...(overrides.hard || {}) },
    budgeted: { ...base.budgeted, ...(overrides.budgeted || {}) },
    scored: { ...base.scored, ...(overrides.scored || {}) }
  };
};

// ─── Tier 1 — hard constraints ──────────────────────────────────────────────

test('enumeration rejects every meal under the per-meal protein floor', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  database.lunchDinner.push(meal({ name: 'TooLean', p: 8, c: 10, cal: 200 }));

  const days = enumerateFeasibleDays({ mealDatabase: database, rules, preferences: {} });

  assert.ok(days.length > 0);
  assert.ok(days.every((day) => !day.mealNames.includes('TooLean')));
});

test('enumeration never places the same meal twice in one day', () => {
  const rules = rulesFor();
  const days = enumerateFeasibleDays({ mealDatabase: roomyCatalog(), rules, preferences: {} });

  for (const day of days) {
    assert.equal(new Set(day.mealNames).size, day.mealNames.length, day.mealNames.join(' | '));
  }
});

test('enumeration excludes meals whose avoid score passes the exclusion threshold', () => {
  const rules = rulesFor();
  const preferences = { avoids: { LI1: 3.5, LI2: 3 } };
  const days = enumerateFeasibleDays({ mealDatabase: roomyCatalog(), rules, preferences });

  assert.ok(days.every((day) => !day.mealNames.includes('LI1')), 'avoid score 3.5 is above the threshold');
  assert.ok(days.some((day) => day.mealNames.includes('LI2')), 'avoid score of exactly 3 is not above it');
});

test('enumeration enforces the 50g per-day sanity floor', () => {
  const rules = rulesFor({ hard: { minMealProtein: 10 } });
  // R3 admits only Indian-lunch + non-Indian-dinner days, so the fixture needs
  // at least one of each for any day to be enumerable at all.
  const database = {
    breakfast: [meal({ name: 'Tiny B', p: 12, c: 5, cal: 120 })],
    lunchDinner: [
      meal({ name: 'Tiny L', p: 12, c: 5, cal: 130, cuisine: 'indian' }),
      meal({ name: 'Tiny D', p: 13, c: 5, cal: 140 }),
      meal({ name: 'Big L', p: 40, c: 20, cal: 480, cuisine: 'indian' }),
      meal({ name: 'Big D', p: 40, c: 20, cal: 480 })
    ],
    snack: []
  };

  const days = enumerateFeasibleDays({ mealDatabase: database, rules, preferences: {} });

  assert.ok(days.length > 0);
  assert.ok(days.every((day) => day.totals.protein >= 50), 'no day below the sanity floor survives');
  assert.ok(
    days.every((day) => day.mealNames.includes('Big L') || day.mealNames.includes('Big D')),
    'only combinations carrying a big meal clear 50g'
  );
});

// ─── Weekly Tier 1, counted against the week being generated ────────────────

test('R1: no dish repeats anywhere in the generated week', () => {
  const rules = rulesFor();
  const { days } = selectWeek({
    mealDatabase: roomyCatalog(),
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  assert.equal(days.length, 7);

  // One counter across all three slots — the rubric's R1 is not per-slot, so
  // a dish at lunch on one day and at dinner on another is still a repeat.
  const use = {};
  for (const day of days) {
    for (const name of day.mealNames) use[name] = (use[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(use)) {
    assert.ok(count <= rules.hard.maxDishRepeatsPerWeek, `${name} used ${count} times this week`);
  }
  assert.equal(Object.keys(use).length, 21, 'a 7-day week is 21 distinct dishes');
});

test('R1: the pinned dish may appear up to its allowance, nothing else may', () => {
  const rules = rulesFor();
  // Five breakfasts for seven days, so the week is only fillable if the pin
  // genuinely buys extra uses. The pin has to be a *non-egg* breakfast: R2
  // caps the week at 4 egg breakfasts, so pinning an egg one to 3 would leave
  // at most 1 further egg slot and no way to fill the remaining days.
  const database = roomyCatalog();
  database.breakfast = [
    database.breakfast[0], // BE1 egg
    database.breakfast[1], // BE2 egg
    database.breakfast[2], // BE3 egg
    database.breakfast[3], // B4  non-egg
    database.breakfast[4]  // B5  non-egg
  ];

  const { days } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {},
    pinnedDish: 'B4'
  });

  assert.equal(days.length, 7);
  const use = {};
  for (const day of days) {
    for (const name of day.mealNames) use[name] = (use[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(use)) {
    const limit = name === 'B4' ? rules.hard.pinnedDishMaxPerWeek : rules.hard.maxDishRepeatsPerWeek;
    assert.ok(count <= limit, `${name} used ${count} times (limit ${limit})`);
  }
});

test('R2: the generated week carries 3-4 egg-anchored breakfasts', () => {
  const rules = rulesFor();
  const { days } = selectWeek({
    mealDatabase: roomyCatalog(),
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  const eggs = days.filter((day) => day.isEggBreakfast).length;
  assert.ok(eggs >= rules.hard.eggBreakfastsMin, `${eggs} egg breakfasts, below the floor`);
  assert.ok(eggs <= rules.hard.eggBreakfastsMax, `${eggs} egg breakfasts, above the ceiling`);
});

test('R3: every generated day is Indian lunch + non-Indian dinner', () => {
  const rules = rulesFor();
  const { days } = selectWeek({
    mealDatabase: roomyCatalog(),
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  assert.equal(days.length, 7);
  for (const day of days) {
    assert.equal(day.lunch.cuisine, 'indian', `${day.dateKey} lunch is not Indian`);
    assert.notEqual(day.dinner.cuisine, 'indian', `${day.dateKey} dinner is Indian`);
  }
});

test('R3 is enforced at enumeration, so no illegal day is ever built', () => {
  const rules = rulesFor();
  const days = enumerateFeasibleDays({ mealDatabase: roomyCatalog(), rules, preferences: {} });

  assert.ok(days.length > 0);
  for (const day of days) {
    assert.equal(day.lunch.cuisine, 'indian');
    assert.notEqual(day.dinner.cuisine, 'indian');
  }
});

test('a locked day in the same week counts against R1', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  // Lock a day that spends three of the dishes; under R1 none may come back.
  const locked = {
    '2026-08-01': {
      breakfast: database.breakfast[0],
      lunch: database.lunchDinner[0],
      dinner: database.lunchDinner[7]
    }
  };

  const { days } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: ['2026-08-03', '2026-08-04'],
    preferences: {},
    lockedDays: locked
  });

  const lockedNames = ['BE1', 'LI1', 'DN1'];
  for (const day of days) {
    for (const name of day.mealNames) {
      assert.ok(!lockedNames.includes(name), `${name} was already used by a locked day`);
    }
  }
});

test('the anchor cap counts by ingredient family, not by raw ingredient id', () => {
  // Paneer, feta and halloumi are three different primary_ingredient ids that
  // all read as "cheese" to a person. Each was individually allowed up to the
  // old per-ingredient cap (2), so all three together could reach 6 cheese
  // meals in a week with no rule broken. The family cap must catch that.
  // Built on `roomyCatalog()` so the search has plenty of non-cheese slack
  // and stays on its normal feasible path rather than the lenient best-effort
  // fallback, which does not enforce this cap.
  const rules = rulesFor();
  const cheeseCap = anchorFamilyMaxPerWeek('cheese_soft', rules);
  const database = roomyCatalog();
  database.lunchDinner.push(
    meal({ name: 'Paneer bowl', p: 44, c: 30, cal: 560, primaryIngredient: 'paneer' }),
    meal({ name: 'Feta salad', p: 43, c: 30, cal: 555, cuisine: 'indian', primaryIngredient: 'feta' }),
    meal({ name: 'Halloumi wrap', p: 42, c: 30, cal: 550, cuisine: 'asian', primaryIngredient: 'halloumi' })
  );

  const { days, feasible } = selectWeek({ mealDatabase: database, rules, targetDateKeys: DATES, preferences: {} });
  assert.equal(feasible, true, 'roomyCatalog() plus three cheese dishes should stay comfortably feasible');

  const cheeseSoftUses = days
    .flatMap((day) => CORE_SLOTS.map((slot) => day[slot]))
    .filter(Boolean)
    .filter((m) => anchorFamilyOf(m.primary_ingredient) === 'cheese_soft')
    .length;

  assert.ok(
    cheeseSoftUses <= cheeseCap,
    `cheese_soft (paneer + feta + halloumi combined) used ${cheeseSoftUses} times, family cap is ${cheeseCap} — the old per-ingredient cap would have allowed up to 6`
  );
});

test('the anchor-family cap counts breakfast, not just lunch and dinner', () => {
  // Two of the six breakfasts are cheese_soft; the other four (roomyCatalog's
  // B1-B4) give the search plenty of unconstrained slack so it stays on its
  // normal feasible path rather than the lenient best-effort fallback, which
  // does not enforce this cap.
  const rules = rulesFor();
  const cheeseCap = anchorFamilyMaxPerWeek('cheese_soft', rules);
  const database = roomyCatalog();
  database.breakfast.push(
    meal({ name: 'Paneer poha', p: 40, c: 30, cal: 520, primaryIngredient: 'paneer' }),
    meal({ name: 'Feta oats', p: 38, c: 30, cal: 510, cuisine: 'indian', primaryIngredient: 'feta' })
  );

  const { days, feasible } = selectWeek({ mealDatabase: database, rules, targetDateKeys: DATES, preferences: {} });
  assert.equal(feasible, true, 'roomyCatalog() plus two cheese breakfasts should stay comfortably feasible');
  assert.equal(days.length, 7);

  const cheeseBreakfasts = days.filter(
    (day) => anchorFamilyOf(day.breakfast?.primary_ingredient) === 'cheese_soft'
  ).length;

  assert.ok(
    cheeseBreakfasts <= cheeseCap,
    `cheese breakfasts used ${cheeseBreakfasts} times, family cap is ${cheeseCap} — this only binds if breakfast is counted`
  );
});

test('a lunch/dinner swap is treated as the same day, not a distinct one', () => {
  // Only two lunch/dinner meals exist, so the only two "shapes" available are
  // L1-at-lunch/L2-at-dinner and its reverse — the same day to a person. The
  // old ordered nameKey treated these as different days and would have
  // allowed the reverse right after the locked day used the forward order.
  const rules = rulesFor();
  const database = {
    breakfast: [meal({ name: 'B1', p: 40, c: 30, cal: 520 })],
    lunchDinner: [
      meal({ name: 'L1', p: 48, c: 35, cal: 600 }),
      meal({ name: 'L2', p: 47, c: 35, cal: 590 })
    ],
    snack: []
  };
  const locked = {
    '2026-08-01': { breakfast: database.breakfast[0], lunch: database.lunchDinner[0], dinner: database.lunchDinner[1] }
  };

  const { feasible } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: ['2026-08-03'],
    preferences: {},
    lockedDays: locked
  });

  assert.equal(feasible, false, 'the lunch/dinner swap of an already-used day must not be accepted as a distinct day');
});

// ─── Tier 2 — budget accounting ─────────────────────────────────────────────

test('weekly totals and budget counts are accounted correctly', () => {
  const rules = getRules('high_protein', { dailyProteinTarget: 132 });
  const day = (protein, carbs, calories) => ({
    totals: { protein, carbs, calories },
    proteinInBand: protein >= 119 && protein <= 145,
    underCarbCap: carbs <= 130,
    inCalorieBounds: calories >= 1600 && calories <= 2200,
    redMeatCount: 0,
    breakfast: meal({ name: 'B', p: 30, cal: 400 }),
    lunch: meal({ name: 'L', p: 50, cal: 700 }),
    dinner: meal({ name: 'D', p: 50, cal: 700 })
  });

  const days = [
    day(132, 100, 1800),
    day(130, 100, 1800),
    day(128, 100, 1800),
    day(126, 100, 1800),
    day(124, 100, 1800),
    day(70, 180, 1200), // flex day: out of band, over carbs, under calories
    day(75, 100, 1900) // flex day: out of band only
  ];

  const summary = summariseWeek(days, rules);

  assert.equal(summary.dayCount, 7);
  assert.equal(summary.totalProtein, 785);
  assert.equal(summary.nominalProtein, 924);
  assert.equal(summary.proteinFloor, 785);
  assert.equal(summary.proteinPctOfNominal, 85.0);
  assert.equal(summary.daysProteinInBand, 5);
  assert.equal(summary.daysUnderCarbCap, 6);
  assert.equal(summary.daysInCalorieBounds, 6);
  assert.equal(summary.requiredCompliantDays, 5);
  assert.equal(summary.distinctMeals, 3);

  assert.equal(isWeekWithinBudgets(summary), true, 'exactly at the floor with exactly 5 in-band days is a pass');
});

test('a week one gram under the floor, or one day short of the budget, fails', () => {
  const rules = getRules('high_protein', { dailyProteinTarget: 132 });
  const base = {
    dayCount: 7,
    totalProtein: 785,
    proteinFloor: 785,
    daysProteinInBand: 5,
    daysUnderCarbCap: 5,
    daysInCalorieBounds: 5,
    requiredCompliantDays: 5
  };

  assert.equal(isWeekWithinBudgets(base), true);
  assert.equal(isWeekWithinBudgets({ ...base, totalProtein: 784 }), false);
  assert.equal(isWeekWithinBudgets({ ...base, daysProteinInBand: 4 }), false);
  assert.equal(isWeekWithinBudgets({ ...base, daysUnderCarbCap: 4 }), false);
  assert.equal(isWeekWithinBudgets({ ...base, daysInCalorieBounds: 4 }), false);
  assert.equal(rules.week.minDaysProteinInBand, 5);
});

test('the optimizer spends its 2 allowed miss days rather than forcing every day in band', () => {
  // Two very low-protein-but-legal days exist alongside plenty of strong ones.
  // The week must stay within budget, which means at most 2 misses.
  const rules = rulesFor();
  const database = roomyCatalog();
  database.lunchDinner.push(meal({ name: 'Light1', p: 21, c: 8, cal: 260 }));
  database.lunchDinner.push(meal({ name: 'Light2', p: 20, c: 8, cal: 250 }));

  const { days, summary } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    preferences: {}
  });

  assert.equal(days.length, 7);
  assert.ok(summary.daysProteinInBand >= 5, `only ${summary.daysProteinInBand} days in band`);
  assert.ok(summary.daysUnderCarbCap >= 5, `only ${summary.daysUnderCarbCap} days under the carb cap`);
  assert.ok(summary.daysInCalorieBounds >= 5, `only ${summary.daysInCalorieBounds} days in calorie bounds`);
  assert.ok(summary.totalProtein >= summary.proteinFloor, `weekly protein ${summary.totalProtein}g`);
});

test('a genuinely low flex day is accepted when the rest of the week compensates', () => {
  const rules = getRules('high_protein', { dailyProteinTarget: 132 });
  const strong = { protein: 150, carbs: 100, calories: 1900 };
  const flex = { protein: 62, carbs: 40, calories: 900 };
  const toDay = (totals) => ({
    totals,
    proteinInBand: totals.protein >= 119 && totals.protein <= 145,
    underCarbCap: totals.carbs <= 130,
    inCalorieBounds: totals.calories >= 1600 && totals.calories <= 2200,
    redMeatCount: 0,
    breakfast: meal({ name: 'B', p: 30, cal: 400 }),
    lunch: meal({ name: 'L', p: 50, cal: 700 }),
    dinner: meal({ name: 'D', p: 50, cal: 700 })
  });

  // 5 strong days at 150g plus 2 flex days at 62g: 874g, comfortably over 785.
  const summary = summariseWeek(
    [strong, strong, strong, strong, strong, flex, flex].map(toDay),
    rules
  );

  assert.equal(summary.totalProtein, 874);
  assert.ok(summary.totalProtein >= summary.proteinFloor);
  assert.equal(summary.daysProteinInBand, 0, '150g is above the band, so these are not "in band" either');

  // The weekly floor is the thing that makes flex days safe: drop the strong
  // days to a realistic 128g and the same two 62g flex days still clear it.
  const realistic = summariseWeek(
    [
      { protein: 128, carbs: 100, calories: 1800 },
      { protein: 128, carbs: 100, calories: 1800 },
      { protein: 128, carbs: 100, calories: 1800 },
      { protein: 128, carbs: 100, calories: 1800 },
      { protein: 132, carbs: 100, calories: 1800 },
      { protein: 70, carbs: 60, calories: 1100 },
      { protein: 70, carbs: 60, calories: 1100 }
    ].map(toDay),
    rules
  );
  assert.equal(realistic.daysProteinInBand, 5);
  assert.equal(realistic.totalProtein, 784);
  assert.ok(realistic.totalProtein < realistic.proteinFloor, '784g is one gram short — the floor bites');
});

// ─── Determinism and shortlists ─────────────────────────────────────────────

test('week selection is deterministic for fixed input', () => {
  const rules = rulesFor();
  const run = () =>
    selectWeek({ mealDatabase: roomyCatalog(), rules, targetDateKeys: DATES, preferences: {} })
      .days.map((day) => day.mealNames.join('|'));

  const first = run();
  for (let i = 0; i < 10; i += 1) assert.deepEqual(run(), first);
});

test('shortlists lead with the deterministic pick and stay inside the legal set', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  const result = buildWeekPlan({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    preferences: {}
  });

  const legalBreakfasts = new Set(database.breakfast.map((m) => m.name));
  const legalLunchDinner = new Set(database.lunchDinner.map((m) => m.name));

  for (const day of result.days) {
    const slots = result.shortlists[day.dateKey];
    assert.equal(slots.breakfast[0].name, day.breakfast.name, 'chosen breakfast leads its shortlist');
    assert.equal(slots.lunch[0].name, day.lunch.name);
    assert.equal(slots.dinner[0].name, day.dinner.name);

    assert.ok(slots.breakfast.every((m) => legalBreakfasts.has(m.name)));
    assert.ok(slots.lunch.every((m) => legalLunchDinner.has(m.name)));
    assert.ok(slots.dinner.every((m) => legalLunchDinner.has(m.name)));

    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      const names = slots[slot].map((m) => m.name);
      assert.equal(new Set(names).size, names.length, `${slot} shortlist has duplicates`);
    }
  }
});

test('history pushes the optimizer away from meals it just served', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  const historyMap = {
    '2026-08-01': { breakfast: database.breakfast[0], lunch: database.lunchDinner[0], dinner: database.lunchDinner[1] },
    '2026-08-02': { breakfast: database.breakfast[0], lunch: database.lunchDinner[0], dinner: database.lunchDinner[1] }
  };

  const withoutHistory = selectWeek({ mealDatabase: database, rules, targetDateKeys: DATES, preferences: {} });
  const withHistory = selectWeek({ mealDatabase: database, rules, targetDateKeys: DATES, historyMap, preferences: {} });

  const countB1 = (result) => result.days.filter((day) => day.mealNames[0] === 'B1').length;
  assert.ok(
    countB1(withHistory) <= countB1(withoutHistory),
    'the just-served breakfast should not be used more often after appearing in history'
  );
});

/**
 * The shortlist builder takes the best 60 of a candidate set that runs to six
 * figures, so it selects rather than sorting the whole set. Selection is only
 * safe if it breaks ties the way the stable sort it replaced did — earliest
 * candidate first — which is what this pins down, at deliberately high tie
 * density.
 */
test('shortlist selection breaks ties exactly as a stable descending sort would', () => {
  const rules = rulesFor();
  const stableSortReference = (pool, limit) =>
    [...pool].sort((a, b) => b.baseScore - a.baseScore).slice(0, limit);

  let seed = 20260805;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let trial = 0; trial < 200; trial += 1) {
    const size = 1 + Math.floor(nextRandom() * 200);
    const limit = 1 + Math.floor(nextRandom() * 60);
    // Few distinct scores, so most comparisons are ties.
    const distinctScores = 1 + Math.floor(nextRandom() * 4);

    const pool = Array.from({ length: size }, (unused, index) => ({
      baseScore: Math.floor(nextRandom() * distinctScores),
      mealNames: [`B${index}`, `L${index}`, `D${index}`],
      breakfast: { name: `B${index}` },
      lunch: { name: `L${index}` },
      dinner: { name: `D${index}` }
    }));

    const weekDays = [{ dateKey: '2026-08-03', ...pool[0] }];
    const options = { weekDays, dayCandidates: pool, rules, perSlot: 999 };

    const selected = buildSlotShortlists({ ...options, scoredCandidates: pool, alternateDays: limit });
    const sorted = buildSlotShortlists({
      ...options,
      scoredCandidates: stableSortReference(pool, limit),
      alternateDays: Number.MAX_SAFE_INTEGER
    });

    assert.deepEqual(
      selected.shortlists,
      sorted.shortlists,
      `bounded selection diverged from the stable sort (size ${size}, limit ${limit})`
    );
  }
});

// ─── R4 — scored, never gated ───────────────────────────────────────────────

test('R4: the optimizer avoids doubling up on flatbread/pasta when it can', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  // Every Indian lunch is flatbread, so R4 turns entirely on the dinner.
  // The dinner pool has to be *bigger* than the 7 slots for this to test a
  // preference at all: R1 forces all 7 dinners to be distinct, so a pool of
  // exactly 7 leaves no choice and any flatbread dinner in it is unavoidable.
  // Ten dinners — 7 rice, 3 flatbread — means avoiding R4 is possible, and
  // only a scored preference would actually do it.
  database.lunchDinner = [
    ...database.lunchDinner.map((m) => ({
      ...m,
      carb_type: m.name.startsWith('LI') ? 'flatbread_pasta' : 'rice'
    })),
    meal({ name: 'DN8', p: 46, c: 34, cal: 590, cuisine: 'asian' }),
    meal({ name: 'DN9', p: 45, c: 34, cal: 585 }),
    meal({ name: 'DN10', p: 44, c: 33, cal: 580, cuisine: 'asian' })
  ].map((m) => (['DN8', 'DN9', 'DN10'].includes(m.name) ? { ...m, carb_type: 'flatbread_pasta' } : m));

  const { days } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  const doubled = days.filter((day) => day.bothFlatbreadPasta).length;
  assert.equal(doubled, 0, 'seven rice dinners were available for seven days');
});

test('R4 is a preference, not a gate: a week is still produced when every day must double up', () => {
  const rules = rulesFor();
  const database = roomyCatalog();
  // Nothing but flatbread/pasta exists, so every day breaks R4. A gate here
  // would return no week at all; a preference still returns a full one.
  database.lunchDinner = database.lunchDinner.map((m) => ({ ...m, carb_type: 'flatbread_pasta' }));

  const result = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  assert.equal(result.days.length, 7);
  assert.ok(!result.bestEffort, 'the week is legal, just carrying R4 penalties');
  assert.equal(result.days.filter((day) => day.bothFlatbreadPasta).length, 7);
});

// ─── Infeasibility is reported, never silently relaxed ──────────────────────

test('an infeasible catalog reports which pool ran out rather than passing off a bad week', () => {
  const rules = rulesFor();
  // Only two Indian dishes exist, so R1 + R3 together cannot fill 7 lunches.
  const database = roomyCatalog();
  database.lunchDinner = database.lunchDinner.filter(
    (m) => !m.name.startsWith('LI') || ['LI1', 'LI2'].includes(m.name)
  );

  const result = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  assert.equal(result.feasible, false, 'an impossible week must not be reported feasible');
  assert.ok(result.bestEffort, 'the fallback must identify itself');
  assert.ok(result.constraintsRelaxed, 'a day with no legal placement must say so');
  assert.equal(result.diagnostics.distinctIndianLunches, 2, 'the diagnosis names the pool that ran out');
  assert.ok(result.diagnostics.distinctNonIndianDinners >= 7);
});
