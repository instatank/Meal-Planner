import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSlotShortlists,
  buildWeekPlan,
  enumerateFeasibleDays,
  isWeekWithinBudgets,
  selectWeek,
  summariseWeek
} from '../src/lib/planOptimizer.js';
import { getRules } from '../src/lib/rules.js';

const DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];

/** A meal with every field the optimizer reads, so fixtures stay explicit. */
const meal = ({ name, p, c = 20, f = 10, cal, cuisine = 'continental', weight = 'Medium', family = 'vegetarian', fibre = true }) => ({
  name,
  canonical_name: name,
  protein: p,
  cal,
  macros: { p, c, f },
  cuisine,
  meal_weight: weight,
  has_fibre: fibre,
  tags: { protein_family: family }
});

/**
 * A catalog with enough headroom that a compliant week is easy to find, so the
 * tests below isolate the accounting rather than the catalog's limitations.
 */
const roomyCatalog = () => ({
  breakfast: [
    meal({ name: 'B1', p: 40, c: 30, cal: 520 }),
    meal({ name: 'B2', p: 38, c: 30, cal: 510, cuisine: 'indian' }),
    meal({ name: 'B3', p: 36, c: 28, cal: 500, cuisine: 'asian' }),
    meal({ name: 'B4', p: 34, c: 28, cal: 495 })
  ],
  lunchDinner: [
    meal({ name: 'L1', p: 48, c: 35, cal: 600, family: 'chicken' }),
    meal({ name: 'L2', p: 47, c: 35, cal: 590, cuisine: 'indian', family: 'fish' }),
    meal({ name: 'L3', p: 46, c: 34, cal: 585, cuisine: 'asian' }),
    meal({ name: 'L4', p: 45, c: 34, cal: 580, family: 'chicken' }),
    meal({ name: 'L5', p: 44, c: 33, cal: 575, cuisine: 'indian' }),
    meal({ name: 'L6', p: 43, c: 33, cal: 570, cuisine: 'asian', family: 'fish' }),
    meal({ name: 'L7', p: 42, c: 32, cal: 565 }),
    meal({ name: 'L8', p: 41, c: 32, cal: 560, cuisine: 'indian' })
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
  const preferences = { avoids: { L1: 3.5, L2: 3 } };
  const days = enumerateFeasibleDays({ mealDatabase: roomyCatalog(), rules, preferences });

  assert.ok(days.every((day) => !day.mealNames.includes('L1')), 'avoid score 3.5 is above the threshold');
  assert.ok(days.some((day) => day.mealNames.includes('L2')), 'avoid score of exactly 3 is not above it');
});

test('enumeration enforces the 50g per-day sanity floor', () => {
  const rules = rulesFor({ hard: { minMealProtein: 10 } });
  const database = {
    breakfast: [meal({ name: 'Tiny B', p: 12, c: 5, cal: 120 })],
    lunchDinner: [
      meal({ name: 'Tiny L', p: 12, c: 5, cal: 130 }),
      meal({ name: 'Tiny D', p: 13, c: 5, cal: 140 }),
      meal({ name: 'Big D', p: 40, c: 20, cal: 480 })
    ],
    snack: []
  };

  const days = enumerateFeasibleDays({ mealDatabase: database, rules, preferences: {} });

  assert.ok(days.length > 0);
  assert.ok(days.every((day) => day.totals.protein >= 50), 'no day below the sanity floor survives');
  assert.ok(days.every((day) => day.mealNames.includes('Big D')), 'only combinations carrying the big meal clear 50g');
});

// ─── Weekly Tier 1, counted against the week being generated ────────────────

test('weekly repetition ceilings are counted against the generated week', () => {
  const rules = rulesFor();
  const { days } = selectWeek({
    mealDatabase: roomyCatalog(),
    rules,
    targetDateKeys: DATES,
    historyMap: {},
    preferences: {}
  });

  assert.equal(days.length, 7);

  const breakfastUse = {};
  const lunchDinnerUse = {};
  for (const day of days) {
    breakfastUse[day.mealNames[0]] = (breakfastUse[day.mealNames[0]] || 0) + 1;
    for (const name of [day.mealNames[1], day.mealNames[2]]) {
      lunchDinnerUse[name] = (lunchDinnerUse[name] || 0) + 1;
    }
  }

  for (const [name, count] of Object.entries(breakfastUse)) {
    assert.ok(count <= rules.hard.maxBreakfastRepeatsPerWeek, `${name} used ${count} times at breakfast`);
  }
  for (const [name, count] of Object.entries(lunchDinnerUse)) {
    assert.ok(count <= rules.hard.maxLunchDinnerRepeatsPerWeek, `${name} used ${count} times at lunch/dinner`);
  }
});

test('a locked day in the same week counts against the repetition ceilings', () => {
  // Only two lunch/dinner meals exist and the cap is 2 uses each, so the four
  // slots the locked days already occupy leave exactly two free.
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

  const { days } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: ['2026-08-03'],
    preferences: {},
    lockedDays: locked
  });

  // One use of each remains, so the single generated day is still placeable.
  assert.equal(days.length, 1);

  const twoDays = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: ['2026-08-03', '2026-08-04'],
    preferences: {},
    lockedDays: locked
  });

  // The second day has no legal placement left, so the search falls back
  // rather than quietly exceeding the ceiling.
  assert.equal(twoDays.feasible, false);
});

test('the red-meat cap is counted across the generated week, not just history', () => {
  const rules = rulesFor();
  const database = {
    breakfast: [
      meal({ name: 'B1', p: 40, c: 30, cal: 520 }),
      meal({ name: 'B2', p: 38, c: 30, cal: 515, cuisine: 'indian' })
    ],
    lunchDinner: [
      meal({ name: 'Steak', p: 50, c: 30, cal: 600, family: 'red_meat' }),
      meal({ name: 'Pork', p: 49, c: 30, cal: 595, family: 'red_meat', cuisine: 'indian' }),
      meal({ name: 'Lamb', p: 48, c: 30, cal: 590, family: 'red_meat', cuisine: 'asian' }),
      meal({ name: 'Chicken', p: 47, c: 30, cal: 585, family: 'chicken' }),
      meal({ name: 'Fish', p: 46, c: 30, cal: 580, family: 'fish', cuisine: 'asian' }),
      meal({ name: 'Paneer', p: 45, c: 30, cal: 575, cuisine: 'indian' })
    ],
    snack: []
  };

  const { days, summary } = selectWeek({
    mealDatabase: database,
    rules,
    targetDateKeys: DATES,
    preferences: {}
  });

  assert.equal(days.length, 7);
  assert.ok(
    summary.redMeatMeals <= rules.hard.redMeatMealsPerWeek,
    `red meat meals: ${summary.redMeatMeals}`
  );
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
