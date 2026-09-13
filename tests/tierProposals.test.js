import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_OUTCOMES_FOR_PROPOSAL,
  MIN_SPAN_DAYS_FOR_PROPOSAL,
  proposeMealTiers,
  summarizeDishBehaviour
} from '../src/lib/tierProposals.js';
import { normalizeMealTierMap } from '../src/lib/mealTiers.js';
import { createMealEvent } from '../src/lib/mealEvents.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const ago = (n) => new Date(NOW - n * 86400000).toISOString();
const opts = { nowMs: NOW };

let seq = 0;
const eaten = (name, daysAgo) =>
  createMealEvent({ id: `c${seq++}`, type: 'confirm', dateKey: `d${daysAgo}`, mealType: 'dinner', mealName: name, timestamp: ago(daysAgo) });
const turnedDown = (name, daysAgo) =>
  createMealEvent({ id: `s${seq++}`, type: 'swap', dateKey: `x${daysAgo}`, mealType: 'lunch', fromMealName: name, timestamp: ago(daysAgo) });

/** Spread `count` events across the window so the span is realistic. */
const spread = (make, name, count, from, step) =>
  Array.from({ length: count }, (_, i) => make(name, from - i * step));

test('no proposals at all until there is enough history', () => {
  // Cadence over a few days is an accident of which week recording started.
  const events = spread(eaten, 'A', 6, 5, 1);
  const result = proposeMealTiers({ events, tierMap: {}, ...opts });

  assert.equal(result.ready, false);
  assert.deepEqual(result.proposals, []);
  assert.match(result.reason, /days of history/);
  assert.ok(result.spanDays < MIN_SPAN_DAYS_FOR_PROPOSAL);
});

test('a dish eaten several times a week is proposed as a staple', () => {
  const events = [...spread(eaten, 'Chicken curry', 18, 42, 2), ...spread(eaten, 'Other', 2, 40, 10)];
  const result = proposeMealTiers({ events, tierMap: {}, ...opts });

  const proposal = result.proposals.find((p) => p.mealName === 'Chicken curry');
  assert.ok(proposal, 'expected a proposal');
  assert.equal(proposal.proposedTier, 'staple');
  assert.equal(proposal.direction, 'promote');
  assert.ok(proposal.cadencePerWeek >= 2);
  assert.match(proposal.why, /a week/);
});

test('a dish repeatedly turned down is proposed for retirement', () => {
  const events = [...spread(turnedDown, 'Tofu bowl', 5, 40, 6), eaten('Tofu bowl', 20), ...spread(eaten, 'Other', 4, 38, 8)];
  const result = proposeMealTiers({ events, tierMap: {}, ...opts });

  const proposal = result.proposals.find((p) => p.mealName === 'Tofu bowl');
  assert.equal(proposal.proposedTier, 'retired');
  assert.equal(proposal.direction, 'retire');
  assert.equal(proposal.rejected, 5);
  assert.ok(proposal.rejectionRate >= 0.6);
});

test('retirement needs a pattern, not two bad days', () => {
  // Retirement is the most destructive edit available here — it removes the
  // dish from planning entirely — so the bar is deliberately high.
  const events = [...spread(turnedDown, 'Tofu bowl', 2, 30, 5), ...spread(eaten, 'Other', 6, 40, 6)];
  const result = proposeMealTiers({ events, tierMap: {}, ...opts });
  assert.equal(result.proposals.find((p) => p.mealName === 'Tofu bowl'), undefined);
});

test('a dish with too few outcomes gets no proposal', () => {
  const events = [...spread(eaten, 'Thin', MIN_OUTCOMES_FOR_PROPOSAL - 1, 30, 7), ...spread(eaten, 'Other', 6, 40, 6)];
  const result = proposeMealTiers({ events, tierMap: {}, ...opts });
  assert.equal(result.proposals.find((p) => p.mealName === 'Thin'), undefined);
});

