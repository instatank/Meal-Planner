import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARB_HEAVY_THRESHOLD,
  createDefaultPlan,
  DAILY_CARB_HARD_CAP,
  DAILY_PROTEIN_MAX,
  DAILY_PROTEIN_MIN,
  DAILY_PROTEIN_SANITY_FLOOR,
  FAT_HEAVY_THRESHOLD,
  generatePlanForDate,
  getMealsForType,
  MIN_MEAL_PROTEIN,
  normalizePreferences
} from '../src/lib/plannerGenerator.js';
import { mealDatabase } from '../src/data/mealDatabase.js';

const fixtureDateKey = '2026-02-17';

const fixturePlans = {
  '2026-02-12': {
    breakfast: mealDatabase.breakfast[0],
    lunch: mealDatabase.lunchDinner[0],
    dinner: mealDatabase.lunchDinner[1]
  },
  '2026-02-13': {
    breakfast: mealDatabase.breakfast[1],
    lunch: mealDatabase.lunchDinner[2],
    dinner: mealDatabase.lunchDinner[3]
  },
  '2026-02-14': {
    breakfast: mealDatabase.breakfast[2],
    lunch: mealDatabase.lunchDinner[4],
    dinner: mealDatabase.lunchDinner[5]
  },
  '2026-02-15': {
    breakfast: mealDatabase.breakfast[3],
    lunch: mealDatabase.lunchDinner[6],
    dinner: mealDatabase.lunchDinner[7]
  },
  '2026-02-16': {
    breakfast: mealDatabase.breakfast[4],
    lunch: mealDatabase.lunchDinner[8],
    dinner: mealDatabase.lunchDinner[9]
  }
};

const fixturePreferences = normalizePreferences({
  accepts: {
    'Poha + kabab/protein shake': 2,
    'Chicken curry + jowar roti': 1.5
  },
  avoids: {
    'Pork chop + pumpkin salad': 2
  },
  edits: {
    'Vietnamese chicken pho': 1
  }
});

const PRIMARY_FAMILY_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawn|shrimp)\b/i,
  chicken: /\b(chicken|turkey)\b/i,
  'red-meat': /\b(beef|mutton|lamb|pork|steak|keema|kofta)\b/i
};

const PRIMARY_FAMILY_COUNT_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawn|shrimp)\b/gi,
  chicken: /\b(chicken|turkey)\b/gi,
  'red-meat': /\b(beef|mutton|lamb|pork|steak|keema|kofta)\b/gi
};

const LEGUME_FIBRE_PATTERN = /\b(dal|rajma|chole|lentil|bean|sambar)\b/i;
const VEG_FIBRE_PATTERN = /\b(salad|greens|broccoli|gobi|veg|vegetable|pumpkin|matar|saag)\b/i;
const WHOLEGRAIN_FIBRE_PATTERN = /\b(jowar|millet|whole|oat)\b/i;

const getMacro = (meal, key) => Number(meal?.macros?.[key] || 0);

const isHeavyMeal = (meal) => (meal.cal || 0) > 600 || (getMacro(meal, 'f') > 25 && getMacro(meal, 'c') > 35);
const isCarbHeavyMeal = (meal) => getMacro(meal, 'c') >= CARB_HEAVY_THRESHOLD;
const isFatHeavyMeal = (meal) => getMacro(meal, 'f') > FAT_HEAVY_THRESHOLD;

const getPrimaryFamily = (meal) => {
  const text = `${meal?.components?.protein || ''} ${meal?.name || ''}`;
  if (PRIMARY_FAMILY_PATTERNS.fish.test(text)) return 'fish';
  if (PRIMARY_FAMILY_PATTERNS.chicken.test(text)) return 'chicken';
  if (PRIMARY_FAMILY_PATTERNS['red-meat'].test(text)) return 'red-meat';
  return null;
};

