import test from 'node:test';
import assert from 'node:assert/strict';

import { handAuthoredTags, mealDatabase } from '../src/data/mealDatabase.js';
import { CARB_BASE_BY_INGREDIENT, deriveCarbType } from '../src/lib/mealDataLayer.js';

const CARB_TYPES = ['flatbread_pasta', 'rice', 'none'];

// ─── The field is data, derived once, not inferred at runtime ───────────────

test('every lunch/dinner meal carries a carb_type from the allowed set', () => {
  for (const meal of mealDatabase.lunchDinner) {
    assert.ok(
      CARB_TYPES.includes(meal.carb_type),
      `"${meal.canonical_name}" has carb_type ${JSON.stringify(meal.carb_type)}; `
      + `expected one of ${CARB_TYPES.join(' | ')}.`
    );
  }
});

test('carb_type is not hand-typed anywhere', () => {
  for (const [name, tags] of Object.entries(handAuthoredTags)) {
    assert.ok(
      !('carb_type' in tags),
      `"${name}" hand-types carb_type. It is derived from parts[] in deriveCarbType — `
      + 'typing it beside the derivation is exactly how cuisine drifted onto 29 meals.'
    );
  }
});

test('breakfast and snack carry no carb_type — R4 exempts breakfast', () => {
  for (const meal of [...mealDatabase.breakfast, ...mealDatabase.snack]) {
    assert.ok(
      !('carb_type' in meal),
      `"${meal.canonical_name}" carries a carb_type but nothing reads it.`
    );
  }
});

// ─── The derivation itself ──────────────────────────────────────────────────

test('a meal with no carb base is none', () => {
  assert.equal(deriveCarbType({ parts: [{ ingredientId: 'chicken_breast', qty: 150, unit: 'g' }] }), 'none');
  assert.equal(deriveCarbType({ parts: [] }), 'none');
  assert.equal(deriveCarbType({}), 'none');
});

test('flatbreads, breads, pasta and noodles are all flatbread_pasta', () => {
  for (const id of ['jowar_roti', 'whole_wheat_toast', 'aloo_paratha', 'chickpea_pasta', 'spaghetti_aglio_olio', 'egg_noodles', 'soba_noodles']) {
    assert.equal(deriveCarbType({ parts: [{ ingredientId: id, qty: 100, unit: 'g' }] }), 'flatbread_pasta', id);
  }
});

test('rice noodles are classified by form, not by flour', () => {
  // A bowl of pho is a noodle meal. Grouping it with steamed rice would let a
  // roti lunch and a pho dinner pass R4, which is the exact pairing R4 exists
  // to catch.
  assert.equal(deriveCarbType({ parts: [{ ingredientId: 'rice_noodles', qty: 120, unit: 'g' }] }), 'flatbread_pasta');
});

test('rice and rice-style grain bases are rice', () => {
  for (const id of ['cooked_rice', 'garlic_rice', 'quinoa_cooked', 'poha']) {
    assert.equal(deriveCarbType({ parts: [{ ingredientId: id, qty: 100, unit: 'g' }] }), 'rice', id);
  }
});

test('flatbread_pasta wins when a meal carries both forms', () => {
  const both = {
    parts: [
      { ingredientId: 'cooked_rice', qty: 100, unit: 'g' },
      { ingredientId: 'jowar_roti', qty: 2, unit: 'piece' }
    ]
  };
  assert.equal(deriveCarbType(both), 'flatbread_pasta');
  // Order in parts[] must not change the answer.
  assert.equal(deriveCarbType({ parts: [...both.parts].reverse() }), 'flatbread_pasta');
});

test('a coating or a binder is not a carb base', () => {
  // 'Paneer cutlets + dal + salad' carries 15g of panko and 15g of besan and
  // is not a bread meal. A name-based or any-bready-ingredient rule gets this
  // wrong; the base table is what keeps it right.
  const cutlets = mealDatabase.lunchDinner.find((m) => m.canonical_name === 'Paneer cutlets + dal + salad');
  assert.ok(cutlets, 'fixture meal missing from catalog');
  assert.equal(cutlets.carb_type, 'none');
  assert.ok(!('breadcrumbs_panko' in CARB_BASE_BY_INGREDIENT));
  assert.ok(!('besan' in CARB_BASE_BY_INGREDIENT));
});

test('the carb-base table only ever maps to a real carb type', () => {
  for (const [id, form] of Object.entries(CARB_BASE_BY_INGREDIENT)) {
    assert.ok(['flatbread_pasta', 'rice'].includes(form), `${id} maps to ${form}`);
  }
});

test('deriveCarbType reads parts, never the dish name', () => {
  // Same parts, wildly misleading name: the name must not move the answer.
  const parts = [{ ingredientId: 'cooked_rice', qty: 150, unit: 'g' }];
  assert.equal(deriveCarbType({ name: 'Roti and pasta feast', parts }), 'rice');
  assert.equal(deriveCarbType({ name: 'Plain grilled chicken', parts }), 'rice');
});
