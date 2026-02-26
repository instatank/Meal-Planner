export const CORE_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
export const DAILY_PROTEIN_MIN = 105;
export const DAILY_PROTEIN_MAX = 140;
export const DEFAULT_DAILY_PROTEIN_TARGET = 120;
export const DAILY_CARB_HARD_CAP = 130;
export const MIN_MEAL_PROTEIN = 20;
export const CARB_HEAVY_THRESHOLD = 55;
export const FAT_HEAVY_THRESHOLD = 25;
export const PROTEIN_BALANCE_MAX_GAP = 40;

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

const hashString = (input) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getRecentMealCounts = (plans, dateKey, lookbackDays = 10) => {
  const counts = {
    breakfast: {},
    lunch: {},
    dinner: {}
  };

  for (let i = 1; i <= lookbackDays; i += 1) {
    const key = shiftDateKey(dateKey, -i);
    const dayPlan = plans[key];
    if (!dayPlan) continue;

    for (const mealType of CORE_MEAL_TYPES) {
      const name = dayPlan[mealType]?.name;
      if (!name) continue;
      counts[mealType][name] = (counts[mealType][name] || 0) + 1;
    }
  }

  return counts;
};

const getDayTheme = (dateKey) => {
  const seed = hashString(dateKey);
  return {
    preferIndian: seed % 3 === 0,
    preferLowCarb: seed % 4 === 0,
    preferHighProtein: seed % 5 === 0
  };
};

const isCompletePlan = (plan) => CORE_MEAL_TYPES.every((mealType) => Boolean(plan[mealType]));

const getPlanMeals = (plan) => CORE_MEAL_TYPES.map((mealType) => plan[mealType]).filter(Boolean);

const getMealMacro = (meal, macroKey) => Number(meal?.macros?.[macroKey] || 0);

const getMealFamilyText = (meal) => `${meal?.components?.protein || ''} ${meal?.name || ''}`.toLowerCase();

const getMealNameText = (meal) => String(meal?.name || '').toLowerCase();

const getPrimaryProteinFamily = (meal) => {
  const text = getMealFamilyText(meal);
  if (FAMILY_TEST_PATTERNS.fish.test(text)) return 'fish';
  if (FAMILY_TEST_PATTERNS.chicken.test(text)) return 'chicken';
  if (FAMILY_TEST_PATTERNS['red-meat'].test(text)) return 'red-meat';
  return null;
};

