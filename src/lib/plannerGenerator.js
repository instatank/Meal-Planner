/**
 * plannerGenerator.js — the deterministic single-day generator.
 *
 * Runs on goal change, onboarding, and when backfilling a past day that has no
 * plan. It used to carry its own copy of every threshold plus its own idea of
 * what a valid day was, which disagreed with the constraint filter's — the
 * same app produced plans under two rulebooks depending on which button you
 * pressed.
 *
 * It is now a thin facade over the shared engine: limits come from `rules.js`,
 * and enumeration/scoring come from `planOptimizer.js`, which is the same code
 * the week search and the validator use. The only thing this module adds is
 * "score one date against recent history and return the winner".
 */

import {
  CARB_HEAVY_THRESHOLD,
  FAT_HEAVY_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  PROTEIN_BALANCE_MAX_GAP,
  getRules,
  getRulesForProfile
} from './rules.js';
import {
  buildHistoryCounts,
  enumerateFeasibleDays,
  getMealName,
  hashString,
  isMealAdmissible,
  satisfiesDayHardConstraints,
  scoreDayStandalone,
  summariseDay
} from './planOptimizer.js';

export const CORE_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

export { CARB_HEAVY_THRESHOLD, FAT_HEAVY_THRESHOLD, HEAVY_MEAL_CALORIES, PROTEIN_BALANCE_MAX_GAP };
export { enumerateFeasibleDays, isMealAdmissible, satisfiesDayHardConstraints, summariseDay, hashString };

// Back-compat numeric exports. These are the figures for the *default* protein
// target; anything that cares about a specific goal or target must call
// `getRules` rather than reading these.
const DEFAULT_RULES = getRules('high_protein', { dailyProteinTarget: 120 });

export const DEFAULT_DAILY_PROTEIN_TARGET = DEFAULT_RULES.dailyProteinTarget;
export const DAILY_PROTEIN_MIN = DEFAULT_RULES.budgeted.dailyProteinMin;
export const DAILY_PROTEIN_MAX = DEFAULT_RULES.budgeted.dailyProteinMax;
export const DAILY_PROTEIN_SANITY_FLOOR = DEFAULT_RULES.hard.dailyProteinSanityFloor;
export const DAILY_CARB_HARD_CAP = DEFAULT_RULES.budgeted.dailyCarbCap;
export const MIN_MEAL_PROTEIN = DEFAULT_RULES.hard.minMealProtein;

export const normalizePreferences = (prefs = {}) => ({
  accepts: prefs.accepts || {},
  avoids: prefs.avoids || {},
  edits: prefs.edits || {},
  skips: prefs.skips || {}
});

export const getMealsForType = (mealDatabase, mealType) => {
  if (mealType === 'lunch' || mealType === 'dinner') return mealDatabase?.lunchDinner || [];
  return mealDatabase?.[mealType] || [];
};

export const createDefaultPlan = (mealDatabase) => ({
  breakfast: getMealsForType(mealDatabase, 'breakfast')[0],
  lunch: getMealsForType(mealDatabase, 'lunch')[0],
  dinner: getMealsForType(mealDatabase, 'dinner')[0]
});

// ─── Date helpers ───────────────────────────────────────────────────────────

const formatDateKeyFromUtcDate = (date) => {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey) => {
  const matches = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!matches) {
    const parsed = new Date(dateKey);
    return Number.isNaN(parsed.getTime()) ? new Date(Number.NaN) : parsed;
  }
  const [, year, month, day] = matches;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

const shiftDateKey = (dateKey, offsetDays) => {
  const date = parseDateKey(dateKey);
  if (Number.isNaN(date.getTime())) return formatDateKeyFromUtcDate(new Date());
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDateKeyFromUtcDate(date);
};

/** The `lookbackDays` days immediately before `dateKey` that have a plan. */
const collectRecentHistory = (plans, dateKey, lookbackDays) => {
  const recent = {};
  for (let i = lookbackDays; i >= 1; i -= 1) {
    const key = shiftDateKey(dateKey, -i);
    if (plans?.[key]) recent[key] = plans[key];
  }
  return recent;
};

// ─── Public API ─────────────────────────────────────────────────────────────

const HISTORY_LOOKBACK_DAYS = 10;

/**
 * Build one day's plan deterministically.
 *
 * Enumerates every Tier-1-legal combination and returns the best-scoring one.
 * The daily protein band is an aim, not a gate: a day that cannot reach the
 * band still gets the closest legal plan rather than a rejection.
 *
 * @param {Object} params
 * @param {string} params.dateKey        YYYY-MM-DD
 * @param {Object} params.plans          existing plans by date, for anti-repeat
 * @param {Object} params.preferences    { accepts, avoids, edits, skips }
 * @param {Object} params.mealDatabase   { breakfast, lunchDinner, snack }
 * @param {string} [params.goal]         unset falls back to high_protein; a
 *                                       chosen-but-unimplemented goal throws
 * @param {number} [params.dailyProteinTarget]
 */
export const generatePlanForDate = ({
  dateKey,
  plans = {},
  preferences = {},
  mealDatabase,
  goal,
  dailyProteinTarget = DEFAULT_DAILY_PROTEIN_TARGET
}) => {
  const rules = getRulesForProfile(goal, { dailyProteinTarget });
  const normalizedPreferences = normalizePreferences(preferences);

  const candidates = enumerateFeasibleDays({
    mealDatabase,
    rules,
    preferences: normalizedPreferences
  });

  if (candidates.length === 0) {
    // Nothing clears Tier 1 for this catalog. Hand back a complete plan anyway
    // so the UI has something to render; the validator surfaces the problem.
    return createDefaultPlan(mealDatabase);
  }

  const historyCounts = buildHistoryCounts(
    collectRecentHistory(plans, dateKey, HISTORY_LOOKBACK_DAYS),
    { lookbackDays: HISTORY_LOOKBACK_DAYS }
  );

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const historyPenalty = candidate.mealNames.reduce(
      (sum, name) => sum + Number(historyCounts[name] || 0) * rules.scored.historyRepeatPenalty,
      0
    );
    // Deterministic tie-break so identical scores resolve the same way forever.
    const tieBreak = (hashString(`${dateKey}|${candidate.mealNames.join('|')}`) % 1000) / 100000;
    const score = scoreDayStandalone(candidate, { rules, preferences: normalizedPreferences })
      - historyPenalty
      + tieBreak;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return {
    breakfast: best.breakfast,
    lunch: best.lunch,
    dinner: best.dinner
  };
};

export { getMealName, shiftDateKey };
