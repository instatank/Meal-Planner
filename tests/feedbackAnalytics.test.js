import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOT_OUTCOME,
  describeAttributeKey,
  describeReadiness,
  getMostRejectedDishes,
  resolveSlotOutcomes,
  summarizeAdherence
} from '../src/lib/feedbackAnalytics.js';
import { createMealEvent } from '../src/lib/mealEvents.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const evt = (payload, id, ago = 1) => createMealEvent({ id, timestamp: daysAgo(ago), ...payload });
const opts = { nowMs: NOW };

test('one slot is one data point, however many events touched it', () => {
  // The naive version counts events: a swap then a confirm would be filed as
  // both a deviation and a success, inflating numerator and denominator at
  // once. A lunch is one lunch.
  const events = [
    evt({ type: 'swap', dateKey: '2026-09-10', mealType: 'lunch', fromMealName: 'A', toMealName: 'B' }, 'e1', 3),
    evt({ type: 'confirm', dateKey: '2026-09-10', mealType: 'lunch', mealName: 'B', protein: 40 }, 'e2', 3)
  ];

  const resolved = resolveSlotOutcomes(events, opts);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].outcome, SLOT_OUTCOME.FOLLOWED);
  assert.equal(resolved[0].adjustedFirst, true, 'the swap is recorded, just not as an outcome');

  const summary = summarizeAdherence(events, opts);
  assert.equal(summary.overall.total, 1);
  assert.equal(summary.overall.adherenceRate, 1);
  assert.equal(summary.overall.adjustedFirstRate, 1);
});

test('the last outcome wins, because it is what actually happened', () => {
  const events = [
    evt({ type: 'skip', dateKey: '2026-09-10', mealType: 'dinner', mealName: 'A', protein: 30 }, 'e1', 3),
    evt({ type: 'confirm', dateKey: '2026-09-10', mealType: 'dinner', mealName: 'A', protein: 30 }, 'e2', 2)
  ];
  assert.equal(resolveSlotOutcomes(events, opts)[0].outcome, SLOT_OUTCOME.FOLLOWED);
});

test('adherence splits followed, overridden and skipped per slot', () => {
  const events = [
    evt({ type: 'confirm', dateKey: '2026-09-10', mealType: 'breakfast', mealName: 'Eggs', protein: 30 }, 'a', 3),
    evt({ type: 'confirm', dateKey: '2026-09-11', mealType: 'breakfast', mealName: 'Eggs', protein: 30 }, 'b', 2),
    evt({ type: 'skip', dateKey: '2026-09-10', mealType: 'lunch', mealName: 'Dal', protein: 25 }, 'c', 3),
    evt({ type: 'custom', dateKey: '2026-09-11', mealType: 'lunch', mealName: 'Sushi', previousMealName: 'Dal', customMealText: 'sushi', protein: 35 }, 'd', 2)
  ];

  const s = summarizeAdherence(events, opts);
  assert.equal(s.overall.total, 4);
  assert.equal(s.overall.adherenceRate, 0.5);
  assert.equal(s.byMealType.breakfast.adherenceRate, 1);
  assert.equal(s.byMealType.lunch.adherenceRate, 0);
  assert.equal(s.byMealType.lunch.skipRate, 0.5);
  assert.equal(s.byMealType.lunch.overrideRate, 0.5);
});

test('protein from a skipped meal is not counted as delivered', () => {
  // Otherwise a week of skipped lunches reads as a week that hit its target.
  const events = [
    evt({ type: 'confirm', dateKey: '2026-09-10', mealType: 'lunch', mealName: 'A', protein: 40 }, 'a', 2),
    evt({ type: 'skip', dateKey: '2026-09-11', mealType: 'lunch', mealName: 'B', protein: 35 }, 'b', 1)
  ];
  const s = summarizeAdherence(events, opts);
  assert.equal(s.proteinDelivered, 40);
  assert.equal(s.proteinLostToSkips, 35);
});