const hasRepeatedPrimaryFamilyInsideMeal = (meal) => {
  const mealName = String(meal?.name || '');
  return Object.values(PRIMARY_FAMILY_COUNT_PATTERNS).some((pattern) => {
    const matches = mealName.match(pattern);
    return (matches?.length || 0) >= 2;
  });
};

const hasMeatFibreHint = (meal) => {
  const primaryFamily = getPrimaryFamily(meal);
  if (!primaryFamily) return true;
  const text = `${meal?.name || ''} ${meal?.components?.carb || ''} ${meal?.components?.veg || ''}`;
  return LEGUME_FIBRE_PATTERN.test(text) || VEG_FIBRE_PATTERN.test(text) || WHOLEGRAIN_FIBRE_PATTERN.test(text);
};

const isIndian = (meal) => String(meal?.cuisine || '').toLowerCase() === 'indian';

/**
 * Tier 1 — the rules a plan may never break. Under the "aim daily, judge
 * weekly" model this list is deliberately short: the daily protein band, the
 * carb cap and the calorie bounds moved to Tier 2 (budgeted across the week),
 * so a single day is only required to clear the 50g sanity floor.
 */
const assertSatisfiesHardConstraints = (plan) => {
  const meals = [plan.breakfast, plan.lunch, plan.dinner];
  const totalProtein = meals.reduce((sum, meal) => sum + Number(meal?.protein || 0), 0);
  const names = meals.map((meal) => String(meal?.name || ''));

  assert.ok(totalProtein >= DAILY_PROTEIN_SANITY_FLOOR, `day falls below the sanity floor: ${totalProtein}g`);
  assert.ok(meals.every((meal) => Number(meal?.protein || 0) >= MIN_MEAL_PROTEIN), 'each meal must be at least 20g protein');
  assert.equal(new Set(names).size, names.length, `no meal may appear twice in one day: ${names.join(' | ')}`);
};

/**
 * Tier 2 + Tier 3 — what the generator *aims* for. A single generated day is
 * expected to hit these; a week is only required to hit them on 5 of 7 days,
 * which is asserted in tests/planOptimizer.test.js instead.
 */
const assertDayHitsItsTargets = (plan) => {
  const meals = [plan.breakfast, plan.lunch, plan.dinner];
  const totalProtein = meals.reduce((sum, meal) => sum + Number(meal?.protein || 0), 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + getMacro(meal, 'c'), 0);
  const proteinValues = meals.map((meal) => Number(meal?.protein || 0));

  assert.ok(
    totalProtein >= DAILY_PROTEIN_MIN && totalProtein <= DAILY_PROTEIN_MAX,
    `total protein out of band: ${totalProtein}`
  );
  assert.ok(totalCarbs <= DAILY_CARB_HARD_CAP, `total carbs exceed cap: ${totalCarbs}`);
  assert.ok(meals.filter(isHeavyMeal).length <= 1, 'max 1 heavy meal/day');
  assert.ok(meals.filter(isCarbHeavyMeal).length <= 1, 'max 1 carb-heavy meal/day');
  assert.ok(meals.filter(isFatHeavyMeal).length <= 1, 'max 1 fat-heavy meal/day');
  assert.ok(meals.every((meal) => !hasRepeatedPrimaryFamilyInsideMeal(meal)), 'no repeated primary family inside one meal');
  assert.ok(meals.every((meal) => hasMeatFibreHint(meal)), 'meat meals must include fibre hints');
  assert.ok(!(isIndian(plan.lunch) && isIndian(plan.dinner)), 'lunch+dinner should not both be Indian');

  const lunchFamily = getPrimaryFamily(plan.lunch);
  const dinnerFamily = getPrimaryFamily(plan.dinner);
  if (lunchFamily && dinnerFamily) {
    assert.notEqual(lunchFamily, dinnerFamily, 'lunch and dinner should not repeat same primary protein family');
  }

  assert.ok(Math.max(...proteinValues) - Math.min(...proteinValues) <= 40, 'protein should be balanced across meals');
};

