import {
  CARB_HEAVY_THRESHOLD,
  CORE_MEAL_TYPES,
  normalizePreferences
} from './plannerGenerator.js';
import { GOAL, getRulesForProfile, isImplementedGoal, normalizeGoalId } from './rules.js';

const HIGH_PROTEIN_THRESHOLD = 40;
const HIGH_PROTEIN_ACCEPT_DELTA = 0.85;
const LOW_CARB_AVOID_DELTA = 1.25;

/**
 * The goal's daily protein target, from `rules.js` and nowhere else.
 *
 * This module used to carry three numbers of its own: a `Math.max(target, 132)`
 * ratchet, a flat `standard = 80` that contradicted rules.js's 100, and a
 * `Math.min(target, DAILY_PROTEIN_MAX)` ceiling — where `DAILY_PROTEIN_MAX` is
 * the *band edge* of a 120g target, not a limit on the target itself. Between
 * the ratchet and the ceiling, an explicit target could only ever resolve to
 * 132, so the setting would have been inert in both directions.
 */
const resolveDailyProteinTarget = (normalizedGoal, requested) => {
  const explicit = Number(requested);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // A declared-but-unimplemented goal has no ruleset to read a target from;
  // fall back to the default ruleset rather than inventing a number here.
  return getRulesForProfile(isImplementedGoal(normalizedGoal) ? normalizedGoal : '').dailyProteinTarget;
};

const addDelta = (bucket, mealName, delta) => {
  if (!mealName || !Number.isFinite(delta) || delta === 0) return;
  const current = Number(bucket[mealName] || 0);
  bucket[mealName] = Number((current + delta).toFixed(2));
};

const getPlannerMeals = (mealDatabase = {}) => [...(mealDatabase.breakfast || []), ...(mealDatabase.lunchDinner || [])];

export const getMealTypeOrderForGoal = ({ goal, plan = {}, history = {} }) => {
  const hasSnack = Boolean(plan?.snack || history?.snack);

  // Normalized before comparing: onboarding and the engine spell some goals
  // differently, and `rules.js` is the only place that knows how to reconcile
  // them. Comparing raw strings meant a canonical `two_meals` fell through to
  // the three-meal ordering.
  if (normalizeGoalId(goal) === GOAL.TWO_MEALS) {
    return hasSnack ? ['lunch', 'snack', 'dinner'] : ['lunch', 'dinner'];
  }

  return hasSnack ? ['breakfast', 'lunch', 'snack', 'dinner'] : CORE_MEAL_TYPES;
};

export const buildGoalAdjustedPlannerInput = ({ goal, preferences = {}, mealDatabase, dailyProteinTarget }) => {
  const normalizedGoal = normalizeGoalId(goal);
  const normalizedPreferences = normalizePreferences(preferences);
  const adjusted = {
    accepts: { ...normalizedPreferences.accepts },
    avoids: { ...normalizedPreferences.avoids },
    edits: { ...normalizedPreferences.edits },
    skips: { ...normalizedPreferences.skips }
  };

  const nextProteinTarget = resolveDailyProteinTarget(normalizedGoal, dailyProteinTarget);

  const meals = getPlannerMeals(mealDatabase);
  const seenMealNames = new Set();

  for (const meal of meals) {
    const mealName = String(meal?.name || '').trim();
    if (!mealName || seenMealNames.has(mealName)) continue;
    seenMealNames.add(mealName);

    if (normalizedGoal === GOAL.HIGH_PROTEIN && Number(meal?.protein || 0) >= HIGH_PROTEIN_THRESHOLD) {
      addDelta(adjusted.accepts, mealName, HIGH_PROTEIN_ACCEPT_DELTA);
    }

    if (normalizedGoal === GOAL.LOW_CARB && Number(meal?.macros?.c || 0) >= CARB_HEAVY_THRESHOLD) {
      addDelta(adjusted.avoids, mealName, LOW_CARB_AVOID_DELTA);
    }
  }

  return {
    preferences: adjusted,
    dailyProteinTarget: nextProteinTarget
  };
};

