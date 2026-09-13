import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIER,
  FREQUENCY_TIER,
  PAIRING_MODE,
  TIER_DEFINITIONS,
  TIER_ORDER,
  getMealWeeklyCap,
  hasRatingEffects,
  hasTierEffects,
  isRetired,
  normalizeMealTier,
  normalizeMealTierMap,
  summarizeTierCoverage
} from '../src/lib/mealTiers.js';
import { RUBRIC_LIMITS } from '../src/lib/rules.js';

test('the default tier reproduces the rule it replaces', () => {
  // The load-bearing guarantee: an untiered catalog must plan exactly as it
  // did before tiers existed. That holds only if the default cap equals
  // R1's flat cap, so it is asserted against the rule itself rather than
  // against the number 1 written twice.
  assert.equal(TIER_DEFINITIONS[DEFAULT_TIER].maxPerWeek, RUBRIC_LIMITS.maxDishRepeatsPerWeek);
  assert.equal(getMealWeeklyCap({}, 'anything at all'), RUBRIC_LIMITS.maxDishRepeatsPerWeek);
  assert.equal(TIER_DEFINITIONS[DEFAULT_TIER].repeatPenaltyScale, 1, 'the default must not discount repeats');
});

test('a staple may repeat and a retired dish may not appear', () => {
  assert.ok(TIER_DEFINITIONS[FREQUENCY_TIER.STAPLE].maxPerWeek > RUBRIC_LIMITS.maxDishRepeatsPerWeek);
  assert.equal(TIER_DEFINITIONS[FREQUENCY_TIER.RETIRED].maxPerWeek, 0);
});

test('permitting a repeat is not the same as wanting one', () => {
  // A cap alone leaves the variety bonus winning every time, so a staple would
  // stay a once-a-week dish that merely *could* repeat. The penalty scale is
  // what makes the tier mean something.
  assert.ok(TIER_DEFINITIONS[FREQUENCY_TIER.STAPLE].repeatPenaltyScale < 1);
  assert.ok(
    TIER_DEFINITIONS[FREQUENCY_TIER.STAPLE].repeatPenaltyScale
    < TIER_DEFINITIONS[FREQUENCY_TIER.REGULAR].repeatPenaltyScale
  );
});

test('a rare dish is bounded by a gap in days, not by the weekly cap', () => {
  // "Once a month" cannot be said with a per-week cap of 1 — that is once a
  // week. It needs a cooldown read against history.
  const rare = TIER_DEFINITIONS[FREQUENCY_TIER.RARE];
  assert.equal(rare.maxPerWeek, 1);
  assert.ok(rare.minGapDays >= 14);
});

test('an unknown tier degrades to the default instead of throwing', () => {
  // A record from a newer build, or hand-edited, must not break the planner.
  assert.equal(normalizeMealTier({ tier: 'legendary' }).tier, DEFAULT_TIER);
  assert.equal(getMealWeeklyCap({ X: { tier: 'legendary' } }, 'X'), 1);
});

test('ratings are clamped; a non-numeric rating is absent, not zero', () => {
  assert.equal(normalizeMealTier({ rating: 9 }).rating, 5);
  assert.equal(normalizeMealTier({ rating: 0 }).rating, 1);
  assert.equal(normalizeMealTier({ rating: 'great' }).rating, null);
  assert.equal(normalizeMealTier({}).rating, null);
});

test('pairing defaults to fixed, because taking a dish apart is the risky guess', () => {
  assert.equal(normalizeMealTier({}).pairing, PAIRING_MODE.FIXED);
  assert.equal(normalizeMealTier({ pairing: 'anything' }).pairing, PAIRING_MODE.FIXED);
  assert.equal(normalizeMealTier({ pairing: 'modular' }).pairing, PAIRING_MODE.MODULAR);
});

test('a map of default entries is inert for capping but not for rating', () => {
  const map = normalizeMealTierMap({ A: { tier: 'occasional', rating: 5 } });
  assert.equal(hasTierEffects(map), false, 'default tiers change no cap');
  assert.equal(hasRatingEffects(map), true, 'but a rating still steers scoring');
  assert.equal(hasTierEffects(normalizeMealTierMap({ A: { tier: 'staple' } })), true);
});

test('malformed map entries are dropped, not carried as nulls', () => {
  const map = normalizeMealTierMap({ A: { tier: 'staple' }, '': { tier: 'staple' }, B: null, C: 'nope' });
  assert.deepEqual(Object.keys(map), ['A']);
});

test('coverage reports the weekly supply a retirement spree eats into', () => {
  // R1 needs 21 distinct dishes a week. Retiring is the one edit here that can
  // make the catalog unable to fill a week, so the number has to be visible
  // before the planner starts failing rather than after.
  const names = ['A', 'B', 'C', 'D'];
  const map = normalizeMealTierMap({
    A: { tier: 'staple' }, B: { tier: 'retired' }, C: { tier: 'regular', rating: 4 }
  });

  const summary = summarizeTierCoverage(map, names);
  assert.equal(summary.total, 4);
  assert.equal(summary.retired, 1);
  assert.equal(summary.available, 3);
  assert.equal(summary.counts.staple, 1);
  assert.equal(summary.counts.occasional, 1, 'D is untiered and counts as the default');
  assert.equal(summary.rated, 1);
  assert.equal(summary.averageRating, 4);
  // staple 3 + retired 0 + regular 2 + default 1
  assert.equal(summary.weeklyCapacity, 6);
});

test('isRetired is the single question the optimizer asks to exclude a dish', () => {
  const map = normalizeMealTierMap({ Gone: { tier: 'retired' }, Kept: { tier: 'staple' } });
  assert.equal(isRetired(map, 'Gone'), true);
  assert.equal(isRetired(map, 'Kept'), false);
  assert.equal(isRetired(map, 'Unknown'), false);
});

test('tier order runs most-frequent to never', () => {
  assert.deepEqual(TIER_ORDER, ['staple', 'regular', 'occasional', 'rare', 'retired']);
});
