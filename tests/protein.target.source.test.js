/**
 * protein.target.source.test.js — the daily protein target has one home.
 *
 * Covers finding #2 of docs/CONSISTENCY_AUDIT.md. The target was declared in
 * seven places: `rules.js` per goal, three numbers inside
 * `onboardingPlannerAdapter.js` (a `Math.max` ratchet, a flat `standard`
 * override, and a `Math.min` ceiling borrowed from a *different* target's band
 * edge), a literal in each of App.jsx's two week-generation call sites, and an
 * unread figure in `ingredients.js`.
 *
 * `high_protein` agreed at 132 only by coincidence of three unrelated numbers;
 * `standard` disagreed outright, 80 against 100.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { GOAL, getRules } from '../src/lib/rules.js';
import { buildGoalAdjustedPlannerInput } from '../src/lib/onboardingPlannerAdapter.js';

test('rules.js declares the settled daily protein target per goal', () => {
  assert.equal(getRules(GOAL.HIGH_PROTEIN).dailyProteinTarget, 120);
  assert.equal(getRules(GOAL.STANDARD).dailyProteinTarget, 100);
});

test('the adapter resolves the target from rules.js rather than its own numbers', () => {
  for (const goal of [GOAL.HIGH_PROTEIN, GOAL.STANDARD]) {
    const expected = getRules(goal).dailyProteinTarget;
    const { dailyProteinTarget } = buildGoalAdjustedPlannerInput({
      goal,
      preferences: {},
      mealDatabase
    });

    assert.equal(
      dailyProteinTarget,
      expected,
      `${goal}: adapter returned ${dailyProteinTarget}g, rules.js says ${expected}g`
    );
  }
});

test('an explicitly supplied target is neither ratcheted up nor clamped down', () => {
  // The ratchet (`Math.max(target, 132)`) made it impossible to plan below
  // 132g on high_protein; the ceiling (`Math.min(target, DAILY_PROTEIN_MAX)`)
  // made it impossible to plan above it, because DAILY_PROTEIN_MAX is the band
  // edge of a 120g target rather than a limit on the target itself. Between
  // them, an explicit target could only ever resolve to 132.
  for (const [goal, requested] of [
    [GOAL.HIGH_PROTEIN, 110],
    [GOAL.HIGH_PROTEIN, 150],
    [GOAL.STANDARD, 90]
  ]) {
    const { dailyProteinTarget } = buildGoalAdjustedPlannerInput({
      goal,
      preferences: {},
      mealDatabase,
      dailyProteinTarget: requested
    });

    assert.equal(
      dailyProteinTarget,
      requested,
      `${goal}: asked for ${requested}g, got ${dailyProteinTarget}g`
    );
  }
});

test('the goal still drives the derived weekly figures', () => {
  // Guards the reason the target matters: everything downstream is derived
  // from it, so a target resolved from the wrong home moves the whole week.
  const highProtein = getRules(GOAL.HIGH_PROTEIN);
  const standard = getRules(GOAL.STANDARD);

  assert.equal(highProtein.week.nominalProtein, 840);
  assert.equal(highProtein.week.proteinFloor, 714);
  assert.equal(standard.week.nominalProtein, 700);
  assert.equal(standard.week.proteinFloor, 595);
});
