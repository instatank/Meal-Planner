import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIER,
  TIER,
  TIER_DERIVATION,
  acceptanceRate,
  buildMealStats,
  deriveTier,
  isInCooldown,
  maxPerWeek,
  normalizeTierOverrides,
  resolveMealTiers,
  tierScoreBonus,
  totalConfirms
} from '../src/lib/mealTiers.js';

const NOW = Date.parse('2026-09-06T00:00:00Z');

/** `count` confirm events for `name`, spread over consecutive August days. */
const confirms = (name, count, startDay = 1) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'confirm',
    mealName: name,
    timestamp: `2026-08-${String(startDay + i).padStart(2, '0')}T12:00:00.000Z`
  }));

/** A served map placing `name` at `slot` on `count` consecutive August days. */
const served = (name, count, slot = 'lunch', startDay = 1) => {
  const map = {};
  for (let i = 0; i < count; i += 1) {
    map[`2026-08-${String(startDay + i).padStart(2, '0')}`] = { [slot]: name };
  }
  return map;
};

test('a meal eaten every time it is served earns the staple tier', () => {
  const stats = buildMealStats({ events: confirms('Fav', 6), servedMap: served('Fav', 6), nowMs: NOW });
  const stat = stats.get('fav');

  assert.equal(stat.eaten, 6);
  assert.equal(stat.served, 6);
  assert.equal(acceptanceRate(stat), 1);
  assert.equal(deriveTier(stat), TIER.STAPLE);
  assert.equal(maxPerWeek('Fav', { Fav: TIER.STAPLE }), 3);
  assert.ok(tierScoreBonus('Fav', { Fav: TIER.STAPLE }) > 0);
});

test('three confirms at a decent acceptance rate earns regular, not staple', () => {
  const stats = buildMealStats({ events: confirms('Ok', 3), servedMap: served('Ok', 5), nowMs: NOW });
  assert.equal(deriveTier(stats.get('ok')), TIER.REGULAR);
  assert.equal(maxPerWeek('Ok', { Ok: TIER.REGULAR }), 2);
});

test('a meal served repeatedly and never eaten is demoted to rare', () => {
  // Enough confirms elsewhere that the demotion guard is satisfied.
  const events = [...confirms('Other', 5, 10)];
  const servedMap = { ...served('Ignored', 4), ...served('Other', 5, 'lunch', 10) };
  const { tiers, demotionEnabled } = resolveMealTiers({ events, servedMap, mealNames: ['Ignored'], nowMs: NOW });

  assert.equal(demotionEnabled, true);
  assert.equal(tiers.Ignored, TIER.RARE);
});

test('demotion needs evidence: with no confirms anywhere, nothing is demoted', () => {
  // App.jsx auto-confirms every past planned meal, so `mealHistory` cannot
  // distinguish eaten from assumed and only the confirm event log can. A user
  // who has not pressed Confirm must not have their whole catalog demoted.
  const { tiers, demotionEnabled, confirms: total } = resolveMealTiers({
    events: [],
    servedMap: served('Ignored', 9),
    mealNames: ['Ignored'],
    nowMs: NOW
  });

  assert.equal(total, 0);
  assert.equal(demotionEnabled, false);
  assert.equal(tiers.Ignored, DEFAULT_TIER);
});

test('rejections demote regardless of how little the user confirms', () => {
  // A swap or a skip is a deliberate act, unlike silence.
  const events = Array.from({ length: 3 }, (_, i) => ({
    type: 'swap',
    fromMealName: 'Disliked',
    timestamp: `2026-08-0${i + 1}T12:00:00.000Z`
  }));
  const { tiers, demotionEnabled } = resolveMealTiers({ events, servedMap: {}, mealNames: ['Disliked'], nowMs: NOW });

  assert.equal(demotionEnabled, false, 'no confirms, so served-and-uneaten demotion stays off');
  assert.equal(tiers.Disliked, TIER.EXCLUDED, 'but explicit rejections still demote');
  assert.equal(maxPerWeek('Disliked', tiers), 0);
});

test('an explicit override beats whatever behaviour would have derived', () => {
  const events = confirms('Fav', 6);
  const { tiers, sources } = resolveMealTiers({
    events,
    servedMap: served('Fav', 6),
    overrides: { Fav: TIER.EXCLUDED },
    mealNames: ['Fav'],
    nowMs: NOW
  });

  assert.equal(tiers.Fav, TIER.EXCLUDED);
  assert.equal(sources.Fav, 'override');
});

test('a rare meal served this week is held back until its cooldown passes', () => {
  const stats = new Map([['x', { mealName: 'X', served: 3, eaten: 0, rejected: 0, lastServedAt: '2026-09-04' }]]);
  assert.equal(isInCooldown('X', { tiers: { X: TIER.RARE }, stats, nowMs: NOW }), true);

  const old = new Map([['x', { mealName: 'X', served: 3, eaten: 0, rejected: 0, lastServedAt: '2026-07-01' }]]);
  assert.equal(isInCooldown('X', { tiers: { X: TIER.RARE }, stats: old, nowMs: NOW }), false);

  // An occasional meal has no cooldown, however recently it was served.
  assert.equal(isInCooldown('X', { tiers: { X: TIER.OCCASIONAL }, stats, nowMs: NOW }), false);
});

test('behaviour older than the lookback window is ignored', () => {
  const stale = confirms('Fav', 6).map((event) => ({ ...event, timestamp: '2025-01-01T12:00:00.000Z' }));
  const stats = buildMealStats({ events: stale, servedMap: {}, nowMs: NOW });
  assert.equal(stats.has('fav'), false);
});

test('unknown meals and unknown tiers fall back rather than throwing', () => {
  assert.equal(maxPerWeek('Never seen', {}), 1);
  assert.equal(maxPerWeek('Bad tier', { 'Bad tier': 'nonsense' }), 1);
  assert.deepEqual(normalizeTierOverrides({ A: TIER.STAPLE, B: 'nope', '': TIER.RARE }), { A: TIER.STAPLE });
  assert.equal(deriveTier(null), null);
  assert.equal(totalConfirms(new Map()), 0);
});

test('the derivation thresholds are declared once and read, not restated', () => {
  // A meal one confirm short of `stapleMinEaten` must not be a staple, so the
  // threshold the code applies is provably the one declared here.
  const short = buildMealStats({
    events: confirms('Fav', TIER_DERIVATION.stapleMinEaten - 1),
    servedMap: served('Fav', TIER_DERIVATION.stapleMinEaten - 1),
    nowMs: NOW
  });
  assert.notEqual(deriveTier(short.get('fav')), TIER.STAPLE);
});
