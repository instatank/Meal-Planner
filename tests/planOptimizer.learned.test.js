import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { getRules } from '../src/lib/rules.js';
import {
  buildWeekPlan,
  enumerateFeasibleDays,
  mealFacts,
  scoreDayStandalone
} from '../src/lib/planOptimizer.js';
import { normalizePreferences } from '../src/lib/plannerGenerator.js';
import { extractMealAttributes } from '../src/lib/mealDataLayer.js';
import { buildGoalAdjustedPlannerInput } from '../src/lib/onboardingPlannerAdapter.js';

const rules = getRules('high_protein');
const candidates = enumerateFeasibleDays({ mealDatabase, rules, preferences: normalizePreferences({}) });

test('there are candidates to score — otherwise every claim below is vacuous', () => {
  assert.ok(candidates.length > 1000, `only ${candidates.length} candidates`);
});

test('with no learned evidence the score is bit-for-bit what it was before', () => {
  // The strongest guarantee available, and the one that matters: a user with
  // no history must not be able to tell that learning was added. Not "close
  // enough" — identical, because the block is skipped rather than adding zero.
  const bare = normalizePreferences({});
  const empty = normalizePreferences({ learned: { dishes: {}, attributes: {} } });

  for (const day of candidates.slice(0, 500)) {
    const a = scoreDayStandalone(day, { rules, preferences: bare });
    const b = scoreDayStandalone(day, { rules, preferences: empty });
    assert.equal(Object.is(a, b), true, `scores diverged: ${a} vs ${b}`);
  }
});

test('an empty learned model produces the identical week, not merely a similar one', () => {
  const targetDateKeys = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  const build = (preferences) =>
    buildWeekPlan({ mealDatabase, rules, targetDateKeys, historyMap: {}, preferences });

  const before = build(normalizePreferences({}));
  const after = build(normalizePreferences({ learned: { dishes: {}, attributes: {} } }));

  assert.deepEqual(
    after.days.map((d) => [d.breakfast?.name, d.lunch?.name, d.dinner?.name]),
    before.days.map((d) => [d.breakfast?.name, d.lunch?.name, d.dinner?.name])
  );
  assert.deepEqual(after.summary, before.summary);
});

test('a learned dislike lowers the score of days containing that dish', () => {
  const target = candidates.find((day) => day.lunch?.name);
  const dishName = target.lunch.name;

  const neutral = normalizePreferences({});
  const disliked = normalizePreferences({ learned: { dishes: { [dishName]: -0.8 }, attributes: {} } });

  const base = scoreDayStandalone(target, { rules, preferences: neutral });
  const penalised = scoreDayStandalone(target, { rules, preferences: disliked });

  assert.ok(penalised < base, 'a disliked dish should score lower');
  assert.equal(
    Number((base - penalised).toFixed(6)),
    Number((0.8 * rules.scored.learnedDishWeight).toFixed(6)),
    'the penalty should be exactly score x weight — no hidden multipliers'
  );
});

test('a learned attribute reaches dishes the user has never been served', () => {
  // The point of attribute learning: evidence about paneer must move a paneer
  // dish that appears in no event anywhere.
  const paneerDay = candidates.find((day) =>
    ['breakfast', 'lunch', 'dinner'].some((slot) => mealFacts(day[slot]).attributeKeys.includes('primary:paneer'))
  );
  assert.ok(paneerDay, 'no candidate day contains a paneer dish');

  const neutral = normalizePreferences({});
  const avoidsPaneer = normalizePreferences({ learned: { dishes: {}, attributes: { 'primary:paneer': -0.5 } } });

  const base = scoreDayStandalone(paneerDay, { rules, preferences: neutral });
  const penalised = scoreDayStandalone(paneerDay, { rules, preferences: avoidsPaneer });
  assert.ok(penalised < base);

  // And a day with no paneer in it is untouched.
  const noPaneerDay = candidates.find((day) =>
    ['breakfast', 'lunch', 'dinner'].every((slot) => !mealFacts(day[slot]).attributeKeys.includes('primary:paneer'))
  );
  assert.ok(noPaneerDay);
  assert.equal(
    Object.is(
      scoreDayStandalone(noPaneerDay, { rules, preferences: neutral }),
      scoreDayStandalone(noPaneerDay, { rules, preferences: avoidsPaneer })
    ),
    true,
    'a day without the attribute must be completely unaffected'
  );
});

