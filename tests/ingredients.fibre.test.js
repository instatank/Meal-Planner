import test from 'node:test';
import assert from 'node:assert/strict';

import { ingredients } from '../src/data/ingredients.js';
import { computeMacros } from '../src/lib/mealDataLayer.js';
import { mealDatabase } from '../src/data/mealDatabase.js';

test('every ingredient carries a dietary fibre figure', () => {
  const missing = Object.entries(ingredients)
    .filter(([, ing]) => typeof ing?.per100g?.fibre !== 'number')
    .map(([id]) => id);

  assert.deepEqual(
    missing,
    [],
    `ingredients without a fibre figure: ${missing.join(', ')}. A missing value is a data bug, not a zero.`
  );
});

test('fibre figures are plausible per 100g', () => {
  for (const [id, ing] of Object.entries(ingredients)) {
    const fibre = ing.per100g.fibre;
    assert.ok(fibre >= 0, `${id} has negative fibre`);
    // Nothing in this table is a bran concentrate; almonds at 12.5g is the top.
    assert.ok(fibre <= 20, `${id} claims ${fibre}g fibre per 100g — check the source`);
    // Fibre is a subset of carbohydrate, so it can never exceed it.
    assert.ok(
      fibre <= ing.per100g.c + 0.01,
      `${id} claims ${fibre}g fibre against ${ing.per100g.c}g carbs`
    );
  }
});

test('computeMacros rolls fibre up like every other macro', () => {
  // 150g chicken breast (0g fibre) + 2 jowar rotis at 40g each (6.5g/100g).
  const result = computeMacros([
    { ingredientId: 'chicken_breast', qty: 150, unit: 'g' },
    { ingredientId: 'jowar_roti', qty: 2, unit: 'piece' }
  ]);

  assert.equal(result.macros.fibre, 5.2);
  assert.equal(result.macros.p, 52);
});

test('computeMacros keeps one decimal of fibre rather than rounding to whole grams', () => {
  const result = computeMacros([{ ingredientId: 'cooked_rice', qty: 100, unit: 'g' }]);
  assert.equal(result.macros.fibre, 0.4);
});

test('every catalog meal carries a rolled-up fibre total', () => {
  const meals = [...mealDatabase.breakfast, ...mealDatabase.lunchDinner, ...mealDatabase.snack];

  for (const meal of meals) {
    assert.equal(
      typeof meal.macros.fibre,
      'number',
      `${meal.canonical_name} has no fibre total`
    );
    assert.ok(meal.macros.fibre >= 0, `${meal.canonical_name} has negative fibre`);
  }
});
