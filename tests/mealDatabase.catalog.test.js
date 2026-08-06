import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { ingredients } from '../src/data/ingredients.js';
import { validateMacroCalorieConsistency } from '../src/lib/mealDataLayer.js';
import { getRules } from '../src/lib/rules.js';

const allMeals = () => [...mealDatabase.breakfast, ...mealDatabase.lunchDinner, ...mealDatabase.snack];
const rules = getRules('high_protein');

// ─── Structural integrity ───────────────────────────────────────────────────

test('every meal part references a real ingredient', () => {
  for (const meal of allMeals()) {
    for (const part of meal.parts || []) {
      assert.ok(
        ingredients[part.ingredientId],
        `${meal.canonical_name} references unknown ingredient "${part.ingredientId}" — `
        + 'computeMacros silently skips these, so the meal would carry understated macros.'
      );
    }
  }
});

test('meal ids and canonical names are unique', () => {
  const ids = allMeals().map((meal) => meal.meal_id);
  const names = allMeals().map((meal) => meal.canonical_name);

  assert.equal(new Set(ids).size, ids.length, 'duplicate meal_id');
  assert.equal(new Set(names).size, names.length, 'duplicate canonical_name');
});

// ─── The macro/calorie asset ────────────────────────────────────────────────

test('every meal passes the macro-calorie consistency check', () => {
  // The Phase 2 handover calls this "a real asset, protect it" — it was 41 of
  // 41 before the catalog grew and it has to stay at 100%. A meal whose
  // calories drift from 4/4/9 on its own macros is a data-entry error that
  // flows straight into an optimizer which now trusts its inputs completely.
  const failures = allMeals()
    .map((meal) => ({ meal, check: validateMacroCalorieConsistency(meal) }))
    .filter(({ check }) => !check.is_consistent)
    .map(({ meal, check }) => `${meal.canonical_name}: ${meal.cal} kcal vs ${check.expected_kcal} expected (delta ${check.delta_kcal})`);

  assert.deepEqual(failures, [], `macro-calorie mismatches:\n  ${failures.join('\n  ')}`);
});

// ─── Catalog capability (Phase 2 §5 acceptance criteria) ────────────────────

test('at least 8 breakfasts clear the per-meal protein floor', () => {
  const legal = mealDatabase.breakfast.filter((meal) => meal.protein >= rules.hard.minMealProtein);

  assert.ok(
    legal.length >= 8,
    `only ${legal.length} of ${mealDatabase.breakfast.length} breakfasts clear `
    + `${rules.hard.minMealProtein}g. Breakfast is the slot that caps every day.`
  );
});

test('at least 3 breakfasts carry more than 35g of protein', () => {
  const high = mealDatabase.breakfast.filter((meal) => meal.protein > 35);

  assert.ok(
    high.length >= 3,
    `only ${high.length} breakfasts exceed 35g of protein: ${high.map((m) => m.canonical_name).join(', ')}`
  );
});

test('lunch/dinner carries at least 6 Asian dishes', () => {
  // The weekly prompt asks the model to mix Indian, Continental and Asian
  // through the week and Tier-3 pays a cuisine-variety bonus. With 3 Asian
  // dishes and a 2-per-week repeat ceiling, Asian could fill at most 6 of 14
  // lunch/dinner slots and the bonus was partly unearnable.
  const asian = mealDatabase.lunchDinner.filter((meal) => String(meal.cuisine).toLowerCase() === 'asian');

  assert.ok(
    asian.length >= 6,
    `only ${asian.length} Asian lunch/dinner dishes: ${asian.map((m) => m.canonical_name).join(', ')}`
  );
});

test('no single cuisine dominates lunch/dinner outright', () => {
  const counts = new Map();
  for (const meal of mealDatabase.lunchDinner) {
    const cuisine = String(meal.cuisine).toLowerCase();
    counts.set(cuisine, (counts.get(cuisine) || 0) + 1);
  }

  const total = mealDatabase.lunchDinner.length;
  for (const [cuisine, count] of counts) {
    assert.ok(
      count / total <= 0.6,
      `${cuisine} is ${count} of ${total} lunch/dinner dishes — the week cannot vary cuisine it does not have`
    );
  }
});

test('breakfasts exist inside the measured protein/calorie/carb envelope', () => {
  // docs/PHASE2_HANDOVER.md §2: the catalog needs breakfasts that clear
  // protein AND calories AND carbs at once. Optimising any one axis alone
  // moves a budget and breaks another, which is what the two 19g/96g-carb
  // breakfasts in this catalog demonstrate.
  const inEnvelope = mealDatabase.breakfast.filter(
    (meal) =>
      meal.protein >= 35 && meal.protein <= 45
      && meal.cal >= 500 && meal.cal <= 600
      && meal.macros.c <= 55
  );

  assert.ok(
    inEnvelope.length >= 3,
    `only ${inEnvelope.length} breakfasts satisfy 35-45g protein, 500-600 kcal and <=55g carbs together`
  );
});