test('week-scoped and day-scoped events never enter slot adherence', () => {
  const events = [
    evt({ type: 'plan_review', weekStartKey: '2026-09-07', verdict: 'accepted', rating: 4, mealType: 'week', dateKey: '2026-09-07' }, 'r', 2),
    evt({ type: 'undo', dateKey: '2026-09-07', mealType: 'day', undoTargets: ['zzz'] }, 'u', 1)
  ];
  assert.equal(summarizeAdherence(events, opts).overall.total, 0);
});

test('events outside the lookback window are excluded', () => {
  const events = [evt({ type: 'confirm', dateKey: 'old', mealType: 'lunch', mealName: 'A' }, 'a', 200)];
  assert.equal(summarizeAdherence(events, { ...opts, lookbackDays: 90 }).overall.total, 0);
  assert.equal(summarizeAdherence(events, { ...opts, lookbackDays: 365 }).overall.total, 1);
});

test('undone events are excluded from adherence', () => {
  const events = [
    evt({ type: 'skip', dateKey: '2026-09-10', mealType: 'lunch', mealName: 'A' }, 'a', 3),
    evt({ type: 'undo', dateKey: '2026-09-10', undoTargets: ['a'] }, 'u', 2)
  ];
  assert.equal(summarizeAdherence(events, opts).overall.total, 0);
});

test('most-rejected dishes rank by count, with the rate shown beside it', () => {
  // A dish rejected 2/2 has a perfect rejection rate and says almost nothing;
  // one rejected 3 times out of 4 is a real signal. Ordering follows evidence.
  const events = [
    ...[3, 4, 5].map((ago, i) => evt({ type: 'swap', dateKey: `d${i}`, mealType: 'lunch', fromMealName: 'Dal' }, `s${i}`, ago)),
    evt({ type: 'confirm', dateKey: 'd9', mealType: 'lunch', mealName: 'Dal' }, 'c1', 2),
    ...[6, 7].map((ago, i) => evt({ type: 'skip', dateKey: `x${i}`, mealType: 'dinner', mealName: 'Tofu' }, `k${i}`, ago))
  ];

  const ranked = getMostRejectedDishes(events, opts);
  assert.equal(ranked[0].name, 'Dal');
  assert.equal(ranked[0].rejected, 3);
  assert.equal(ranked[0].followed, 1);
  assert.equal(ranked[0].rejectionRate, 0.75);
  assert.equal(ranked[1].name, 'Tofu');
  assert.equal(ranked[1].rejectionRate, 1);
});

test('a dish only ever eaten never appears in the rejected list', () => {
  const events = [evt({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: 'Eggs' }, 'c', 1)];
  assert.deepEqual(getMostRejectedDishes(events, opts), []);
});

test('attribute keys read as English, not as identifiers', () => {
  assert.equal(describeAttributeKey('primary:chicken_breast'), 'Main ingredient: chicken breast');
  assert.equal(describeAttributeKey('carb:flatbread_pasta'), 'Carb base: flatbread or pasta');
  assert.equal(describeAttributeKey('carb:none'), 'Carb base: no starch');
  assert.equal(describeAttributeKey('cuisine:indian'), 'Cuisine: indian');
});

test('readiness distinguishes "nothing yet" from "watching but not acting"', () => {
  // The distinction that matters to someone deciding whether to trust this:
  // an empty system and one that has seen plenty but is holding fire are very
  // different states, and both leave plans unchanged.
  assert.equal(describeReadiness({}, {}).level, 'empty');

  const watching = { attributes: { 'cuisine:indian': { applied: false } }, totals: { observations: 4 } };
  assert.equal(describeReadiness(watching, {}).level, 'watching');
  assert.match(describeReadiness(watching, {}).detail, /plans are unchanged/);

  const learning = { attributes: { 'cuisine:indian': { applied: true } }, totals: { observations: 12 } };
  assert.equal(describeReadiness(learning, { total: 1 }).level, 'learning');

  const established = {
    attributes: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, { applied: true }])),
    totals: { observations: 60 }
  };
  assert.equal(describeReadiness(established, { total: 4 }).level, 'established');
});