const hasRepeatedPrimaryFamilyInsideMeal = (meal) => {
  const mealName = getMealNameText(meal);
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

const isHeavyMeal = (meal) => {
  const carbs = getMealMacro(meal, 'c');
  const fat = getMealMacro(meal, 'f');
  return (meal?.cal || 0) > 600 || (fat > 25 && carbs > 35);
};

const isCarbHeavyMeal = (meal) => getMealMacro(meal, 'c') >= CARB_HEAVY_THRESHOLD;

const isFatHeavyMeal = (meal) => getMealMacro(meal, 'f') > FAT_HEAVY_THRESHOLD;

const hasValidLunchDinnerCuisinePairing = (plan) => {
  const { lunch, dinner } = plan;
  if (!lunch || !dinner) return true;
  return (lunch.cuisine === 'indian') !== (dinner.cuisine === 'indian');
};

const hasValidLunchDinnerProteinPairing = (plan) => {
  const { lunch, dinner } = plan;
  if (!lunch || !dinner) return true;

  const lunchFamily = getPrimaryProteinFamily(lunch);
  const dinnerFamily = getPrimaryProteinFamily(dinner);

  if (!PRIMARY_PROTEIN_FAMILIES.has(lunchFamily) || !PRIMARY_PROTEIN_FAMILIES.has(dinnerFamily)) return true;
  return lunchFamily !== dinnerFamily;
};

const hasBalancedProteinDistribution = (plan) => {
  if (!isCompletePlan(plan)) return true;

  const proteinByMeal = CORE_MEAL_TYPES.map((mealType) => Number(plan[mealType]?.protein || 0));
  const minProtein = Math.min(...proteinByMeal);
  const maxProtein = Math.max(...proteinByMeal);

  return maxProtein - minProtein <= PROTEIN_BALANCE_MAX_GAP;
};

const satisfiesHardConstraints = (plan) => {
  const meals = getPlanMeals(plan);
  const totalProtein = meals.reduce((sum, meal) => sum + Number(meal?.protein || 0), 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + getMealMacro(meal, 'c'), 0);

  if (meals.some((meal) => Number(meal?.protein || 0) < MIN_MEAL_PROTEIN)) return false;
  if (meals.some(hasRepeatedPrimaryFamilyInsideMeal)) return false;
  if (meals.some((meal) => isMeatMeal(meal) && getMealFibreScore(meal) < 1)) return false;

  if (!hasValidLunchDinnerCuisinePairing(plan)) return false;
  if (!hasValidLunchDinnerProteinPairing(plan)) return false;

  if (meals.filter(isHeavyMeal).length > 1) return false;
  if (meals.filter(isCarbHeavyMeal).length > 1) return false;
  if (meals.filter(isFatHeavyMeal).length > 1) return false;

  if (totalCarbs > DAILY_CARB_HARD_CAP) return false;
  if (totalProtein > DAILY_PROTEIN_MAX) return false;

  if (!isCompletePlan(plan)) return true;

  if (totalProtein < DAILY_PROTEIN_MIN) return false;
  if (!hasBalancedProteinDistribution(plan)) return false;

  return true;
};

const serializePlanKey = (plan) => CORE_MEAL_TYPES.map((mealType) => plan[mealType]?.name || '_').join('|');

const canCompletePlanWithHardConstraints = ({ plan, mealDatabase, cache }) => {
  const cacheKey = serializePlanKey(plan);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  if (!satisfiesHardConstraints(plan)) {
    cache.set(cacheKey, false);
    return false;
  }

  const nextMealType = CORE_MEAL_TYPES.find((mealType) => !plan[mealType]);
  if (!nextMealType) {
    cache.set(cacheKey, true);
    return true;
  }

  const nextCandidates = getMealsForType(mealDatabase, nextMealType);
  for (const candidate of nextCandidates) {
    const candidatePlan = {
      ...plan,
      [nextMealType]: candidate
    };
    if (canCompletePlanWithHardConstraints({ plan: candidatePlan, mealDatabase, cache })) {
      cache.set(cacheKey, true);
      return true;
    }
  }

  cache.set(cacheKey, false);
  return false;
};

const scoreMealCandidate = ({
  meal,
  mealType,
  dateKey,
  preferences,
  partialPlan,
  remainingProteinTarget,
  recentCounts,
  dayTheme,
  yesterdayPlan
}) => {
  const accepts = preferences?.accepts || {};
  const avoids = preferences?.avoids || {};
  const edits = preferences?.edits || {};
  const mealName = meal.name;

  let score = 0;

  score += Math.min((accepts[mealName] || 0) * 0.8, 5);
  score += Math.min((edits[mealName] || 0) * 0.35, 2);
  score -= Math.min((avoids[mealName] || 0) * 0.95, 5);

  const proteinNeed = Math.max(remainingProteinTarget, 0);
  if (proteinNeed > 0) score += Math.min(meal.protein, proteinNeed) * 0.24;
  score += meal.protein * 0.03;

  if (mealType !== 'breakfast') {
    score -= (meal.cal || 0) / 650;
  }

  const isLowCarb = meal.components?.carb === 'No carb';
  if (dayTheme.preferLowCarb) score += isLowCarb ? 2.2 : -0.6;
  if (dayTheme.preferIndian && meal.cuisine === 'indian') score += 1.8;
  if (dayTheme.preferHighProtein && meal.protein >= 40) score += 1.4;

  if (mealType === 'dinner' && partialPlan.lunch?.cuisine) {
    if (meal.cuisine === partialPlan.lunch.cuisine) score -= 1.5;
    else score += 0.8;
  }

  const tieKey = `${dateKey}-${mealType}-${mealName}`;
  const tieBreaker = (hashString(tieKey) % 100) / 1000;
  score += tieBreaker;

  return score;
};

const pickMealForType = ({
  mealType,
  dateKey,
  preferences,
  partialPlan,
  remainingProteinTarget,
  recentCounts,
  dayTheme,
  yesterdayPlan,
  mealDatabase,
  hardConstraintCache
}) => {
  const candidates = getMealsForType(mealDatabase, mealType);
  const constrainedCandidates = candidates.filter((meal) => {
    const candidatePlan = {
      ...partialPlan,
      [mealType]: meal
    };
    return canCompletePlanWithHardConstraints({
      plan: candidatePlan,
      mealDatabase,
      cache: hardConstraintCache
    });
  });

  const scoringCandidates = constrainedCandidates.length > 0 ? constrainedCandidates : candidates;

  let bestMeal = scoringCandidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const meal of scoringCandidates) {
    const score = scoreMealCandidate({
      meal,
      mealType,
      dateKey,
      preferences,
      partialPlan,
      remainingProteinTarget,
      recentCounts,
      dayTheme,
      yesterdayPlan
    });
    if (score > bestScore) {
      bestScore = score;
      bestMeal = meal;
    }
  }

  return bestMeal;
};

