/**
 * plannerGenerator.js — the deterministic single-day generator.
 *
 * Runs on goal change, onboarding, and when backfilling a past day that has no
 * plan. It used to carry its own copy of every threshold, which disagreed with
 * the copy in the constraint filter — the same app produced plans under two
 * rulebooks depending on which button you pressed. Every limit now comes from
 * `rules.js`.
 *
 * Under the "aim daily, judge weekly" model this generator *aims* at the daily
 * protein band but does not treat it as a hard constraint: the only per-day
 * hard rules are Tier 1 (per-meal protein floor, no meal twice in a day, the
 * 50g sanity floor, and heavily-avoided meals). Everything else — band
 * proximity, the carb cap, calorie bounds, variety, cuisine and fibre — is
 * Tier 3 scoring. A week's soundness is enforced by the week optimizer and the
 * validator, not by rejecting individual days here.
 */

import {
  CARB_HEAVY_THRESHOLD,
  FAT_HEAVY_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  PROTEIN_BALANCE_MAX_GAP,
  getRules,
  getRulesForProfile
} from './rules.js';

export const CORE_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

export { CARB_HEAVY_THRESHOLD, FAT_HEAVY_THRESHOLD, HEAVY_MEAL_CALORIES, PROTEIN_BALANCE_MAX_GAP };

// Back-compat numeric exports. These are the *default* high-protein figures;
// anything that cares about a specific goal or protein target should call
// `getRules` rather than reading these.
const DEFAULT_RULES = getRules('high_protein', { dailyProteinTarget: 120 });

export const DEFAULT_DAILY_PROTEIN_TARGET = DEFAULT_RULES.dailyProteinTarget;
export const DAILY_PROTEIN_MIN = DEFAULT_RULES.budgeted.dailyProteinMin;
export const DAILY_PROTEIN_MAX = DEFAULT_RULES.budgeted.dailyProteinMax;
export const DAILY_PROTEIN_SANITY_FLOOR = DEFAULT_RULES.hard.dailyProteinSanityFloor;
export const DAILY_CARB_HARD_CAP = DEFAULT_RULES.budgeted.dailyCarbCap;
export const MIN_MEAL_PROTEIN = DEFAULT_RULES.hard.minMealProtein;

// ─── Meal accessors ─────────────────────────────────────────────────────────

const PRIMARY_PROTEIN_FAMILIES = new Set(['fish', 'chicken', 'red-meat']);

const FAMILY_TEST_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawn|shrimp)\b/i,
  chicken: /\b(chicken|turkey)\b/i,
  'red-meat': /\b(beef|mutton|lamb|pork|steak|keema|kofta)\b/i
};

const FAMILY_COUNT_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawn|shrimp)\b/gi,
  chicken: /\b(chicken|turkey)\b/gi,
  'red-meat': /\b(beef|mutton|lamb|pork|steak|keema|kofta)\b/gi
};

const LEGUME_FIBRE_PATTERN = /\b(dal|rajma|chole|lentil|bean|sambar)\b/i;
const VEG_FIBRE_PATTERN = /\b(salad|greens|broccoli|gobi|veg|vegetable|pumpkin|matar|saag)\b/i;
const WHOLEGRAIN_FIBRE_PATTERN = /\b(jowar|millet|whole|oat)\b/i;

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

const getMealName = (meal) => String(meal?.name || meal?.canonical_name || '');
const getMealProtein = (meal) => Number(meal?.protein ?? meal?.macros?.p ?? 0);
const getMealMacro = (meal, macroKey) => Number(meal?.macros?.[macroKey] || 0);
const getMealCalories = (meal) => Number(meal?.cal || 0);

const getMealFamilyText = (meal) => `${meal?.components?.protein || ''} ${meal?.name || ''}`.toLowerCase();

