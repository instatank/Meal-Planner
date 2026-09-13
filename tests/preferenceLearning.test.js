import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import {
  MIN_EVIDENCE_TO_APPLY,
  PRIOR_STRENGTH,
  RECENCY_HALF_LIFE_DAYS,
  buildAttributeIndex,
  extractMealAttributes,
  getAppliedSignals,
  getUnderexploredAttributes,
  hasLearnedSignal,
  learnPreferences,
  toLearnedPreferences
} from '../src/lib/preferenceLearning.js';
import { buildPlanReviewPayload } from '../src/lib/planReview.js';
import { createMealEvent } from '../src/lib/mealEvents.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const PANEER_DISHES = [
  'Paneer paratha + curd',
  'Paneer sabzi + dal + raita',
  'Paneer tikka + jowar roti + salad'
];

const learn = (events) => learnPreferences({ events, mealDatabase, nowMs: NOW });

const evt = (payload, id, ago = 1) =>
  createMealEvent({ id, timestamp: daysAgo(ago), ...payload });

// ─── The guardrail that matters most ────────────────────────────────────────

test('no events means no learned preference at all', () => {
  const learned = learn([]);
  assert.deepEqual(learned.dishes, {});
  assert.deepEqual(learned.attributes, {});
  assert.deepEqual(learned.structure, {});
  assert.deepEqual(learned.macros, {});
  assert.equal(learned.totals.observations, 0);

  const applied = toLearnedPreferences(learned);
  assert.deepEqual(applied, { dishes: {}, attributes: {} });
  assert.equal(hasLearnedSignal(applied), false);
});

