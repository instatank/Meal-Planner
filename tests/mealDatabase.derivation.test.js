import test from 'node:test';
import assert from 'node:assert/strict';

import { handAuthoredTags, handAuthoredTagFields, mealDatabase } from '../src/data/mealDatabase.js';
import {
  deriveHasFibre,
  deriveIsFatHeavy,
  deriveMealTags,
  deriveMealWeight
} from '../src/lib/mealDataLayer.js';
import {
  FAT_HEAVY_THRESHOLD,
  FIBRE_MEAL_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  MEDIUM_MEAL_CALORIES
} from '../src/lib/rules.js';

const allMeals = () => [...mealDatabase.breakfast, ...mealDatabase.lunchDinner, ...mealDatabase.snack];

// ─── The hand-authored map keeps only subjective fields ─────────────────────

test('the hand-authored tag map carries no derived field', () => {
  const derivedFields = ['is_fat_heavy', 'has_fibre', 'meal_weight'];

  for (const [name, tags] of Object.entries(handAuthoredTags)) {
    for (const field of derivedFields) {
      assert.ok(
        !(field in tags),
        `"${name}" hand-types ${field}. That field is derived from the meal's own macros in `
        + 'deriveMealTags — typing it here is how the two drifted apart in the first place.'
      );
    }

    const unexpected = Object.keys(tags).filter((key) => !handAuthoredTagFields.includes(key));
    assert.deepEqual(
      unexpected,
      [],
      `"${name}" hand-types ${unexpected.join(', ')}; only ${handAuthoredTagFields.join(', ')} may be hand-authored.`
    );
  }
});

test('every catalog meal still gets a cuisine from the hand-authored map', () => {
  for (const meal of allMeals()) {
    assert.equal(
      typeof meal.cuisine,
      'string',
      `${meal.canonical_name} lost its cuisine`
    );
    assert.ok(meal.cuisine.length > 0, `${meal.canonical_name} has an empty cuisine`);
  }
});

// ─── is_fat_heavy: fat > 25g ────────────────────────────────────────────────

test('is_fat_heavy is fat above the Tier-3 fat threshold', () => {
  assert.equal(deriveIsFatHeavy({ macros: { f: FAT_HEAVY_THRESHOLD + 0.1 } }), true);
  assert.equal(deriveIsFatHeavy({ macros: { f: FAT_HEAVY_THRESHOLD } }), false, 'the threshold is exclusive');
  assert.equal(deriveIsFatHeavy({ macros: { f: 0 } }), false);
  assert.equal(deriveIsFatHeavy({}), false, 'a meal with no macros is not fat-heavy');
});

test('the meals the old hand-typed map got wrong on fat now agree with their macros', () => {
  // Both were called out in the Phase 2 handover: mutton keema carries 34g of
  // fat and was typed `false`; chicken red curry carries 14g and was typed `true`.
  const byName = new Map(allMeals().map((meal) => [meal.canonical_name, meal]));

  const keema = byName.get('Mutton keema + jowar roti');
  assert.equal(keema.is_fat_heavy, true, `${keema.macros.f}g of fat must read as fat-heavy`);

  const redCurry = byName.get('Chicken red curry + rice');
  assert.equal(redCurry.is_fat_heavy, false, `${redCurry.macros.f}g of fat must not read as fat-heavy`);
});

// ─── has_fibre: >= 3g of rolled-up dietary fibre ────────────────────────────

test('has_fibre is rolled-up fibre at or above the fibre-meal threshold', () => {
  assert.equal(deriveHasFibre({ macros: { fibre: FIBRE_MEAL_THRESHOLD } }), true, 'the threshold is inclusive');
  assert.equal(deriveHasFibre({ macros: { fibre: FIBRE_MEAL_THRESHOLD - 0.1 } }), false);
  assert.equal(deriveHasFibre({ macros: { fibre: 0 } }), false);
  assert.equal(deriveHasFibre({}), false, 'a meal with no fibre figure is not a fibre meal');
});

test('has_fibre no longer contradicts the meal it describes', () => {
  const byName = new Map(allMeals().map((meal) => [meal.canonical_name, meal]));

  // Handover example: tagged has_fibre false despite whole-wheat toast — but
  // the toast is one 28g slice, which is 1.9g of fibre for the whole meal.
  // Deriving it settles the argument with a number instead of an adjective.
  const eggs = byName.get('Scrambled eggs + toast');
  assert.equal(eggs.macros.fibre < FIBRE_MEAL_THRESHOLD, true);
  assert.equal(eggs.has_fibre, false);

  // Pho was typed `true` on 2.5g. Under a stated rule it is not a fibre meal.
  const pho = byName.get('Vietnamese chicken pho');
  assert.equal(pho.has_fibre, pho.macros.fibre >= FIBRE_MEAL_THRESHOLD);
});

test('every meal in the catalog agrees with the derivation rules', () => {
  for (const meal of allMeals()) {
    assert.deepEqual(
      {
        is_fat_heavy: meal.is_fat_heavy,
        has_fibre: meal.has_fibre,
        meal_weight: meal.meal_weight
      },
      deriveMealTags(meal),
      `${meal.canonical_name} carries tags that disagree with its own macros`
    );
  }
});

// ─── meal_weight: by calories ───────────────────────────────────────────────

test('meal_weight is a calorie band', () => {
  assert.equal(deriveMealWeight({ cal: HEAVY_MEAL_CALORIES + 1 }), 'Heavy');
  assert.equal(deriveMealWeight({ cal: HEAVY_MEAL_CALORIES }), 'Medium', 'the heavy bound is exclusive');
  assert.equal(deriveMealWeight({ cal: MEDIUM_MEAL_CALORIES }), 'Medium', 'the medium bound is inclusive');
  assert.equal(deriveMealWeight({ cal: MEDIUM_MEAL_CALORIES - 1 }), 'Light');
});

test('meal_weight matches the lowercase rule_metadata class it mirrors', () => {
  for (const meal of allMeals()) {
    assert.equal(
      meal.meal_weight.toLowerCase(),
      meal.rule_metadata.meal_weight_class,
      `${meal.canonical_name} has a display weight that disagrees with its rule metadata`
    );
  }
});