const getPrimaryProteinFamily = (meal) => {
  const text = getMealFamilyText(meal);
  if (FAMILY_TEST_PATTERNS.fish.test(text)) return 'fish';
  if (FAMILY_TEST_PATTERNS.chicken.test(text)) return 'chicken';
  if (FAMILY_TEST_PATTERNS['red-meat'].test(text)) return 'red-meat';
  return null;
};

const hasRepeatedPrimaryFamilyInsideMeal = (meal) => {
  const mealName = String(meal?.name || '').toLowerCase();
  return Object.values(FAMILY_COUNT_PATTERNS).some((pattern) => {
    const matches = mealName.match(pattern);
    return (matches?.length || 0) >= 2;
  });
};

const getMealFibreScore = (meal) => {
  const text = `${meal?.name || ''} ${meal?.components?.carb || ''} ${meal?.components?.veg || ''}`.toLowerCase();
  let score = 0;
  if (LEGUME_FIBRE_PATTERN.test(text)) score += 2;
  if (VEG_FIBRE_PATTERN.test(text)) score += 1;
  if (WHOLEGRAIN_FIBRE_PATTERN.test(text)) score += 1;
  return score;
};

const isMeatMeal = (meal) => PRIMARY_PROTEIN_FAMILIES.has(getPrimaryProteinFamily(meal));
const isHeavyMeal = (meal) =>
  getMealCalories(meal) > HEAVY_MEAL_CALORIES ||
  (getMealMacro(meal, 'f') > FAT_HEAVY_THRESHOLD && getMealMacro(meal, 'c') > 35);
const isCarbHeavyMeal = (meal) => getMealMacro(meal, 'c') >= CARB_HEAVY_THRESHOLD;
const isFatHeavyMeal = (meal) => getMealMacro(meal, 'f') > FAT_HEAVY_THRESHOLD;
const hasFibre = (meal) => Boolean(meal?.has_fibre) || getMealFibreScore(meal) > 0;

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
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return new Date(Number.NaN);
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

