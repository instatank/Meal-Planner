import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultPlan,
  generatePlanForDate,
  getMealsForType,
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

  assert.deepEqual(snapshot, {
    breakfast: 'Carrot halwa (sugar-free) + protein shake',
    lunch: 'Chicken curry + jowar roti + dal',
    dinner: 'Vietnamese chicken pho'
  });
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