test('learned preference changes which week is chosen', () => {
  // Scoring differently is not the claim worth proving — steering is.
  const targetDateKeys = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  const build = (preferences) =>
    buildWeekPlan({ mealDatabase, rules, targetDateKeys, historyMap: {}, preferences });

  const before = build(normalizePreferences({}));
  const beforeNames = before.days.flatMap((d) => [d.breakfast?.name, d.lunch?.name, d.dinner?.name]);
  const countPaneer = (names) =>
    names.filter((name) => {
      const meal = [...mealDatabase.breakfast, ...mealDatabase.lunchDinner].find((m) => m.name === name);
      return meal && extractMealAttributes(meal).includes('primary:paneer');
    }).length;

  const after = build(
    normalizePreferences({ learned: { dishes: {}, attributes: { 'primary:paneer': -1 } } })
  );
  const afterNames = after.days.flatMap((d) => [d.breakfast?.name, d.lunch?.name, d.dinner?.name]);

  assert.notDeepEqual(afterNames, beforeNames, 'a strong dislike should change the week');
  assert.ok(
    countPaneer(afterNames) <= countPaneer(beforeNames),
    `paneer count went up: ${countPaneer(beforeNames)} -> ${countPaneer(afterNames)}`
  );
});

test('learned preference cannot break a hard rule however extreme it gets', () => {
  // The guarantee that makes this safe to ship. Tier 3 ranks; it never gates.
  // Even an absurd model must still yield a week that satisfies Tier 1 and 2.
  const targetDateKeys = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];

  const attributes = {};
  for (const meal of [...mealDatabase.breakfast, ...mealDatabase.lunchDinner]) {
    for (const key of extractMealAttributes(meal)) attributes[key] = -1;
  }

  const week = buildWeekPlan({
    mealDatabase,
    rules,
    targetDateKeys,
    historyMap: {},
    preferences: normalizePreferences({ learned: { dishes: {}, attributes } })
  });

  assert.equal(week.days.length, 7);
  assert.equal(week.feasible, true, 'a hostile learned model must not make the catalog infeasible');
  for (const day of week.days) {
    assert.ok(day.breakfast && day.lunch && day.dinner, 'every day must still be complete');
  }
  // The floor is a ratio of nominal (85% of 7 x the daily target), not a
  // stored absolute — derived here rather than hard-coded so it tracks the one
  // declaration in rules.js if the target ever moves again.
  const nominal = rules.dailyProteinTarget * targetDateKeys.length;
  const floor = nominal * rules.hard.weeklyProteinFloorRatio;
  assert.ok(
    week.summary.totalProtein >= floor,
    `weekly protein floor breached: ${week.summary.totalProtein} < ${floor}`
  );
});

test('mealFacts memoises attribute keys rather than recomputing per candidate', () => {
  const meal = mealDatabase.lunchDinner[0];
  const first = mealFacts(meal);
  const second = mealFacts(meal);
  assert.equal(first.attributeKeys, second.attributeKeys, 'the same array should be handed back');
  assert.deepEqual(first.attributeKeys, extractMealAttributes(meal));
});

test('the goal adapter carries the learned model through instead of dropping it', () => {
  // `buildGoalAdjustedPlannerInput` reconstructs the preference object key by
  // key rather than spreading it, so anything not explicitly named is
  // silently lost. That is the exact mechanism of audit finding #1, where the
  // same pattern swallowed `goalOverride` and routed every user to
  // high_protein — worth a standing test rather than a comment.
  const learned = { dishes: { 'Some dish': -0.4 }, attributes: { 'primary:paneer': -0.6 } };
  const { preferences } = buildGoalAdjustedPlannerInput({
    goal: 'high_protein',
    preferences: { learned },
    mealDatabase
  });

  assert.deepEqual(preferences.learned, learned);
});

test('the adapter tolerates a preference object with no learned model', () => {
  const { preferences } = buildGoalAdjustedPlannerInput({
    goal: 'standard',
    preferences: {},
    mealDatabase
  });
  assert.deepEqual(preferences.learned, { dishes: {}, attributes: {} });
});
