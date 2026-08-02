import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECLARED_GOALS,
  GOAL,
  IMPLEMENTED_GOALS,
  UnsupportedGoalError,
  allowedMissDays,
  getRules,
  getRulesForProfile,
  isImplementedGoal,
  normalizeGoalId,
  requiredCompliantDays,
  weeklyProteinFloor
} from '../src/lib/rules.js';

test('high_protein ruleset matches the settled Phase 1 thresholds', () => {
  const rules = getRules(GOAL.HIGH_PROTEIN);

  assert.equal(rules.dailyProteinTarget, 132);

  // Tier 1 — hard
  assert.equal(rules.hard.minMealProtein, 20);
  assert.equal(rules.hard.dailyProteinSanityFloor, 50);
  assert.equal(rules.hard.maxSameMealPerDay, 1);
  assert.equal(rules.hard.maxBreakfastRepeatsPerWeek, 4);
  assert.equal(rules.hard.maxLunchDinnerRepeatsPerWeek, 2);
  assert.equal(rules.hard.redMeatMealsPerWeek, 3);
  assert.equal(rules.hard.avoidScoreExclusiveMax, 3);
  assert.equal(rules.hard.weeklyProteinFloorRatio, 0.85);

  // Tier 2 — budgeted
  assert.equal(rules.budgeted.dailyProteinMin, 119);
  assert.equal(rules.budgeted.dailyProteinMax, 145);
  assert.equal(rules.budgeted.dailyCarbCap, 130);
  assert.equal(rules.budgeted.dailyCalorieMin, 1600);
  assert.equal(rules.budgeted.dailyCalorieMax, 2200);

  // The canonical 7-day figures quoted in the handover.
  assert.equal(rules.week.nominalProtein, 924);
  assert.equal(rules.week.proteinFloor, 785);
  assert.equal(rules.week.minDaysProteinInBand, 5);
  assert.equal(rules.week.minDaysUnderCarbCap, 5);
  assert.equal(rules.week.minDaysInCalorieBounds, 5);
});

test('standard ruleset is looser and carries no binding carb cap', () => {
  const rules = getRules(GOAL.STANDARD);

  assert.equal(rules.hard.minMealProtein, 12);
  assert.equal(rules.hard.redMeatMealsPerWeek, 4);
  assert.equal(rules.hard.maxBreakfastRepeatsPerWeek, 3);
  assert.equal(rules.budgeted.dailyCarbCap, Infinity);
  assert.equal(rules.budgeted.dailyCalorieMin, 1800);
  assert.equal(rules.budgeted.dailyCalorieMax, 2400);
});

test('protein band tracks the supplied daily target', () => {
  const rules = getRules(GOAL.HIGH_PROTEIN, { dailyProteinTarget: 120 });

  assert.equal(rules.dailyProteinTarget, 120);
  assert.equal(rules.budgeted.dailyProteinMin, 108);
  assert.equal(rules.budgeted.dailyProteinMax, 132);
  assert.equal(rules.week.proteinFloor, 714); // round(7 * 120 * 0.85)
});

test('unknown and merely-declared goals fail loudly instead of becoming high_protein', () => {
  assert.throws(() => getRules('vegetarian'), UnsupportedGoalError);
  assert.throws(() => getRules('low_carb'), UnsupportedGoalError);
  assert.throws(() => getRules('two_meals_day'), UnsupportedGoalError);
  assert.throws(() => getRules('nonsense'), UnsupportedGoalError);

  // The declared-but-unimplemented message says so explicitly.
  try {
    getRules('vegetarian');
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error.declared, true);
    assert.match(error.message, /declared in onboarding/);
  }
});

test('goal id aliases are reconciled across onboarding and the data layer', () => {
  assert.equal(normalizeGoalId('two_meals_day'), 'two_meals');
  assert.equal(normalizeGoalId('two_meals'), 'two_meals');
  assert.equal(normalizeGoalId('  high_protein '), 'high_protein');
  assert.equal(normalizeGoalId(undefined), '');

  assert.ok(DECLARED_GOALS.includes('two_meals'));
  assert.ok(!DECLARED_GOALS.includes('two_meals_day'));
  assert.deepEqual([...IMPLEMENTED_GOALS], ['high_protein', 'standard']);
  assert.equal(isImplementedGoal('two_meals_day'), false);
});

test('an unset profile goal defaults to high_protein, a chosen-but-unbuilt one still throws', () => {
  assert.equal(getRulesForProfile(undefined).goal, 'high_protein');
  assert.equal(getRulesForProfile('').goal, 'high_protein');
  assert.throws(() => getRulesForProfile('vegetarian'), UnsupportedGoalError);
});

test('budgets pro-rate down for partial-week regenerations', () => {
  const rules = getRules(GOAL.HIGH_PROTEIN);

  assert.equal(allowedMissDays(7, rules), 2);
  assert.equal(allowedMissDays(6, rules), 1);
  assert.equal(allowedMissDays(4, rules), 1);
  assert.equal(allowedMissDays(3, rules), 0);
  assert.equal(allowedMissDays(1, rules), 0);

  assert.equal(requiredCompliantDays(7, rules), 5);
  assert.equal(requiredCompliantDays(4, rules), 3);
  assert.equal(requiredCompliantDays(1, rules), 1);
});

test('weekly protein floor pro-rates with the number of days generated', () => {
  const rules = getRules(GOAL.HIGH_PROTEIN);

  assert.equal(weeklyProteinFloor(7, rules), 785);
  assert.equal(weeklyProteinFloor(4, rules), 449); // round(4 * 132 * 0.85)
  assert.equal(weeklyProteinFloor(0, rules), 0);
});

test('rulesets are frozen so no consumer can mutate shared thresholds', () => {
  const rules = getRules(GOAL.HIGH_PROTEIN);
  assert.throws(() => { rules.hard.minMealProtein = 5; }, TypeError);
  assert.throws(() => { rules.budgeted.dailyCarbCap = 999; }, TypeError);
});
