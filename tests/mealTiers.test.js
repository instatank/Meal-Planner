import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIER,
  FREQUENCY_TIER,
  PAIRING_MODE,
  TIER_DEFINITIONS,
  TIER_DISPLAY_ORDER,
  TIER_ORDER,
  UNTIERED,
  getMealTier,
  getMealWeeklyCap,
  getTierDefinition,
  groupMealsByTier,
  hasExplicitTier,
  hasRatingEffects,
  hasTierEffects,
  isKnownTier,
  isRetired,
  normalizeMealTier,
  normalizeMealTierMap,
  sortMealsByTier,
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
  //
  // Asserted through the accessor, not the stored field. The record now keeps
  // `null` rather than writing `occasional` over an answer it did not
  // understand — but every consumer reads through `getMealTier` /
  // `getTierDefinition`, so the planner still sees the default. That is the
  // guarantee worth pinning; which literal sits in storage is not.
  assert.equal(getMealTier({ X: { tier: 'legendary' } }, 'X'), DEFAULT_TIER);
  assert.equal(getMealWeeklyCap({ X: { tier: 'legendary' } }, 'X'), 1);
  assert.equal(getTierDefinition(normalizeMealTier({ tier: 'legendary' }).tier).id, DEFAULT_TIER);
});

test('a dish nobody has judged is distinguishable from one judged Occasional', () => {
  // The whole reason `tier` is nullable. `occasional` is the default, so
  // without this the two are the same record and the tiering screen cannot put
  // the unjudged ones first — which is the one thing that screen is for.
  const tierMap = normalizeMealTierMap({
    Judged: { tier: FREQUENCY_TIER.OCCASIONAL },
    RatedOnly: { rating: 5 },
    Untouched: {}
  });

  assert.equal(hasExplicitTier(tierMap, 'Judged'), true);
  assert.equal(hasExplicitTier(tierMap, 'RatedOnly'), false, 'a rating says how much, not how often');
  assert.equal(hasExplicitTier(tierMap, 'Untouched'), false);
  assert.equal(hasExplicitTier(tierMap, 'NotInTheMapAtAll'), false);

  // ...and all of them still plan identically, because that is what the null
  // means. A distinction the screen can see must stay invisible to the planner.
  for (const name of ['Judged', 'RatedOnly', 'Untouched', 'NotInTheMapAtAll']) {
    assert.equal(getMealTier(tierMap, name), DEFAULT_TIER);
    assert.equal(getMealWeeklyCap(tierMap, name), 1);
  }
});

test('a rating alone never switches the optimizer off its untiered path', () => {
  // `hasTierEffects` used to compare `entry.tier !== DEFAULT_TIER` on the raw
  // field. A nullable tier makes that comparison true for a rated-but-untiered
  // dish, which would quietly end the "an untiered catalog plans identically"
  // guarantee — the property the whole tier system rests on.
  const ratedOnly = normalizeMealTierMap({ A: { rating: 5 }, B: { rating: 1 } });
  assert.equal(hasTierEffects(ratedOnly), false);
  assert.equal(hasRatingEffects(ratedOnly), true);

  assert.equal(hasTierEffects(normalizeMealTierMap({ A: { tier: FREQUENCY_TIER.OCCASIONAL } })), false);
  assert.equal(hasTierEffects(normalizeMealTierMap({ A: { tier: FREQUENCY_TIER.STAPLE } })), true);
});

test('meals are ordered unjudged first, then most frequent to least', () => {
  const meals = [
    { name: 'Zebra staple' },
    { name: 'Apple retired' },
    { name: 'Mango unset' },
    { name: 'Apricot unset' },
    { name: 'Banana occasional' },
    { name: 'Cherry regular' },
    { name: 'Date rare' }
  ];
  const tierMap = normalizeMealTierMap({
    'Zebra staple': { tier: FREQUENCY_TIER.STAPLE },
    'Apple retired': { tier: FREQUENCY_TIER.RETIRED },
    'Banana occasional': { tier: FREQUENCY_TIER.OCCASIONAL },
    'Cherry regular': { tier: FREQUENCY_TIER.REGULAR },
    'Date rare': { tier: FREQUENCY_TIER.RARE }
  });

  assert.deepEqual(
    sortMealsByTier(meals, tierMap).map((m) => m.name),
    [
      // Unjudged first — alphabetical within the group, because the list is
      // browsed by name.
      'Apricot unset',
      'Mango unset',
      'Zebra staple',
      'Cherry regular',
      'Banana occasional',
      'Date rare',
      'Apple retired'
    ]
  );

  // Sorting must not mutate the caller's array.
  assert.equal(meals[0].name, 'Zebra staple');
});

test('grouping labels each band and drops the empty ones', () => {
  const meals = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const tierMap = normalizeMealTierMap({ B: { tier: FREQUENCY_TIER.STAPLE } });
  const groups = groupMealsByTier(meals, tierMap);

  assert.deepEqual(groups.map((g) => g.bucket), [UNTIERED, FREQUENCY_TIER.STAPLE]);
  assert.deepEqual(groups[0].meals.map((m) => m.name), ['A', 'C']);
  assert.ok(groups[0].definition.label, 'the unjudged group needs a label of its own');
  assert.equal(groups[1].definition.label, TIER_DEFINITIONS[FREQUENCY_TIER.STAPLE].label);

  // Every meal appears exactly once, whatever the grouping does.
  assert.equal(groups.reduce((n, g) => n + g.meals.length, 0), meals.length);
});

test('UNTIERED is a display concept and never a tier the planner can receive', () => {
  assert.ok(!TIER_ORDER.includes(UNTIERED));
  assert.equal(isKnownTier(UNTIERED), false);
  assert.equal(getMealTier({ X: { tier: UNTIERED } }, 'X'), DEFAULT_TIER);
  assert.equal(TIER_DISPLAY_ORDER[0], UNTIERED);
  assert.deepEqual(TIER_DISPLAY_ORDER.slice(1), [...TIER_ORDER]);
});

test('coverage counts the unjudged without changing what a week can hold', () => {
  const names = ['A', 'B', 'C'];
  const tierMap = normalizeMealTierMap({ A: { tier: FREQUENCY_TIER.STAPLE }, B: { rating: 4 } });
  const coverage = summarizeTierCoverage(tierMap, names);

  assert.equal(coverage.untiered, 2, 'B is rated but not tiered, C is untouched');
  // An untiered dish is still planned as occasional, so it still supplies a
  // weekly slot. Counting it as unjudged must not remove it from capacity.
  assert.equal(coverage.weeklyCapacity, 3 + 1 + 1, 'staple 3 + occasional 1 + occasional 1');
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
