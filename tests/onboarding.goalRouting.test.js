/**
 * onboarding.goalRouting.test.js — the goal the user chose must reach the
 * ruleset that judges their plan.
 *
 * Covers finding #1 of docs/CONSISTENCY_AUDIT.md: goal identity lived in two
 * vocabularies (`ONBOARDING_GOAL` and `GOAL`) that only `rules.js` knew how to
 * reconcile, and the per-day generation path in App.jsx accepted a goal and
 * then dropped it, so `getRulesForProfile(undefined)` silently resolved every
 * day to `high_protein`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { generatePlanForDate, CORE_MEAL_TYPES } from '../src/lib/plannerGenerator.js';
import { buildGoalAdjustedPlannerInput, getMealTypeOrderForGoal } from '../src/lib/onboardingPlannerAdapter.js';
import { GOAL, getRules } from '../src/lib/rules.js';
import { ONBOARDING_GOAL } from '../src/lib/onboardingProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dayTotals = (day) =>
  CORE_MEAL_TYPES.reduce(
    (totals, slot) => ({
      protein: totals.protein + Number(day?.[slot]?.protein || 0),
      carbs: totals.carbs + Number(day?.[slot]?.macros?.c || 0)
    }),
    { protein: 0, carbs: 0 }
  );

const minMealProtein = (day) =>
  Math.min(...CORE_MEAL_TYPES.map((slot) => Number(day?.[slot]?.protein || 0)));

// ─── The contract the fix has to deliver ────────────────────────────────────

test('a standard-goal day is built under standard rules, not high_protein', () => {
  const args = {
    dateKey: '2026-08-17',
    plans: {},
    preferences: {},
    mealDatabase,
    dailyProteinTarget: 80
  };

  const standardDay = generatePlanForDate({ ...args, goal: GOAL.STANDARD });
  const droppedGoalDay = generatePlanForDate({ ...args });

  const standardRules = getRules(GOAL.STANDARD);
  const highProteinRules = getRules(GOAL.HIGH_PROTEIN);

  // Every meal must clear the goal's own per-meal floor — 12g, not 20g.
  assert.ok(
    minMealProtein(standardDay) >= standardRules.hard.minMealProtein,
    'standard day violates its own 12g per-meal floor'
  );

  // `standard` sets dailyCarbCap to Infinity, so the day must be free to
  // exceed the 130g cap that only `high_protein` imposes. On this catalog the
  // best standard day lands at 183g of carbs; the high_protein path is pinned
  // to its cap at exactly 130g. If the goal were being dropped, both would be
  // built under the same capped ruleset and this would not hold.
  assert.equal(standardRules.budgeted.dailyCarbCap, Infinity);
  assert.ok(
    dayTotals(standardDay).carbs > highProteinRules.budgeted.dailyCarbCap,
    `standard day capped at ${dayTotals(standardDay).carbs}g carbs — it is being judged by high_protein's ${highProteinRules.budgeted.dailyCarbCap}g cap`
  );

  // And the two paths must genuinely differ, so that forwarding the goal is
  // observable rather than a no-op on this catalog.
  assert.notDeepEqual(
    CORE_MEAL_TYPES.map((slot) => standardDay[slot]?.name),
    CORE_MEAL_TYPES.map((slot) => droppedGoalDay[slot]?.name)
  );
});

// ─── The call site that drops it ────────────────────────────────────────────

/**
 * App.jsx is JSX and nothing in this suite can import it, so the wrapper is
 * pinned at the source level. A reconstruction of the wrapper in this file
 * would pass while App.jsx stayed broken — the exact failure mode recorded in
 * docs/CONSISTENCY_AUDIT.md's appendix about the prompt test.
 */
test('the App.jsx per-day wrapper forwards the goal it was given', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8');

  const wrapperStart = source.indexOf('const generatePlanForDate = (');
  assert.ok(wrapperStart > -1, 'App.jsx no longer defines a generatePlanForDate wrapper');

  const wrapper = source.slice(wrapperStart, source.indexOf('\n  };', wrapperStart));

  assert.match(
    wrapper,
    /goalOverride\s*=\s*onboardingProfile\?\.goal/,
    'the wrapper should still default the goal to the onboarding profile'
  );

  const callStart = wrapper.indexOf('plannerGeneratePlanForDate({');
  assert.ok(callStart > -1, 'the wrapper no longer calls the shared day generator');

  assert.match(
    wrapper.slice(callStart),
    /\bgoal:\s*goalOverride\b/,
    'App.jsx accepts a goalOverride and does not forward it — every day is built under high_protein'
  );
});

// ─── One vocabulary, reconciled at the boundary ─────────────────────────────

test('the adapter normalizes goal spellings before comparing', () => {
  // Both spellings name the same goal; rules.js reconciles them via
  // GOAL_ALIASES, so the adapter must not compare raw strings.
  for (const spelling of ['two_meals_day', GOAL.TWO_MEALS]) {
    assert.deepEqual(
      getMealTypeOrderForGoal({ goal: spelling, plan: {}, history: {} }),
      ['lunch', 'dinner'],
      `${spelling} should resolve to the two-meal slot order`
    );
  }

  for (const spelling of ['highProtein', GOAL.HIGH_PROTEIN]) {
    const result = buildGoalAdjustedPlannerInput({
      goal: spelling,
      preferences: {},
      mealDatabase
    });
    // Recognition is observable through the goal-specific accept boost. It
    // used to be asserted via the adapter's protein-target ratchet, which
    // finding #2 removed as a duplicate of rules.js.
    assert.ok(
      Object.keys(result.preferences.accepts).length > 0,
      `${spelling} should be recognised as high_protein and boost high-protein meals`
    );
  }
});

test('onboarding declares goals from the single source of truth in rules.js', () => {
  // The onboarding enum must carry rules.js's canonical ids rather than a
  // parallel set of strings only GOAL_ALIASES knows how to translate.
  assert.equal(ONBOARDING_GOAL.HIGH_PROTEIN, GOAL.HIGH_PROTEIN);
  assert.equal(ONBOARDING_GOAL.STANDARD, GOAL.STANDARD);
  assert.equal(ONBOARDING_GOAL.LOW_CARB, GOAL.LOW_CARB);
  assert.equal(ONBOARDING_GOAL.VEGETARIAN, GOAL.VEGETARIAN);
  // Legacy key kept so existing callers keep resolving, canonical value.
  assert.equal(ONBOARDING_GOAL.TWO_MEALS_DAY, GOAL.TWO_MEALS);
});
