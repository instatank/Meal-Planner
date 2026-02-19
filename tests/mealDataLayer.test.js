import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import {
  buildMealDataMetadata,
  deriveGoalFitTags,
  getGoalScores,
  getInvalidValueIssues,
  scoreGoalHighProtein,
  scoreGoalLowCarb,
  scoreGoalTwoMeals,
  scoreMealMetadataSimilarity,
  validateMacroCalorieConsistency
} from '../src/lib/mealDataLayer.js';
import { getFrequentConfirmedMeals, getSimilarMealSuggestions } from '../src/lib/mealEvents.js';

const at = (time) => new Date(time).toISOString();

test('meal database is enriched with structured tags and nutrition metadata (backward compatible)', () => {
  const sample = mealDatabase.breakfast[0];

  assert.equal(sample.name, 'Scrambled eggs + toast');
  assert.equal(sample.tags.meal_type, 'breakfast');
  assert.ok(['chicken', 'fish', 'red_meat', 'vegetarian', 'mixed'].includes(sample.tags.protein_family));
  assert.ok(['low', 'medium', 'high'].includes(sample.tags.carb_level));
  assert.ok(Array.isArray(sample.tags.goal_fit));

  assert.equal(typeof sample.nutrition_metadata.source_type, 'string');
  assert.equal(typeof sample.nutrition_metadata.source_url, 'string');
  assert.equal(typeof sample.nutrition_metadata.confidence_score, 'number');
  assert.equal(typeof sample.nutrition_metadata.needs_review, 'boolean');

  assert.equal(typeof sample.rule_metadata.protein_family, 'string');
  assert.equal(typeof sample.rule_metadata.meal_weight_class, 'string');
  assert.equal(typeof sample.rule_metadata.carb_level, 'string');
});

test('goal scoring helpers are deterministic', () => {
  const sampleMeal = {
    protein: 45,
    cal: 520,
    macros: { p: 45, c: 25, f: 20 }
  };

  assert.equal(scoreGoalHighProtein(sampleMeal), 0.86);
  assert.equal(scoreGoalLowCarb(sampleMeal), 0.88);
  assert.equal(scoreGoalTwoMeals(sampleMeal), 0.79);
  assert.deepEqual(getGoalScores(sampleMeal), {
    high_protein: 0.86,
    low_carb: 0.88,
    two_meals: 0.79
  });
  assert.deepEqual(deriveGoalFitTags(sampleMeal), ['high_protein', 'low_carb', 'two_meals']);
});

test('validation guardrails catch invalid values and macro-calorie mismatches', () => {
  const invalidMeal = {
    name: 'Broken meal',
    cal: 100,
    protein: -5,
    macros: { p: -5, c: 80, f: 40 },
    nutrition_source: 'user assumptions'
  };

  const invalidIssues = getInvalidValueIssues(invalidMeal);
  assert.ok(invalidIssues.length >= 2);

  const macroCheck = validateMacroCalorieConsistency(invalidMeal);
  assert.equal(macroCheck.is_consistent, false);

  const built = buildMealDataMetadata({ meal: invalidMeal, mealType: 'lunchDinner' });
  assert.equal(built.nutrition_metadata.needs_review, true);
  assert.ok(built.validation.issues.length >= 3);
});

test('metadata similarity uses format + protein_family + carb_level + cuisine', () => {
  const baseMeal = {
    tags: {
      format: 'soup',
      protein_family: 'chicken',
      carb_level: 'medium',
      cuisine: 'asian'
    }
  };

  const candidate = {
    tags: {
      format: 'soup',
      protein_family: 'chicken',
      carb_level: 'medium',
      cuisine: 'indian'
    }
  };

  const similarity = scoreMealMetadataSimilarity(baseMeal, candidate);
  assert.equal(similarity.score, 3);
  assert.deepEqual(similarity.matched_fields, ['format', 'protein_family', 'carb_level']);
});

test('similar meal suggestions trigger after 3 confirms in rolling 7 days', () => {
  const now = new Date('2026-02-19T12:00:00Z').getTime();
  const mockDatabase = {
    breakfast: [],
    snack: [],
    lunchDinner: [
      {
        meal_id: 'm1',
        name: 'Chicken Pho',
        protein: 42,
        cal: 430,
        macros: { p: 42, c: 35, f: 11 },
        tags: {
          meal_type: 'lunch_dinner',
          protein_family: 'chicken',
          carb_level: 'medium',
          cuisine: 'asian',
          format: 'soup',
          effort: 'medium',
          goal_fit: ['high_protein']
        }
      },
      {
        meal_id: 'm2',
        name: 'Chicken Ramen Bowl',
        protein: 39,
        cal: 470,
        macros: { p: 39, c: 40, f: 13 },
        tags: {
          meal_type: 'lunch_dinner',
          protein_family: 'chicken',
          carb_level: 'medium',
          cuisine: 'asian',
          format: 'soup',
          effort: 'medium',
          goal_fit: ['high_protein']
        }
      },
      {
        meal_id: 'm3',
        name: 'Fish Curry Rice',
        protein: 36,
        cal: 410,
        macros: { p: 36, c: 31, f: 12 },
        tags: {
          meal_type: 'lunch_dinner',
          protein_family: 'fish',
          carb_level: 'medium',
          cuisine: 'indian',
          format: 'curry',
          effort: 'medium',
          goal_fit: []
        }
      }
    ]
  };

  const events = [
    { id: 'c1', type: 'confirm', mealName: 'Chicken Pho', mealType: 'lunch', timestamp: at('2026-02-14T09:00:00Z') },
    { id: 'c2', type: 'confirm', mealName: 'Chicken Pho', mealType: 'dinner', timestamp: at('2026-02-16T09:00:00Z') },
    { id: 'c3', type: 'confirm', mealName: 'Chicken Pho', mealType: 'lunch', timestamp: at('2026-02-18T09:00:00Z') },
    { id: 'c4', type: 'confirm', mealName: 'Fish Curry Rice', mealType: 'dinner', timestamp: at('2026-02-18T10:00:00Z') }
  ];

  const frequent = getFrequentConfirmedMeals(events, { nowMs: now, lookbackDays: 7, minCount: 3 });
  assert.equal(frequent.length, 1);
  assert.equal(frequent[0].mealName, 'Chicken Pho');
  assert.equal(frequent[0].count, 3);

  const suggestions = getSimilarMealSuggestions({
    events,
    mealDatabase: mockDatabase,
    options: { nowMs: now, lookbackDays: 7, minCount: 3, maxSuggestions: 3 }
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].trigger_meal_name, 'Chicken Pho');
  assert.equal(suggestions[0].confirm_count_7d, 3);
  assert.equal(suggestions[0].suggested_meals[0].meal_name, 'Chicken Ramen Bowl');
  assert.equal(suggestions[0].suggested_meals[0].score, 4);
});

test('similar meal suggestions do not trigger below threshold', () => {
  const now = new Date('2026-02-19T12:00:00Z').getTime();
  const events = [
    { id: 'c1', type: 'confirm', mealName: 'Chicken Pho', mealType: 'lunch', timestamp: at('2026-02-17T09:00:00Z') },
    { id: 'c2', type: 'confirm', mealName: 'Chicken Pho', mealType: 'dinner', timestamp: at('2026-02-18T09:00:00Z') }
  ];

  const suggestions = getSimilarMealSuggestions({
    events,
    mealDatabase,
    options: { nowMs: now, lookbackDays: 7, minCount: 3 }
  });

  assert.deepEqual(suggestions, []);
});