export const hashString = (input) => {
  let hash = 0;
  for (let i = 0; i < String(input).length; i += 1) {
    hash = (hash << 5) - hash + String(input).charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getRecentMealCounts = (plans, dateKey, lookbackDays = 10) => {
  const counts = {};
  for (let i = 1; i <= lookbackDays; i += 1) {
    const key = shiftDateKey(dateKey, -i);
    const dayPlan = plans?.[key];
    if (!dayPlan) continue;
    for (const mealType of CORE_MEAL_TYPES) {
      const name = getMealName(dayPlan[mealType]);
      if (!name) continue;
      // Recency-weighted: yesterday's repeat stings more than last week's.
      counts[name] = (counts[name] || 0) + Math.max(0.2, 1 - (i - 1) / lookbackDays);
    }
  }
  return counts;
};

// ─── Tier 1 — hard constraints, per day ─────────────────────────────────────

/**
 * Is this meal admissible in this slot at all? Tier 1 only.
 */
export const isMealAdmissible = (meal, { rules, preferences }) => {
  if (!meal) return false;
  if (getMealProtein(meal) < rules.hard.minMealProtein) return false;
  const avoidScore = Number(preferences?.avoids?.[getMealName(meal)] || 0);
  if (avoidScore > rules.hard.avoidScoreExclusiveMax) return false;
  return true;
};

/**
 * Tier-1 check for a complete day. Deliberately short: the daily protein band,
 * the carb cap and the calorie bounds are Tier 2 (budgeted across the week),
 * not grounds to reject a single day.
 */
export const satisfiesDayHardConstraints = (day, { rules, preferences }) => {
  const meals = CORE_MEAL_TYPES.map((slot) => day?.[slot]);
  if (meals.some((meal) => !meal)) return false;
  if (meals.some((meal) => !isMealAdmissible(meal, { rules, preferences }))) return false;

  const names = meals.map(getMealName);
  const uniqueNames = new Set(names);
  if (uniqueNames.size < names.length) {
    // maxSameMealPerDay of 1 means every slot must hold a distinct meal.
    const maxPerDay = rules.hard.maxSameMealPerDay;
    for (const name of uniqueNames) {
      if (names.filter((n) => n === name).length > maxPerDay) return false;
    }
  }

  const totalProtein = meals.reduce((sum, meal) => sum + getMealProtein(meal), 0);
  if (totalProtein < rules.hard.dailyProteinSanityFloor) return false;

  return true;
};

export const summariseDay = (day) => {
  const meals = CORE_MEAL_TYPES.map((slot) => day?.[slot]).filter(Boolean);
  return {
    protein: meals.reduce((sum, meal) => sum + getMealProtein(meal), 0),
    carbs: meals.reduce((sum, meal) => sum + getMealMacro(meal, 'c'), 0),
    fat: meals.reduce((sum, meal) => sum + getMealMacro(meal, 'f'), 0),
    calories: meals.reduce((sum, meal) => sum + getMealCalories(meal), 0)
  };
};

// ─── Tier 3 — scoring ───────────────────────────────────────────────────────

/**
 * Rank a complete, Tier-1-legal day. Higher is better. Never rejects.
 */
export const scoreDay = (day, { rules, preferences = {}, recentCounts = {}, dateKey = '' }) => {
  const weights = rules.scored;
  const meals = CORE_MEAL_TYPES.map((slot) => day[slot]);
  const totals = summariseDay(day);
  let score = 0;

  // Aim daily: proximity to the protein target, with a cliff outside the band.
  const { dailyProteinMin, dailyProteinMax, dailyCarbCap, dailyCalorieMin, dailyCalorieMax } = rules.budgeted;
  if (totals.protein < dailyProteinMin) {
    score -= weights.outOfBandPenalty + (dailyProteinMin - totals.protein) * weights.proteinProximity;
  } else if (totals.protein > dailyProteinMax) {
    score -= weights.outOfBandPenalty + (totals.protein - dailyProteinMax) * weights.proteinProximity;
  } else {
    score -= Math.abs(totals.protein - rules.dailyProteinTarget) * weights.proteinProximity * 0.25;
  }

  if (Number.isFinite(dailyCarbCap) && totals.carbs > dailyCarbCap) {
    score -= (totals.carbs - dailyCarbCap) * weights.carbOverCapPenalty;
  }
  if (totals.calories < dailyCalorieMin) {
    score -= (dailyCalorieMin - totals.calories) * weights.calorieOutOfBoundsPenalty;
  } else if (totals.calories > dailyCalorieMax) {
    score -= (totals.calories - dailyCalorieMax) * weights.calorieOutOfBoundsPenalty;
  }

  // Dinner tapering — calorie-based and scored, never a hard exclusion.
  if (totals.calories > 0) {
    const dinnerShare = getMealCalories(day.dinner) / totals.calories;
    if (dinnerShare > weights.dinnerCalorieShareTarget) {
      score -= (dinnerShare - weights.dinnerCalorieShareTarget) * weights.dinnerTaperPenalty * 10;
    }
  }

  // Protein-family diversity within the day.
  const families = meals.map(getPrimaryProteinFamily).filter(Boolean);
  const familyCounts = {};
  for (const family of families) familyCounts[family] = (familyCounts[family] || 0) + 1;
  for (const count of Object.values(familyCounts)) {
    if (count > 1) score -= (count - 1) * weights.sameProteinFamilyTwiceInDayPenalty;
  }

  // Lunch and dinner should not read as the same meal twice.
  if (day.lunch?.cuisine && day.dinner?.cuisine && day.lunch.cuisine === day.dinner.cuisine) {
    score -= weights.lunchDinnerCuisineClashPenalty;
  }

  // Fibre presence, and the old "meat meals should carry fibre" preference.
  score += meals.filter(hasFibre).length * weights.fibreBonus;
  score -= meals.filter((meal) => isMeatMeal(meal) && getMealFibreScore(meal) < 1).length * weights.fibreBonus;

  // Meal-shape balance: these were hard rules in the old generator and are now
  // preferences, so a legitimate treat day is possible.
  score -= Math.max(0, meals.filter(isHeavyMeal).length - 1) * weights.fibreBonus * 2;
  score -= Math.max(0, meals.filter(isCarbHeavyMeal).length - 1) * weights.fibreBonus * 2;
  score -= Math.max(0, meals.filter(isFatHeavyMeal).length - 1) * weights.fibreBonus * 2;
  score -= meals.filter(hasRepeatedPrimaryFamilyInsideMeal).length * weights.sameProteinFamilyTwiceInDayPenalty;

  const proteinValues = meals.map(getMealProtein);
  const proteinGap = Math.max(...proteinValues) - Math.min(...proteinValues);
  if (proteinGap > PROTEIN_BALANCE_MAX_GAP) {
    score -= (proteinGap - PROTEIN_BALANCE_MAX_GAP) * 0.15;
  }

  // User preference signal.
  const accepts = preferences.accepts || {};
  const edits = preferences.edits || {};
  const avoids = preferences.avoids || {};
  for (const meal of meals) {
    const name = getMealName(meal);
    score += Math.min(Number(accepts[name] || 0), 4) * weights.preferenceAcceptWeight;
    score += Math.min(Number(edits[name] || 0), 3) * weights.preferenceEditWeight;
    score -= Math.min(Number(avoids[name] || 0), 4) * weights.preferenceAvoidWeight;
  }

  // Anti-greedy: prefer meals the recent history has not just served.
  for (const meal of meals) {
    score -= Number(recentCounts[getMealName(meal)] || 0) * weights.historyRepeatPenalty;
  }

  // Deterministic tie-break so identical scores resolve the same way forever.
  const tieKey = `${dateKey}|${meals.map(getMealName).join('|')}`;
  score += (hashString(tieKey) % 1000) / 100000;

  return score;
};

// ─── Day enumeration ────────────────────────────────────────────────────────

/**
 * Every Tier-1-legal breakfast/lunch/dinner combination for one date.
 *
 * The catalog is small (5 legal breakfasts x 26 lunch/dinner meals gives a few
 * thousand combinations), so exhaustive enumeration is both viable and far
 * simpler to reason about than the old slot-by-slot filter — which never
 * committed a slot and so left five of its ten rules as dead code.
 */
export const enumerateFeasibleDays = ({ mealDatabase, rules, preferences = {} }) => {
  const breakfasts = getMealsForType(mealDatabase, 'breakfast')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences }));
  const lunchDinners = getMealsForType(mealDatabase, 'lunch')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences }));

  const days = [];
  for (const breakfast of breakfasts) {
    for (const lunch of lunchDinners) {
      for (const dinner of lunchDinners) {
        const day = { breakfast, lunch, dinner };
        if (!satisfiesDayHardConstraints(day, { rules, preferences })) continue;
        days.push({ ...day, totals: summariseDay(day) });
      }
    }
  }
  return days;
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build one day's plan deterministically.
 *
 * @param {Object} params
 * @param {string} params.dateKey        YYYY-MM-DD
 * @param {Object} params.plans          existing plans by date, for anti-repeat
 * @param {Object} params.preferences    { accepts, avoids, edits, skips }
 * @param {Object} params.mealDatabase   { breakfast, lunchDinner, snack }
 * @param {string} [params.goal]         defaults to high_protein
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
  const recentCounts = getRecentMealCounts(plans, dateKey, 10);

  const candidates = enumerateFeasibleDays({ mealDatabase, rules, preferences: normalizedPreferences });

  if (candidates.length === 0) {
    // Nothing satisfies Tier 1 — hand back the least-bad complete plan we can
    // assemble rather than nothing at all. The validator will flag it.
    return createDefaultPlan(mealDatabase);
  }

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreDay(candidate, {
      rules,
      preferences: normalizedPreferences,
      recentCounts,
      dateKey
    });
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
