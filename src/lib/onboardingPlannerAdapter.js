import {
  CARB_HEAVY_THRESHOLD,
  CORE_MEAL_TYPES,
  DAILY_PROTEIN_MAX,
  DEFAULT_DAILY_PROTEIN_TARGET,
  normalizePreferences
} from './plannerGenerator.js';
import { ONBOARDING_GOAL } from './onboardingProfile.js';

const HIGH_PROTEIN_THRESHOLD = 40;
const HIGH_PROTEIN_ACCEPT_DELTA = 0.85;
const LOW_CARB_AVOID_DELTA = 1.25;
const HIGH_PROTEIN_DAILY_TARGET = 132;

const addDelta = (bucket, mealName, delta) => {
  if (!mealName || !Number.isFinite(delta) || delta === 0) return;
  const current = Number(bucket[mealName] || 0);
  bucket[mealName] = Number((current + delta).toFixed(2));
};

const getPlannerMeals = (mealDatabase = {}) => [...(mealDatabase.breakfast || []), ...(mealDatabase.lunchDinner || [])];

export const getMealTypeOrderForGoal = ({ goal, plan = {}, history = {} }) => {
  const hasSnack = Boolean(plan?.snack || history?.snack);

  if (goal === ONBOARDING_GOAL.TWO_MEALS_DAY) {
    return hasSnack ? ['lunch', 'snack', 'dinner'] : ['lunch', 'dinner'];
  }

  return hasSnack ? ['breakfast', 'lunch', 'snack', 'dinner'] : CORE_MEAL_TYPES;
};

export const buildGoalAdjustedPlannerInput = ({ goal, preferences = {}, mealDatabase, dailyProteinTarget }) => {
  const normalizedPreferences = normalizePreferences(preferences);
  const adjusted = {
    accepts: { ...normalizedPreferences.accepts },
    avoids: { ...normalizedPreferences.avoids },
    edits: { ...normalizedPreferences.edits },
    skips: { ...normalizedPreferences.skips }
  };

  let nextProteinTarget = Number(dailyProteinTarget || DEFAULT_DAILY_PROTEIN_TARGET);
  if (!Number.isFinite(nextProteinTarget)) nextProteinTarget = DEFAULT_DAILY_PROTEIN_TARGET;

  const meals = getPlannerMeals(mealDatabase);
  const seenMealNames = new Set();

  for (const meal of meals) {
    const mealName = String(meal?.name || '').trim();
    if (!mealName || seenMealNames.has(mealName)) continue;
    seenMealNames.add(mealName);

    if (goal === ONBOARDING_GOAL.HIGH_PROTEIN && Number(meal?.protein || 0) >= HIGH_PROTEIN_THRESHOLD) {
      addDelta(adjusted.accepts, mealName, HIGH_PROTEIN_ACCEPT_DELTA);
    }

    if (goal === ONBOARDING_GOAL.LOW_CARB && Number(meal?.macros?.c || 0) >= CARB_HEAVY_THRESHOLD) {
      addDelta(adjusted.avoids, mealName, LOW_CARB_AVOID_DELTA);
    }
  }

  if (goal === ONBOARDING_GOAL.HIGH_PROTEIN) {
    nextProteinTarget = Math.max(nextProteinTarget, HIGH_PROTEIN_DAILY_TARGET);
  }

  nextProteinTarget = Math.min(nextProteinTarget, DAILY_PROTEIN_MAX);

  return {
    preferences: adjusted,
    dailyProteinTarget: nextProteinTarget
  };
};

