/**
 * cuisine.source.test.js — a meal's cuisine has one home and one casing.
 *
 * Covers finding #5 of docs/CONSISTENCY_AUDIT.md. Cuisine was declared twice
 * inside mealDatabase.js — inline on 77 base meals (lowercase, using a
 * `western` taxonomy) and again in `handAuthoredTags` (capitalised, using
 * `Continental`) — with the hand-authored map silently winning. 29 of the 77
 * disagreed in value, not merely in casing.
 *
 * The casing split then reached consumers: `meal.cuisine` was "Indian" while
 * `meal.tags.cuisine` was "indian", so `planOptimizer.getMealCuisine`
 * lowercased defensively while App.jsx's quick action compared raw and matched
 * nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mealDatabase, handAuthoredTags } from '../src/data/mealDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allMeals = [...mealDatabase.breakfast, ...mealDatabase.lunchDinner, ...mealDatabase.snack];

test('cuisine is declared once — the base meal list carries no inline cuisine', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/data/mealDatabase.js'), 'utf8');
  const baseList = source.slice(0, source.indexOf('const handAuthoredTags'));

  const inline = baseList.match(/"cuisine"\s*:/g) || [];

  assert.equal(
    inline.length,
    0,
    `${inline.length} meals still declare an inline cuisine that handAuthoredTags overwrites`
  );
});

test('every meal carries a cuisine, in one canonical lowercase form', () => {
  for (const meal of allMeals) {
    assert.ok(meal.cuisine, `${meal.name} has no cuisine`);
    assert.equal(
      meal.cuisine,
      String(meal.cuisine).toLowerCase(),
      `${meal.name} carries a mixed-case cuisine "${meal.cuisine}"`
    );
    // The two fields are the same fact and must not drift apart.
    assert.equal(
      meal.cuisine,
      meal.tags?.cuisine,
      `${meal.name}: meal.cuisine "${meal.cuisine}" != tags.cuisine "${meal.tags?.cuisine}"`
    );
  }
});

test('the hand-authored map itself is canonical, so consumers need no defensive casing', () => {
  for (const [name, tags] of Object.entries(handAuthoredTags)) {
    assert.equal(
      tags.cuisine,
      String(tags.cuisine).toLowerCase(),
      `handAuthoredTags["${name}"] carries a mixed-case cuisine "${tags.cuisine}"`
    );
  }
});

test('a raw lowercase comparison finds the Indian meals', () => {
  // This is exactly what App.jsx's "Indian" quick action does. It matched zero
  // of 42 Indian meals because every value was capitalised.
  const indian = mealDatabase.lunchDinner.filter((meal) => meal.cuisine === 'indian');

  assert.ok(
    indian.length > 0,
    'no lunch/dinner meal matches cuisine === "indian" — the Indian quick action is dead'
  );
});