test('evidence below the floor is reported but withheld from the optimizer', () => {
  // One confirm is a fact, not a pattern. It should be visible and inert.
  const learned = learn([evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c1')]);

  const dish = learned.dishes[PANEER_DISHES[0]];
  assert.ok(dish, 'the observation should still be recorded');
  assert.ok(dish.score > 0);
  assert.equal(dish.applied, false, `evidence ${dish.evidence} should be under the floor of ${MIN_EVIDENCE_TO_APPLY}`);

  assert.deepEqual(toLearnedPreferences(learned).dishes, {});
});

// ─── Every event type now moves something ───────────────────────────────────

test('a skip is a negative signal — it was silent before this existed', () => {
  const events = [1, 8, 15, 22].map((ago, i) =>
    evt({ type: 'skip', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, `s${i}`, ago)
  );
  const learned = learn(events);
  assert.ok(learned.dishes[PANEER_DISHES[0]].score < 0);
});

test('a swap blames the meal left behind, never the one landed on', () => {
  // handleSwap advances through an ordered list, so the meal arrived at was
  // not chosen — it was next. Crediting it would teach the planner that
  // whatever sorts after a disliked dish is liked.
  const learned = learn([
    evt({ type: 'swap', dateKey: 'd', mealType: 'lunch', fromMealName: PANEER_DISHES[0], toMealName: PANEER_DISHES[1] }, 'w1')
  ]);
  assert.ok(learned.dishes[PANEER_DISHES[0]].score < 0);
  assert.equal(learned.dishes[PANEER_DISHES[1]], undefined);
});

test('an edit blames the replaced meal and credits the named replacement', () => {
  const learned = learn([
    evt({ type: 'edit', dateKey: 'd', mealType: 'dinner', originalMealName: PANEER_DISHES[0], updatedMealName: PANEER_DISHES[1] }, 'e1')
  ]);
  assert.ok(learned.dishes[PANEER_DISHES[0]].score < 0);
  assert.ok(learned.dishes[PANEER_DISHES[1]].score > 0);
});

test('a custom log credits what was eaten and blames what it displaced', () => {
  const learned = learn([
    evt({ type: 'custom', dateKey: 'd', mealType: 'dinner', mealName: PANEER_DISHES[1], previousMealName: PANEER_DISHES[0], customMealText: 'paneer sabzi' }, 'x1')
  ]);
  assert.ok(learned.dishes[PANEER_DISHES[1]].score > 0);
  assert.ok(learned.dishes[PANEER_DISHES[0]].score < 0);
});

test('a custom log with an empty slot blames nothing', () => {
  const learned = learn([
    evt({ type: 'custom', dateKey: 'd', mealType: 'dinner', mealName: PANEER_DISHES[1], previousMealName: '', customMealText: 'x' }, 'x1')
  ]);
  assert.equal(Object.keys(learned.dishes).length, 1);
});

test('undone events contribute nothing', () => {
  const events = [
    evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c1', 5),
    evt({ type: 'undo', dateKey: 'd', undoTargets: ['c1'] }, 'u1', 4)
  ];
  assert.deepEqual(learn(events).dishes, {});
});

// ─── The reason attributes exist ────────────────────────────────────────────

test('three different paneer dishes become one clear paneer signal', () => {
  // This is the whole argument for attribute-level learning. Each dish is
  // seen once and stays below the evidence floor forever; the attribute they
  // share crosses it and generalises to every paneer dish in the catalog,
  // including ones never served.
  const events = PANEER_DISHES.map((name, i) =>
    evt({ type: 'swap', dateKey: `d${i}`, mealType: 'lunch', fromMealName: name, toMealName: 'X' }, `w${i}`, i * 3 + 1)
  );
  const learned = learn(events);

  for (const name of PANEER_DISHES) {
    assert.equal(learned.dishes[name].applied, false, `${name} alone is still too thin`);
  }

  const paneer = learned.attributes['primary:paneer'];
  assert.ok(paneer, 'no paneer attribute bucket');
  assert.equal(paneer.applied, true, `paneer evidence ${paneer.evidence} should clear the floor`);
  assert.ok(paneer.score < 0);
  assert.equal(paneer.exposure, 3);

  const applied = toLearnedPreferences(learned);
  assert.ok(applied.attributes['primary:paneer'] < 0);
  assert.deepEqual(applied.dishes, {}, 'no single dish earned its way through');
});

test('a broad attribute is damped so it cannot steer on coverage alone', () => {
  // Measured on the real catalog: `fibre:yes` covers 91 of 110 meals, so it
  // distinguishes almost no two plans. It must not rank alongside a signal
  // that actually narrows the catalog down.
  const index = buildAttributeIndex(mealDatabase);
  assert.ok(index.coverageOf('fibre:yes') > 0.8);
  assert.ok(index.specificityOf('fibre:yes') < 0.1, 'a near-universal key should barely steer');
  assert.ok(index.specificityOf('primary:paneer') > index.specificityOf('cuisine:indian'));

  const events = PANEER_DISHES.map((name, i) =>
    evt({ type: 'swap', dateKey: `d${i}`, mealType: 'lunch', fromMealName: name }, `w${i}`, i + 1)
  );
  const learned = learn(events);

  const fibre = learned.attributes['fibre:yes'];
  const paneer = learned.attributes['primary:paneer'];
  assert.equal(Math.sign(fibre.score), Math.sign(paneer.score), 'both buckets saw the same events');
  assert.ok(
    Math.abs(fibre.effect) < Math.abs(paneer.effect) / 5,
    `broad key effect ${fibre.effect} should be far below ${paneer.effect}`
  );

  const top = getAppliedSignals(learned, { limit: 3 }).map((s) => s.key);
  assert.ok(!top.includes('fibre:yes'), 'a near-universal key must not top the list');
});

// ─── Shrinkage and recency ──────────────────────────────────────────────────

test('scores are shrunk toward zero and never leave (-1, 1)', () => {
  const one = learn([evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c0', 0)]);
  const many = learn(
    Array.from({ length: 40 }, (_, i) =>
      evt({ type: 'confirm', dateKey: `d${i}`, mealType: 'lunch', mealName: PANEER_DISHES[0] }, `c${i}`, 0)
    )
  );

  const oneScore = one.dishes[PANEER_DISHES[0]].score;
  const manyScore = many.dishes[PANEER_DISHES[0]].score;

  assert.ok(oneScore > 0 && oneScore < 0.2, `one event should be tentative, got ${oneScore}`);
  assert.ok(manyScore > oneScore);
  assert.ok(manyScore < 1, 'shrinkage must keep the score inside the open interval');
  assert.equal(one.dishes[PANEER_DISHES[0]].rawMean, 1, 'the raw mean is still reported honestly');
  assert.ok(PRIOR_STRENGTH > 0);
});

test('older evidence counts for less, by a half-life rather than a cutoff', () => {
  const fresh = learn([evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c1', 0)]);
  const stale = learn([
    evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c1', RECENCY_HALF_LIFE_DAYS)
  ]);

  assert.ok(stale.dishes[PANEER_DISHES[0]].evidence < fresh.dishes[PANEER_DISHES[0]].evidence);
  assert.ok(
    Math.abs(stale.dishes[PANEER_DISHES[0]].evidence - 0.5) < 0.01,
    'one half-life should halve the weight'
  );
  assert.ok(stale.dishes[PANEER_DISHES[0]].score > 0, 'old evidence fades, it does not vanish');
});

// ─── Plan-level review ──────────────────────────────────────────────────────

const review = (overrides, id, ago = 1) =>
  evt({ ...buildPlanReviewPayload({ weekStartKey: 'w', dishes: PANEER_DISHES, ...overrides }) }, id, ago);

test('a neutral rating moves nothing', () => {
  const learned = learn([review({ verdict: 'accepted', rating: 3 }, 'r1')]);
  assert.deepEqual(learned.dishes, {}, 'a 3 is the zero point and must be inert');
});

test('a high rating lifts the week, a low one drags it', () => {
  const good = learn([review({ verdict: 'accepted', rating: 5 }, 'r1')]);
  const bad = learn([review({ verdict: 'rejected', rating: 1 }, 'r1')]);
  assert.ok(good.dishes[PANEER_DISHES[0]].score > 0);
  assert.ok(bad.dishes[PANEER_DISHES[0]].score < 0);
});

test('a dish named as disliked outweighs the week rating that surrounds it', () => {
  // The user pointed at it. That must beat anything inferred from the week.
  const learned = learn([
    review({ verdict: 'accepted', rating: 5, reasonIds: ['disliked_dishes'], dislikedDishes: [PANEER_DISHES[0]] }, 'r1')
  ]);
  assert.ok(learned.dishes[PANEER_DISHES[0]].score < 0, 'the named dish should go negative');
  assert.ok(learned.dishes[PANEER_DISHES[1]].score > 0, 'the rest of the week still rides the rating');
});

test('a structured reason lands in the same bucket as the matching behaviour', () => {
  // "too much roti" and three roti lunches swapped away are evidence about
  // one thing. Sharing a key is what makes them add up.
  const stated = learn([review({ verdict: 'rejected', rating: 2, reasonIds: ['too_much_flatbread'] }, 'r1')]);
  assert.ok(stated.attributes['carb:flatbread_pasta'].score < 0);

  const both = learn([
    review({ verdict: 'rejected', rating: 2, reasonIds: ['too_much_flatbread'] }, 'r1', 2),
    evt({ type: 'swap', dateKey: 'd', mealType: 'lunch', fromMealName: PANEER_DISHES[0] }, 'w1', 1)
  ]);
  assert.ok(
    both.attributes['carb:flatbread_pasta'].evidence > stated.attributes['carb:flatbread_pasta'].evidence,
    'a complaint and a behaviour about the same attribute should accumulate together'
  );
});

test('structural and macro reasons are kept apart from attribute preference', () => {
  const learned = learn([
    review({ verdict: 'rejected', rating: 2, reasonIds: ['too_repetitive', 'protein_too_low'] }, 'r1')
  ]);
  assert.ok(learned.structure.variety.score > 0, 'asking for more variety is a positive on variety');
  assert.ok(learned.macros.protein.score > 0, 'asking for more protein is a positive on protein');
  assert.equal(learned.attributes.variety, undefined);
});

// ─── Honesty about the blind spot ───────────────────────────────────────────

test('under-explored attributes are named rather than silently assumed neutral', () => {
  const learned = learn([evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: PANEER_DISHES[0] }, 'c1')]);
  const gaps = getUnderexploredAttributes({ learned, mealDatabase, minExposure: 3, limit: 5 });

  assert.ok(gaps.length > 0);
  for (const gap of gaps) {
    assert.ok(gap.exposure < 3);
    assert.ok(gap.mealCount > 0, 'a gap should name how much catalog sits behind it');
  }
  // Ranked by how much of the catalog the gap hides, not alphabetically.
  assert.ok(gaps[0].mealCount >= gaps[gaps.length - 1].mealCount);
});

test('attribute extraction covers every dimension for a real catalog meal', () => {
  const keys = extractMealAttributes({
    name: 'Paneer paratha + curd',
    cuisine: 'indian',
    primary_ingredient: 'paneer',
    cal: 520,
    macros: { p: 25, c: 60, f: 26, fibre: 6 },
    parts: [{ ingredientId: 'aloo_paratha' }]
  });
  const dimensions = new Set(keys.map((k) => k.split(':')[0]));
  assert.deepEqual(
    [...dimensions].sort(),
    ['carb', 'carbLevel', 'cuisine', 'effort', 'family', 'fatHeavy', 'fibre', 'format', 'primary', 'weight']
  );
});