export const generatePlanForDate = ({
  dateKey,
  plans = {},
  preferences = {},
  mealDatabase,
  dailyProteinTarget = DEFAULT_DAILY_PROTEIN_TARGET
}) => {
  const normalizedPreferences = normalizePreferences(preferences);
  const dayTheme = getDayTheme(dateKey);
  const recentCounts = getRecentMealCounts(plans, dateKey, 10);
  const yesterdayPlan = plans[shiftDateKey(dateKey, -1)] || null;
  const hardConstraintCache = new Map();

  const parsedProteinTarget = Number(dailyProteinTarget);
  const clampedProteinTarget = Number.isFinite(parsedProteinTarget)
    ? Math.min(DAILY_PROTEIN_MAX, Math.max(DAILY_PROTEIN_MIN, parsedProteinTarget))
    : DEFAULT_DAILY_PROTEIN_TARGET;

  let remainingProtein = clampedProteinTarget;
  const generated = {};

  generated.breakfast = pickMealForType({
    mealType: 'breakfast',
    dateKey,
    preferences: normalizedPreferences,
    partialPlan: generated,
    remainingProteinTarget: Math.min(remainingProtein, 35),
    recentCounts,
    dayTheme,
    yesterdayPlan,
    mealDatabase,
    hardConstraintCache
  });

  remainingProtein -= generated.breakfast?.protein || 0;

  generated.lunch = pickMealForType({
    mealType: 'lunch',
    dateKey,
    preferences: normalizedPreferences,
    partialPlan: generated,
    remainingProteinTarget: Math.max(remainingProtein, 35),
    recentCounts,
    dayTheme,
    yesterdayPlan,
    mealDatabase,
    hardConstraintCache
  });

  remainingProtein -= generated.lunch?.protein || 0;

  generated.dinner = pickMealForType({
    mealType: 'dinner',
    dateKey,
    preferences: normalizedPreferences,
    partialPlan: generated,
    remainingProteinTarget: Math.max(remainingProtein, 25),
    recentCounts,
    dayTheme,
    yesterdayPlan,
    mealDatabase,
    hardConstraintCache
  });

  if (
    yesterdayPlan &&
    CORE_MEAL_TYPES.every((mealType) => generated[mealType]?.name && generated[mealType]?.name === yesterdayPlan[mealType]?.name)
  ) {
    const lunchOptions = getMealsForType(mealDatabase, 'lunch');
    const alternateLunches = lunchOptions.filter((meal) => {
      if (meal.name === generated.lunch?.name) return false;
      return satisfiesHardConstraints({
        ...generated,
        lunch: meal
      });
    });
    if (alternateLunches.length > 0) {
      const altIdx = hashString(dateKey) % alternateLunches.length;
      generated.lunch = alternateLunches[altIdx];
    }
  }

  const finalPlan = {
    breakfast: generated.breakfast || getMealsForType(mealDatabase, 'breakfast')[0],
    lunch: generated.lunch || getMealsForType(mealDatabase, 'lunch')[0],
    dinner: generated.dinner || getMealsForType(mealDatabase, 'dinner')[0]
  };

  if (satisfiesHardConstraints(finalPlan)) return finalPlan;

  if (
    canCompletePlanWithHardConstraints({
      plan: {},
      mealDatabase,
      cache: hardConstraintCache
    })
  ) {
    let recovery = {};
    for (const mealType of CORE_MEAL_TYPES) {
      const options = getMealsForType(mealDatabase, mealType);
      const next = options.find((meal) =>
        canCompletePlanWithHardConstraints({
          plan: {
            ...recovery,
            [mealType]: meal
          },
          mealDatabase,
          cache: hardConstraintCache
        })
      );
      if (!next) break;
      recovery = {
        ...recovery,
        [mealType]: next
      };
    }
    if (isCompletePlan(recovery) && satisfiesHardConstraints(recovery)) return recovery;
  }

  return finalPlan;
};