const runFixture = () =>
  generatePlanForDate({
    dateKey: fixtureDateKey,
    plans: structuredClone(fixturePlans),
    preferences: structuredClone(fixturePreferences),
    mealDatabase
  });

test('planner generation is deterministic for fixed input', () => {
  const first = runFixture();

  for (let i = 0; i < 25; i += 1) {
    assert.deepEqual(runFixture(), first);
  }
});

test('planner regression snapshot for fixed fixture', () => {
  const generated = runFixture();
  const snapshot = {
    breakfast: generated.breakfast?.name,
    lunch: generated.lunch?.name,
    dinner: generated.dinner?.name
  };

  // This snapshot tracks the catalog, not correctness — it exists to catch
  // *accidental* changes in planner output. Adding meals legitimately changes
  // which dish wins a slot, so update it deliberately when the catalog grows
  // and rely on the hard-constraint and daily-target tests below for whether
  // the plan is actually valid. Last updated for the 2026-08-03 research
  // batch, which put a leaner 463 kcal dinner ahead of the 514 kcal one.
  assert.deepEqual(snapshot, {
    breakfast: 'Boiled eggs + ham sandwich',
    lunch: 'Chicken curry + jowar roti',
    dinner: 'Mackerel & quinoa salad'
  });
});

test('generated fixture plan satisfies Tier-1 hard constraints', () => {
  const generated = runFixture();
  assertSatisfiesHardConstraints(generated);
});

test('generated fixture plan hits its daily targets', () => {
  const generated = runFixture();
  assertDayHitsItsTargets(generated);
});

test('hard constraints and daily targets hold across a date sample', () => {
  const dateKeys = ['2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23'];

  for (const dateKey of dateKeys) {
    const generated = generatePlanForDate({
      dateKey,
      plans: structuredClone(fixturePlans),
      preferences: structuredClone(fixturePreferences),
      mealDatabase
    });
    assertSatisfiesHardConstraints(generated);
    assertDayHitsItsTargets(generated);
  }
});

test('a low-protein flex day passes Tier 1 but is flagged as off-target', () => {
  // The direct implementation of "a 70g day is a pass, not a bug": the same
  // day clears every hard rule while missing the band.
  const flexDay = {
    breakfast: mealDatabase.breakfast.find((m) => m.name === 'Egg white omelette + avocado'),
    lunch: mealDatabase.lunchDinner.find((m) => m.name === 'Avocado and smoked salmon salad'),
    dinner: mealDatabase.lunchDinner.find((m) => m.name === 'Avocado and smoked chicken salad')
  };
  const totalProtein = [flexDay.breakfast, flexDay.lunch, flexDay.dinner]
    .reduce((sum, meal) => sum + Number(meal.protein || 0), 0);

  assert.ok(totalProtein < DAILY_PROTEIN_MIN, `expected an off-band day, got ${totalProtein}g`);
  assert.doesNotThrow(() => assertSatisfiesHardConstraints(flexDay));
});

test('lunch and dinner both draw from shared lunchDinner pool', () => {
  const lunchMeals = getMealsForType(mealDatabase, 'lunch');
  const dinnerMeals = getMealsForType(mealDatabase, 'dinner');

  assert.strictEqual(lunchMeals, dinnerMeals);
  assert.equal(lunchMeals.length, mealDatabase.lunchDinner.length);
  assert.ok(lunchMeals.length > 0);
});

test('default plan uses first breakfast + shared first lunch/dinner meal', () => {
  const defaultPlan = createDefaultPlan(mealDatabase);

  assert.equal(defaultPlan.breakfast?.name, mealDatabase.breakfast[0]?.name);
  assert.equal(defaultPlan.lunch?.name, mealDatabase.lunchDinner[0]?.name);
  assert.equal(defaultPlan.dinner?.name, mealDatabase.lunchDinner[0]?.name);
});