test('a proposal that agrees with the current tier is not news', () => {
  const events = [...spread(eaten, 'Chicken curry', 18, 42, 2), ...spread(eaten, 'Other', 2, 40, 10)];
  const tierMap = normalizeMealTierMap({ 'Chicken curry': { tier: 'staple' } });

  const result = proposeMealTiers({ events, tierMap, ...opts });
  assert.equal(result.proposals.find((p) => p.mealName === 'Chicken curry'), undefined);
});

test('a tier you set by hand this week is not immediately argued with', () => {
  // Being contradicted the same week you made a decision is how a system
  // teaches you to ignore it.
  const events = [...spread(eaten, 'Chicken curry', 18, 42, 2), ...spread(eaten, 'Other', 2, 40, 10)];
  const justSet = normalizeMealTierMap({
    'Chicken curry': { tier: 'rare', updatedAt: ago(2) }
  });
  assert.equal(
    proposeMealTiers({ events, tierMap: justSet, ...opts }).proposals.find((p) => p.mealName === 'Chicken curry'),
    undefined
  );

  // But an old decision that behaviour has since contradicted is fair game.
  const setLongAgo = normalizeMealTierMap({
    'Chicken curry': { tier: 'rare', updatedAt: ago(90) }
  });
  assert.ok(
    proposeMealTiers({ events, tierMap: setLongAgo, ...opts }).proposals.find((p) => p.mealName === 'Chicken curry')
  );
});

test('cadence is per week observed, not per appearance', () => {
  // One meal eaten once eight weeks ago is not a weekly habit. Without this
  // denominator every dish looks like a staple the day it is first eaten.
  const events = [eaten('Once', 50), ...spread(eaten, 'Other', 6, 55, 8)];
  const behaviour = summarizeDishBehaviour(events, opts);
  const once = behaviour.dishes.find((d) => d.name === 'Once');
  assert.ok(once.cadencePerWeek < 0.5, `got ${once.cadencePerWeek}`);
  assert.ok(behaviour.observedWeeks > 5);
});

test('a rejection counts for the dish left behind, not the slot that replaced it', () => {
  // A swap resolves the slot to whatever was eaten instead. The rejection
  // still belongs to the dish turned down, which is why rejections are read
  // from events rather than from resolved slot outcomes.
  const events = [
    createMealEvent({ id: 'w1', type: 'swap', dateKey: 'd1', mealType: 'lunch', fromMealName: 'Dal', toMealName: 'Chicken', timestamp: ago(30) }),
    createMealEvent({ id: 'k1', type: 'confirm', dateKey: 'd1', mealType: 'lunch', mealName: 'Chicken', timestamp: ago(30) }),
    ...spread(eaten, 'Other', 6, 40, 5)
  ];

  const behaviour = summarizeDishBehaviour(events, opts);
  const dal = behaviour.dishes.find((d) => d.name === 'Dal');
  const chicken = behaviour.dishes.find((d) => d.name === 'Chicken');

  assert.equal(dal.rejected, 1);
  assert.equal(dal.eaten, 0);
  assert.equal(chicken.eaten, 1);
  assert.equal(chicken.rejected, 0);
});

test('proposals are limited to meals still in the catalog when names are given', () => {
  const events = [...spread(eaten, 'Deleted dish', 18, 42, 2), ...spread(eaten, 'Other', 2, 40, 10)];
  const result = proposeMealTiers({ events, tierMap: {}, mealNames: ['Other'], ...opts });
  assert.equal(result.proposals.find((p) => p.mealName === 'Deleted dish'), undefined);
});

test('nothing here writes a tier — proposals are returned, never applied', () => {
  const tierMap = normalizeMealTierMap({});
  const events = [...spread(eaten, 'Chicken curry', 18, 42, 2), ...spread(eaten, 'Other', 2, 40, 10)];
  proposeMealTiers({ events, tierMap, ...opts });
  assert.deepEqual(tierMap, {}, 'the tier map must be untouched');
});
