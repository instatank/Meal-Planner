import test from 'node:test';
import assert from 'node:assert/strict';

import { MEAL_TEMPLATES, expandMealTemplates } from '../src/data/mealTemplates.js';
import { mealDatabase } from '../src/data/mealDatabase.js';
import { ingredients } from '../src/data/ingredients.js';
import { getRules } from '../src/lib/rules.js';
import { isMealAdmissible } from '../src/lib/planOptimizer.js';
import { normalizePreferences } from '../src/lib/plannerGenerator.js';
import { computeMacros, derivePrimaryIngredient } from '../src/lib/mealDataLayer.js';

const generated = mealDatabase.lunchDinner.filter((meal) => meal.from_template);

test('templates expand into concrete meals in the catalog', () => {
  assert.ok(generated.length > 0, 'no generated meals reached the catalog');
  const expected = MEAL_TEMPLATES.reduce((sum, t) => sum + t.proteins.length, 0);
  assert.equal(generated.length, expected);
});

test('every ingredient a template names actually exists', () => {
  // A missing ingredient does not throw — `computeMacros` rolls it up as zero,
  // which would put a 0g-protein meal into a catalog the optimizer trusts.
  for (const template of MEAL_TEMPLATES) {
    for (const part of template.base) {
      assert.ok(ingredients[part.ingredientId], `base ingredient missing: ${part.ingredientId}`);
    }
    for (const protein of template.proteins) {
      assert.ok(ingredients[protein.ingredientId], `protein missing: ${protein.ingredientId}`);
    }
  }
});

test('generated macros are computed from parts, never declared', () => {
  // The whole reason expansion carries `parts[]` rather than numbers: a
  // generated meal's nutrition must come down the same path as a hand-authored
  // one, from the same source table, so the two cannot drift.
  for (const meal of generated) {
    const recomputed = computeMacros(meal.parts);
    assert.equal(meal.protein, recomputed.protein, `${meal.name} protein drifted`);
    assert.equal(meal.cal, recomputed.cal, `${meal.name} calories drifted`);
  }
  for (const template of MEAL_TEMPLATES) {
    assert.equal(template.macros, undefined, 'a template must not declare macros');
    assert.equal(template.protein, undefined);
  }
});

test('generated meals clear the hard per-meal protein floor', () => {
  // Otherwise they are dead weight: enumerated, scored, and excluded.
  const rules = getRules('high_protein');
  const preferences = normalizePreferences({});
  for (const meal of generated) {
    assert.ok(
      isMealAdmissible(meal, { rules, preferences }),
      `${meal.name} (${meal.protein}g) is inadmissible`
    );
  }
});

test('the anchor ingredient is the protein, so variants do not share a cap', () => {
  // Six salad bowls that all counted as one anchor family would spend the same
  // weekly budget and defeat the point of generating them.
  const anchors = generated.map((meal) => derivePrimaryIngredient(meal));
  for (const meal of generated) {
    const proteinPart = meal.parts[0].ingredientId;
    assert.equal(derivePrimaryIngredient(meal), proteinPart, `${meal.name} anchored on the wrong part`);
  }
  assert.ok(new Set(anchors).size > 1, 'generated meals should not all share one anchor');
});

test('a hand-authored dish always wins a name collision', () => {
  // Silently shadowing a deliberately-authored dish with a generated
  // approximation is the kind of substitution nobody notices until the macros
  // look wrong.
  const clash = MEAL_TEMPLATES[0].nameTemplate.replace('{protein}', MEAL_TEMPLATES[0].proteins[0].label);
  const out = expandMealTemplates({
    existingNames: [clash],
    isAvailable: (id) => Boolean(ingredients[id])
  });
  assert.ok(!out.some((meal) => meal.name === clash));
  assert.equal(out.length, MEAL_TEMPLATES.reduce((s, t) => s + t.proteins.length, 0) - 1);
});

test('an option whose ingredient is unavailable is dropped, not emitted empty', () => {
  const out = expandMealTemplates({ isAvailable: (id) => id !== 'chicken_breast' });
  assert.ok(!out.some((meal) => meal.parts.some((p) => p.ingredientId === 'chicken_breast')));
  assert.ok(out.length > 0, 'the other options should still expand');
});

test('a template whose base is unavailable emits nothing from that template', () => {
  const out = expandMealTemplates({ isAvailable: (id) => id !== 'mixed_salad' });
  assert.ok(!out.some((meal) => meal.from_template === 'salad_bowl'));
});

test('generated meals declare themselves modular; everything else stays fixed', () => {
  for (const meal of generated) assert.equal(meal.pairing, 'modular');
  const handAuthored = mealDatabase.lunchDinner.filter((m) => !m.from_template);
  for (const meal of handAuthored) {
    assert.notEqual(meal.pairing, 'modular', `${meal.name} should not be modular`);
  }
});

test('generated names are unique and human-readable', () => {
  const names = generated.map((m) => m.name);
  assert.equal(new Set(names).size, names.length, 'duplicate generated name');
  for (const name of names) {
    assert.ok(!name.includes('{'), `unsubstituted placeholder in "${name}"`);
    assert.ok(name.length > 8 && name.length < 60, `awkward name: "${name}"`);
  }
});

test('expansion is deterministic — the catalog must not shuffle between loads', () => {
  const a = expandMealTemplates({ isAvailable: (id) => Boolean(ingredients[id]) }).map((m) => m.meal_id);
  const b = expandMealTemplates({ isAvailable: (id) => Boolean(ingredients[id]) }).map((m) => m.meal_id);
  assert.deepEqual(a, b);
});
