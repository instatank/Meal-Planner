import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { CARB_HEAVY_THRESHOLD } from '../src/lib/plannerGenerator.js';
import { ONBOARDING_GOAL } from '../src/lib/onboardingProfile.js';
import { buildGoalAdjustedPlannerInput, getMealTypeOrderForGoal } from '../src/lib/onboardingPlannerAdapter.js';

test('two_meals_day goal returns lunch+dinner slot order by default', () => {
  assert.deepEqual(
    getMealTypeOrderForGoal({
      goal: ONBOARDING_GOAL.TWO_MEALS_DAY,
      plan: {},
      history: {}
    }),
    ['lunch', 'dinner']
  );

  assert.deepEqual(
    getMealTypeOrderForGoal({
      goal: ONBOARDING_GOAL.TWO_MEALS_DAY,
      plan: { snack: { name: 'Nuts' } },
      history: {}
    }),
    ['lunch', 'snack', 'dinner']
  );
});

test('high_protein goal boosts protein target and accepts high-protein meals', () => {
  const result = buildGoalAdjustedPlannerInput({
    goal: ONBOARDING_GOAL.HIGH_PROTEIN,
    preferences: { accepts: {}, avoids: {}, edits: {}, skips: {} },
    mealDatabase,
    dailyProteinTarget: 120
  });

  assert.ok(result.dailyProteinTarget > 120);
  assert.ok(result.preferences.accepts['Chicken curry + jowar roti'] > 0);
  assert.ok(result.preferences.accepts['Chicken soup + smoked salmon salad'] > 0);
});

test('low_carb goal penalizes carb-heavy meals deterministically', () => {
  const baseInput = {
    goal: ONBOARDING_GOAL.LOW_CARB,
    preferences: { accepts: {}, avoids: {}, edits: {}, skips: {} },
    mealDatabase,
    dailyProteinTarget: 120
  };
  const first = buildGoalAdjustedPlannerInput(baseInput);
  const second = buildGoalAdjustedPlannerInput(baseInput);

  assert.deepEqual(first, second);

  const carbHeavyMeal = mealDatabase.lunchDinner.find((meal) => Number(meal?.macros?.c || 0) >= CARB_HEAVY_THRESHOLD);
  assert.ok(carbHeavyMeal, 'expected at least one carb-heavy meal in fixture');
  assert.ok(first.preferences.avoids[carbHeavyMeal.name] > 0);
});

