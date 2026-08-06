/**
 * planOptimizer.js — the scored search over whole days, then whole weeks.
 *
 * Replaces `constraintFilter.js`, which produced three independent per-slot
 * shortlists and never committed a slot before filtering the next one. Because
 * `dayPlanSoFar` stayed empty, every running total it computed was zero and
 * five of its ten rules were dead code: measured lunch yield was 26/26.
 *
 * The shape here follows from the budgeted-constraint model. A pure filter
 * cannot express "at most 2 of 7 days may miss the band", because that is a
 * property of the week, not of a candidate meal. So instead:
 *
 *   1. Enumerate every Tier-1-legal breakfast/lunch/dinner combination.
 *      The catalog is small enough that this is exhaustive, not sampled.
 *   2. Score each day against Tier 2 (in band or not) and Tier 3 (quality).
 *   3. Beam-search 7 days, pruning any partial week that has already blown a
 *      Tier-2 budget or can no longer reach the weekly protein floor.
 *
 * Deterministic and seedable: same inputs always give the same week.
 */

import {
  CARB_HEAVY_THRESHOLD,
  FAT_HEAVY_THRESHOLD,
  FIBRE_MEAL_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  PROTEIN_BALANCE_MAX_GAP,
  requiredCompliantDays,
  weeklyProteinFloor
} from './rules.js';

export const CORE_SLOTS = ['breakfast', 'lunch', 'dinner'];

// ─── Meal accessors ─────────────────────────────────────────────────────────

export const getMealName = (meal) => String(meal?.name || meal?.canonical_name || '');
export const getMealProtein = (meal) => Number(meal?.protein ?? meal?.macros?.p ?? 0);
export const getMealCarbs = (meal) => Number(meal?.macros?.c || 0);
export const getMealFat = (meal) => Number(meal?.macros?.f || 0);
export const getMealCalories = (meal) => Number(meal?.cal || 0);
export const getMealCuisine = (meal) => String(meal?.cuisine || '').toLowerCase();

// Keep these in step with `inferProteinFamily` in mealDataLayer.js — a fish
// the pattern does not know is silently classified `vegetarian`, which is how
// mackerel and sardines entered the catalog as vegetarian dishes. Same reason
// `prawn` needs the `s?`: `\bprawn\b` does not match "prawns" (no word
// boundary between "n" and its own plural "s"), which is how a millet-pasta
// dish with 150g of prawns in it got tagged vegetarian.
const FAMILY_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawns?|shrimp|mackerel|sardines?|anchov(y|ies))\b/i,
  chicken: /\b(chicken|turkey)\b/i,
  // No `keema`/`kofta` here — they name a preparation, not an animal, so
  // soya keema and veg kofta are vegetarian. `inferProteinFamily` in
  // mealDataLayer.js carries the nuanced version; this is only the fallback
  // for meals that arrive without tags.
  red_meat: /\b(beef|mutton|lamb|pork|steak|ham|goat|bacon)\b/i
};

const FAMILY_COUNT_PATTERNS = {
  fish: /\b(fish|salmon|tuna|cod|prawns?|shrimp|mackerel|sardines?|anchov(y|ies))\b/gi,
  chicken: /\b(chicken|turkey)\b/gi,
  red_meat: /\b(beef|mutton|lamb|pork|steak|goat|bacon)\b/gi
};

const LEGUME_FIBRE_PATTERN = /\b(dal|rajma|chole|lentil|bean|sambar)\b/i;
const VEG_FIBRE_PATTERN = /\b(salad|greens|broccoli|gobi|veg|vegetable|pumpkin|matar|saag)\b/i;
const WHOLEGRAIN_FIBRE_PATTERN = /\b(jowar|millet|whole|oat)\b/i;

/**
 * Primary protein family. Prefers the tag the data layer computed, falling
 * back to text matching for user-added or fixture meals that carry no tags.
 */
export const getProteinFamily = (meal) => {
  const tagged = meal?.tags?.protein_family || meal?.rule_metadata?.protein_family;
  if (tagged) return String(tagged);
  const text = `${meal?.components?.protein || ''} ${getMealName(meal)}`.toLowerCase();
  if (FAMILY_PATTERNS.fish.test(text)) return 'fish';
  if (FAMILY_PATTERNS.chicken.test(text)) return 'chicken';
  if (FAMILY_PATTERNS.red_meat.test(text)) return 'red_meat';
  return 'vegetarian';
};

export const isRedMeat = (meal) => getProteinFamily(meal) === 'red_meat';

const isPrimaryMeat = (meal) => ['fish', 'chicken', 'red_meat'].includes(getProteinFamily(meal));

const getFibreScore = (meal) => {
  const text = `${getMealName(meal)} ${meal?.components?.carb || ''} ${meal?.components?.veg || ''}`.toLowerCase();
  let score = 0;
  if (LEGUME_FIBRE_PATTERN.test(text)) score += 2;
  if (VEG_FIBRE_PATTERN.test(text)) score += 1;
  if (WHOLEGRAIN_FIBRE_PATTERN.test(text)) score += 1;
  return score;
};

/**
 * Catalog meals now carry rolled-up fibre in grams, so measure them. The name
 * heuristic below is the fallback for meals that carry no figure — test
 * fixtures and, until they compute real macros, user-added meals — and it
 * must not override a real measurement: "scrambled eggs + toast" matches the
 * wholegrain pattern on the word "whole" while carrying 1.9g of fibre.
 */
export const hasFibre = (meal) => {
  const grams = Number(meal?.macros?.fibre);
  if (Number.isFinite(grams)) return grams >= FIBRE_MEAL_THRESHOLD;
  return Boolean(meal?.has_fibre) || getFibreScore(meal) > 0;
};

const hasRepeatedFamilyInsideMeal = (meal) => {
  const name = getMealName(meal).toLowerCase();
  return Object.values(FAMILY_COUNT_PATTERNS).some((pattern) => (name.match(pattern)?.length || 0) >= 2);
};

const isHeavyMeal = (meal) =>
  getMealCalories(meal) > HEAVY_MEAL_CALORIES ||
  (getMealFat(meal) > FAT_HEAVY_THRESHOLD && getMealCarbs(meal) > 35);
const isCarbHeavyMeal = (meal) => getMealCarbs(meal) >= CARB_HEAVY_THRESHOLD;
const isFatHeavyMeal = (meal) => getMealFat(meal) > FAT_HEAVY_THRESHOLD;

// ─── Per-meal fact cache ────────────────────────────────────────────────────

/**
 * Everything above is a pure function of a single meal, but the search calls
 * them once per *combination*, not once per meal. A 99-meal catalog yields
 * ~114k day candidates, so `getProteinFamily` alone ran its regexes ~340k times
 * to answer 99 distinct questions.
 *
 * `mealFacts` computes each meal's derived properties once and hands the same
 * record back thereafter. The accessors above stay the public API — this is a
 * memo in front of them, not a second definition of them, so there is no way
 * for the two to disagree.
 *
 * Keyed by object identity, which assumes a meal is not mutated in place after
 * it has been scored. Nothing in the app does that: meals come from the static
 * catalog or from fixtures, and edits replace the object rather than patch it.
 */
const FACT_CACHE = new WeakMap();

const EMPTY_FACTS = {
  name: '', protein: 0, carbs: 0, fat: 0, calories: 0, cuisine: '',
  family: 'vegetarian', redMeat: false, primaryMeat: false,
  fibreScore: 0, fibre: false, heavy: false, carbHeavy: false, fatHeavy: false,
  repeatedFamily: false
};

export const mealFacts = (meal) => {
  if (!meal || typeof meal !== 'object') return EMPTY_FACTS;
  const cached = FACT_CACHE.get(meal);
  if (cached) return cached;

  const family = getProteinFamily(meal);
  const fibreScore = getFibreScore(meal);
  const facts = {
    name: getMealName(meal),
    protein: getMealProtein(meal),
    carbs: getMealCarbs(meal),
    fat: getMealFat(meal),
    calories: getMealCalories(meal),
    cuisine: getMealCuisine(meal),
    family,
    redMeat: family === 'red_meat',
    primaryMeat: family === 'fish' || family === 'chicken' || family === 'red_meat',
    fibreScore,
    fibre: hasFibre(meal),
    heavy: isHeavyMeal(meal),
    carbHeavy: isCarbHeavyMeal(meal),
    fatHeavy: isFatHeavyMeal(meal),
    repeatedFamily: hasRepeatedFamilyInsideMeal(meal)
  };
  FACT_CACHE.set(meal, facts);
  return facts;
};

export const getMealsForSlot = (mealDatabase, slot) => {
  if (slot === 'lunch' || slot === 'dinner' || slot === 'lunchDinner') return mealDatabase?.lunchDinner || [];
  return mealDatabase?.[slot] || [];
};

export const hashString = (input) => {
  const text = String(input);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// ─── Tier 1 — hard constraints ──────────────────────────────────────────────

/**
 * Is this meal admissible in this slot at all? Tier 1 only.
 *
 * Note what is deliberately absent: there is no dinner exclusion. The old
 * filter barred every `Heavy` meal from dinner on a hand-typed weight label,
 * which removed the three highest-protein dishes in the catalog from the goal
 * that needs them most. Tapering is scored, by calories, in `scoreDayStandalone`.
 */
export const isMealAdmissible = (meal, { rules, preferences = {} }) => {
  if (!meal) return false;
  if (getMealProtein(meal) < rules.hard.minMealProtein) return false;
  if (Number(preferences?.avoids?.[getMealName(meal)] || 0) > rules.hard.avoidScoreExclusiveMax) return false;
  return true;
};

export const summariseDay = (day) => {
  const meals = CORE_SLOTS.map((slot) => day?.[slot]).filter(Boolean);
  return {
    protein: meals.reduce((sum, meal) => sum + getMealProtein(meal), 0),
    carbs: meals.reduce((sum, meal) => sum + getMealCarbs(meal), 0),
    fat: meals.reduce((sum, meal) => sum + getMealFat(meal), 0),
    calories: meals.reduce((sum, meal) => sum + getMealCalories(meal), 0)
  };
};

/**
 * Tier-1 check for a complete day. Deliberately short: the protein band, the
 * carb cap and the calorie bounds are Tier 2 and are judged across the week.
 */
export const satisfiesDayHardConstraints = (day, { rules, preferences = {} }) => {
  const meals = CORE_SLOTS.map((slot) => day?.[slot]);
  if (meals.some((meal) => !meal)) return false;
  if (meals.some((mealForSlot) => !isMealAdmissible(mealForSlot, { rules, preferences }))) return false;

  const names = meals.map(getMealName);
  const counts = {};
  for (const name of names) {
    counts[name] = (counts[name] || 0) + 1;
    if (counts[name] > rules.hard.maxSameMealPerDay) return false;
  }

  if (summariseDay(day).protein < rules.hard.dailyProteinSanityFloor) return false;
  return true;
};

// ─── Day enumeration ────────────────────────────────────────────────────────

/**
 * Every Tier-1-legal breakfast/lunch/dinner combination.
 *
 * Exhaustive by design. For the 41-meal catalog this is a few thousand
 * combinations and takes single-digit milliseconds.
 */
/**
 * The "no meal twice in a day" cap, for the three names of one day.
 *
 * Equivalent to counting occurrences and rejecting any name that exceeds the
 * cap, which is what `satisfiesDayHardConstraints` does — but without building
 * a counts object per combination.
 */
const withinSameMealCap = (a, b, c, cap) => {
  const ab = a === b;
  const ac = a === c;
  if (ab && ac) return cap >= 3;
  if (ab || ac || b === c) return cap >= 2;
  return cap >= 1;
};

export const enumerateFeasibleDays = ({ mealDatabase, rules, preferences = {} }) => {
  const breakfasts = getMealsForSlot(mealDatabase, 'breakfast')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences }));
  const lunchDinners = getMealsForSlot(mealDatabase, 'lunch')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences }));

  // Both pools are already filtered for admissibility, so the per-meal half of
  // `satisfiesDayHardConstraints` is answered before the loop starts. What is
  // left that genuinely varies per combination is the same-meal cap and the
  // protein sanity floor, checked inline below. The rejected combinations no
  // longer allocate a day object on their way to being discarded.
  const { maxSameMealPerDay, dailyProteinSanityFloor } = rules.hard;
  const lunchDinnerFacts = lunchDinners.map(mealFacts);
  const days = [];

  for (const breakfast of breakfasts) {
    const b = mealFacts(breakfast);
    for (let lunchIndex = 0; lunchIndex < lunchDinners.length; lunchIndex += 1) {
      const l = lunchDinnerFacts[lunchIndex];
      // Hoisted out of the innermost loop: breakfast and lunch are fixed here.
      const pairProtein = b.protein + l.protein;
      const pairCarbs = b.carbs + l.carbs;
      const pairFat = b.fat + l.fat;
      const pairCalories = b.calories + l.calories;

      for (let dinnerIndex = 0; dinnerIndex < lunchDinners.length; dinnerIndex += 1) {
        const d = lunchDinnerFacts[dinnerIndex];
        if (!withinSameMealCap(b.name, l.name, d.name, maxSameMealPerDay)) continue;

        const protein = pairProtein + d.protein;
        if (protein < dailyProteinSanityFloor) continue;

        const totals = {
          protein,
          carbs: pairCarbs + d.carbs,
          fat: pairFat + d.fat,
          calories: pairCalories + d.calories
        };
        const day = { breakfast, lunch: lunchDinners[lunchIndex], dinner: lunchDinners[dinnerIndex] };
        days.push(annotateDay(day, rules, totals));
      }
    }
  }
  return days;
};

/**
 * Attach the Tier-2 verdicts and cached shape data a day is judged on.
 *
 * `totals` may be supplied by a caller that has already summed the day — the
 * enumeration above computes it incrementally — in which case this does not
 * re-walk the meals to derive it a second time.
 */
export const annotateDay = (day, rules, totals = null) => {
  const breakfast = mealFacts(day.breakfast);
  const lunch = mealFacts(day.lunch);
  const dinner = mealFacts(day.dinner);
  const resolvedTotals = totals || summariseDay(day);
  const { dailyProteinMin, dailyProteinMax, dailyCarbCap, dailyCalorieMin, dailyCalorieMax } = rules.budgeted;

  const mealNames = [breakfast.name, lunch.name, dinner.name];

  return {
    ...day,
    totals: resolvedTotals,
    mealNames,
    // Precomputed once here because the sort tie-breaker and the beam's
    // per-candidate hash both need it, and both used to rebuild it per call.
    nameKey: mealNames.join('|'),
    redMeatCount: (breakfast.redMeat ? 1 : 0) + (lunch.redMeat ? 1 : 0) + (dinner.redMeat ? 1 : 0),
    cuisines: [breakfast.cuisine, lunch.cuisine, dinner.cuisine],
    proteinInBand: resolvedTotals.protein >= dailyProteinMin && resolvedTotals.protein <= dailyProteinMax,
    underCarbCap: resolvedTotals.carbs <= dailyCarbCap,
    inCalorieBounds: resolvedTotals.calories >= dailyCalorieMin && resolvedTotals.calories <= dailyCalorieMax
  };
};

// ─── Tier 3 — day-level scoring ─────────────────────────────────────────────

/**
 * Score the parts of a day that do not depend on the rest of the week.
 * Higher is better; this never rejects.
 */
export const scoreDayStandalone = (day, { rules, preferences = {} }) => {
  const w = rules.scored;
  const breakfastFacts = mealFacts(day.breakfast);
  const lunchFacts = mealFacts(day.lunch);
  const dinnerFacts = mealFacts(day.dinner);
  const facts = [breakfastFacts, lunchFacts, dinnerFacts];
  const totals = day.totals || summariseDay(day);
  const { dailyProteinMin, dailyProteinMax, dailyCarbCap, dailyCalorieMin, dailyCalorieMax } = rules.budgeted;
  let score = 0;

  // Aim daily: proximity to the target, with a cliff outside the band.
  if (totals.protein < dailyProteinMin) {
    score -= w.outOfBandPenalty + (dailyProteinMin - totals.protein) * w.proteinProximity;
  } else if (totals.protein > dailyProteinMax) {
    score -= w.outOfBandPenalty + (totals.protein - dailyProteinMax) * w.proteinProximity;
  } else {
    score -= Math.abs(totals.protein - rules.dailyProteinTarget) * w.proteinProximity * 0.25;
  }

  if (Number.isFinite(dailyCarbCap) && totals.carbs > dailyCarbCap) {
    score -= (totals.carbs - dailyCarbCap) * w.carbOverCapPenalty;
  }
  if (totals.calories < dailyCalorieMin) {
    score -= (dailyCalorieMin - totals.calories) * w.calorieOutOfBoundsPenalty;
  } else if (totals.calories > dailyCalorieMax) {
    score -= (totals.calories - dailyCalorieMax) * w.calorieOutOfBoundsPenalty;
  }

  // Dinner tapering, by calories rather than by a hand-typed weight label.
  if (totals.calories > 0) {
    const dinnerShare = dinnerFacts.calories / totals.calories;
    if (dinnerShare > w.dinnerCalorieShareTarget) {
      score -= (dinnerShare - w.dinnerCalorieShareTarget) * w.dinnerTaperPenalty * 10;
    }
  }

  // One pass over the day's three meals, accumulating every count the rest of
  // the scoring needs. This was seven separate `filter`/`map` passes; the maths
  // is unchanged, but a day is now walked once instead of ten times.
  const familyCounts = {};
  let fibreCount = 0;
  let meatWithoutFibreCount = 0;
  let heavyCount = 0;
  let carbHeavyCount = 0;
  let fatHeavyCount = 0;
  let repeatedFamilyCount = 0;
  let maxProtein = -Infinity;
  let minProtein = Infinity;

  for (const meal of facts) {
    if (meal.primaryMeat) {
      familyCounts[meal.family] = (familyCounts[meal.family] || 0) + 1;
      if (meal.fibreScore < 1) meatWithoutFibreCount += 1;
    }
    if (meal.fibre) fibreCount += 1;
    if (meal.heavy) heavyCount += 1;
    if (meal.carbHeavy) carbHeavyCount += 1;
    if (meal.fatHeavy) fatHeavyCount += 1;
    if (meal.repeatedFamily) repeatedFamilyCount += 1;
    if (meal.protein > maxProtein) maxProtein = meal.protein;
    if (meal.protein < minProtein) minProtein = meal.protein;
  }

  // Protein-family diversity within the day.
  for (const count of Object.values(familyCounts)) {
    if (count > 1) score -= (count - 1) * w.sameProteinFamilyTwiceInDayPenalty;
  }

  // Lunch and dinner should not read as the same meal twice.
  if (lunchFacts.cuisine && dinnerFacts.cuisine && lunchFacts.cuisine === dinnerFacts.cuisine) {
    score -= w.lunchDinnerCuisineClashPenalty;
  }

  // Fibre presence, and the old "meat meals should carry fibre" preference.
  score += fibreCount * w.fibreBonus;
  score -= meatWithoutFibreCount * w.fibreBonus;

  // Meal-shape balance. These were hard rules once; as preferences they let a
  // genuine treat day exist without the engine refusing to produce one.
  score -= Math.max(0, heavyCount - 1) * w.fibreBonus * 2;
  score -= Math.max(0, carbHeavyCount - 1) * w.fibreBonus * 2;
  score -= Math.max(0, fatHeavyCount - 1) * w.fibreBonus * 2;
  score -= repeatedFamilyCount * w.sameProteinFamilyTwiceInDayPenalty;

  const gap = maxProtein - minProtein;
  if (gap > PROTEIN_BALANCE_MAX_GAP) score -= (gap - PROTEIN_BALANCE_MAX_GAP) * 0.15;

  // Kept as its own pass, accumulating into `score` in the original order:
  // floating-point addition is not associative, so batching these into a
  // subtotal can shift the last bits and flip a tie in the candidate sort.
  const accepts = preferences.accepts || {};
  const edits = preferences.edits || {};
  const avoids = preferences.avoids || {};
  for (const meal of facts) {
    const name = meal.name;
    score += Math.min(Number(accepts[name] || 0), 4) * w.preferenceAcceptWeight;
    score += Math.min(Number(edits[name] || 0), 3) * w.preferenceEditWeight;
    score -= Math.min(Number(avoids[name] || 0), 4) * w.preferenceAvoidWeight;
  }

  return score;
};

/**
 * Recency-weighted count of how often each meal appears in recent history.
 * Used as an anti-greedy penalty, never as an exclusion.
 */
export const buildHistoryCounts = (historyMap = {}, { lookbackDays = 14 } = {}) => {
  const dateKeys = Object.keys(historyMap).sort().slice(-lookbackDays);
  const counts = {};
  dateKeys.forEach((dateKey, index) => {
    const recency = Math.max(0.2, (index + 1) / dateKeys.length);
    for (const slot of CORE_SLOTS) {
      const name = getMealName(historyMap[dateKey]?.[slot]);
      if (!name) continue;
      counts[name] = (counts[name] || 0) + recency;
    }
  });
  return counts;
};

// ─── Week search ────────────────────────────────────────────────────────────

/**
 * Assign every candidate its standalone score less the history penalty.
 *
 * The week search and the shortlist builder both need exactly this number, and
 * both used to compute it independently over the whole candidate set — two full
 * scoring passes to answer the same question. Callers that need both now score
 * once and hand the result to each.
 *
 * The score is stamped on the candidate rather than returned in a parallel
 * wrapper object, which is what the search used to build: one throwaway object
 * per candidate, of which all but `maxCandidates` were discarded immediately.
 */
export const scoreCandidates = (candidates, { rules, preferences = {}, historyMap = {} }) => {
  const historyCounts = buildHistoryCounts(historyMap);
  const historyRepeatPenalty = rules.scored.historyRepeatPenalty;

  for (const candidate of candidates) {
    let historyPenalty = 0;
    for (const name of candidate.mealNames) {
      historyPenalty += Number(historyCounts[name] || 0) * historyRepeatPenalty;
    }
    candidate.baseScore = scoreDayStandalone(candidate, { rules, preferences }) - historyPenalty;
  }
  return candidates;
};

const DEFAULT_BEAM_WIDTH = 40;

/**
 * The three Tier-2 budgets, as (per-day verdict, running counter) pairs.
 * Everything that enforces "at most 2 of 7 days may miss this" iterates here.
 */
// Cap on how many day candidates the beam considers. Kept stratified rather
// than "top N by score", because the days that satisfy a rare budget (only ~20%
// of combinations reach the 1600 kcal floor) are not the highest-scoring ones
// and a naive trim deletes exactly the days the week needs.
const DEFAULT_MAX_CANDIDATES = 960;

const BUDGETS = [
  { flag: 'proteinInBand', counter: 'inBand' },
  { flag: 'underCarbCap', counter: 'underCarb' },
  { flag: 'inCalorieBounds', counter: 'inCalorieBounds' }
];

/**
 * Reduce the candidate pool to `maxCandidates`, keeping the best of each
 * budget-compliance class so no class is trimmed out of existence.
 */
const trimCandidatePool = (sortedCandidates, maxCandidates) => {
  if (sortedCandidates.length <= maxCandidates) return sortedCandidates;

  const perClass = Math.ceil(maxCandidates / 8);
  const classCounts = new Map();
  const kept = [];
  const keptSet = new Set();

  for (const candidate of sortedCandidates) {
    const key = `${candidate.proteinInBand ? 1 : 0}${candidate.underCarbCap ? 1 : 0}${candidate.inCalorieBounds ? 1 : 0}`;
    const count = classCounts.get(key) || 0;
    if (count >= perClass) continue;
    classCounts.set(key, count + 1);
    kept.push(candidate);
    keptSet.add(candidate);
  }

  // Backfill any unused budget with the next-best candidates overall.
  for (const candidate of sortedCandidates) {
    if (kept.length >= maxCandidates) break;
    if (!keptSet.has(candidate)) kept.push(candidate);
  }

  return kept.slice(0, maxCandidates);
};

const usageCap = (slot, rules) =>
  slot === 'breakfast' ? rules.hard.maxBreakfastRepeatsPerWeek : rules.hard.maxLunchDinnerRepeatsPerWeek;

const cloneUsage = (usage) => ({ breakfast: { ...usage.breakfast }, lunchDinner: { ...usage.lunchDinner } });

/**
 * Seed the week-level counters from days that are already fixed — locked days
 * inside the same week. Weekly repetition and the red-meat cap are counted
 * against the week being produced, which the old filter never did.
 */
const seedWeekState = (lockedDays, rules) => {
  const usage = { breakfast: {}, lunchDinner: {} };
  let redMeat = 0;
  for (const day of Object.values(lockedDays || {})) {
    if (!day) continue;
    const breakfastName = getMealName(day.breakfast);
    if (breakfastName) usage.breakfast[breakfastName] = (usage.breakfast[breakfastName] || 0) + 1;
    for (const slot of ['lunch', 'dinner']) {
      const name = getMealName(day[slot]);
      if (name) usage.lunchDinner[name] = (usage.lunchDinner[name] || 0) + 1;
    }
    redMeat += CORE_SLOTS.map((slot) => day[slot]).filter(Boolean).filter(isRedMeat).length;
  }
  return { usage, redMeat, cuisines: new Set(), distinct: new Set() };
};

const canPlaceDay = (state, candidate, rules) => {
  const breakfastName = candidate.mealNames[0];
  if ((state.usage.breakfast[breakfastName] || 0) + 1 > usageCap('breakfast', rules)) return false;

  const lunchName = candidate.mealNames[1];
  const dinnerName = candidate.mealNames[2];
  const cap = usageCap('lunch', rules);
  if ((state.usage.lunchDinner[lunchName] || 0) + 1 > cap) return false;
  const dinnerUsed = (state.usage.lunchDinner[dinnerName] || 0) + (dinnerName === lunchName ? 1 : 0);
  if (dinnerUsed + 1 > cap) return false;

  if (state.redMeat + candidate.redMeatCount > rules.hard.redMeatMealsPerWeek) return false;
  return true;
};

const applyDay = (state, candidate) => {
  const usage = cloneUsage(state.usage);
  usage.breakfast[candidate.mealNames[0]] = (usage.breakfast[candidate.mealNames[0]] || 0) + 1;
  for (const name of [candidate.mealNames[1], candidate.mealNames[2]]) {
    usage.lunchDinner[name] = (usage.lunchDinner[name] || 0) + 1;
  }
  const distinct = new Set(state.distinct);
  for (const name of candidate.mealNames) distinct.add(name);
  const cuisines = new Set(state.cuisines);
  for (const cuisine of candidate.cuisines) if (cuisine) cuisines.add(cuisine);

  return {
    usage,
    distinct,
    cuisines,
    redMeat: state.redMeat + candidate.redMeatCount,
    protein: state.protein + candidate.totals.protein,
    inBand: state.inBand + (candidate.proteinInBand ? 1 : 0),
    underCarb: state.underCarb + (candidate.underCarbCap ? 1 : 0),
    inCalorieBounds: state.inCalorieBounds + (candidate.inCalorieBounds ? 1 : 0)
  };
};

/**
 * Build a full week.
 *
 * Beam search over dates. A partial week is pruned the moment it can no longer
 * satisfy a Tier-2 budget or reach the weekly protein floor, so the budgets are
 * enforced by construction rather than checked afterwards.
 */
export const selectWeek = ({
  mealDatabase,
  rules,
  targetDateKeys = [],
  historyMap = {},
  preferences = {},
  lockedDays = {},
  beamWidth = DEFAULT_BEAM_WIDTH,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  dayCandidates = null,
  scoredCandidates = null
}) => {
  const dayCount = targetDateKeys.length;
  const candidates = scoredCandidates || dayCandidates || enumerateFeasibleDays({ mealDatabase, rules, preferences });

  if (dayCount === 0 || candidates.length === 0) {
    return { days: [], candidateCount: candidates.length, feasible: candidates.length > 0, summary: null };
  }

  // Sorting a copy leaves the caller's candidate order untouched — the
  // shortlist builder relies on it for its own stable sort.
  const scored = [...(scoredCandidates || scoreCandidates(candidates, { rules, preferences, historyMap }))];
  scored.sort((a, b) => b.baseScore - a.baseScore || (a.nameKey < b.nameKey ? -1 : 1));

  const pool = trimCandidatePool(scored, maxCandidates);
  const maxDayProtein = pool.reduce((max, day) => Math.max(max, day.totals.protein), 0);
  const proteinFloor = weeklyProteinFloor(dayCount, rules);
  const requiredCompliant = requiredCompliantDays(dayCount, rules);

  const seed = seedWeekState(lockedDays, rules);
  let beam = [{
    days: [],
    state: {
      ...seed,
      protein: 0,
      inBand: 0,
      underCarb: 0,
      inCalorieBounds: 0
    },
    score: 0
  }];

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const dateKey = targetDateKeys[dayIndex];
    const remainingAfter = dayCount - dayIndex - 1;
    const next = [];

    // The tie-breaker depends only on the date and the candidate, not on the
    // beam node, so it is the same value for every node on this day. Computing
    // it per (node, candidate) meant hashing the same string `beamWidth` times.
    const tieBreaks = pool.map(
      (candidate) => (hashString(`${dateKey}|${candidate.nameKey}`) % 1000) / 100000
    );

    for (const node of beam) {
      for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex += 1) {
        const candidate = pool[candidateIndex];
        if (!canPlaceDay(node.state, candidate, rules)) continue;

        // Tier-2 budgets, enforced by look-ahead rather than after the fact.
        // A branch dies the moment the days it has left can no longer supply
        // the compliant days it still owes; short of that, missing a budget
        // costs more the less slack remains, so the beam does not fill up with
        // high-scoring branches that are quietly doomed.
        let budgetPressure = 0;
        let doomed = false;
        for (const budget of BUDGETS) {
          const satisfied = node.state[budget.counter] + (candidate[budget.flag] ? 1 : 0);
          const stillNeeded = requiredCompliant - satisfied;
          if (stillNeeded > remainingAfter) { doomed = true; break; }
          if (!candidate[budget.flag]) {
            const slack = remainingAfter - Math.max(0, stillNeeded);
            budgetPressure += rules.scored.budgetPressurePenalty / (1 + slack);
          }
        }
        if (doomed) continue;

        // Weekly protein floor look-ahead: if even a perfect run of remaining
        // days cannot reach the floor, this branch is already dead.
        const proteinSoFar = node.state.protein + candidate.totals.protein;
        if (proteinSoFar + remainingAfter * maxDayProtein < proteinFloor) continue;

        // Score before expanding state: cloning the usage maps for every
        // (node, candidate) pair is by far the most expensive step, so only
        // the survivors of the beam cut pay for it.
        let newDistinct = 0;
        let repeatPenalty = 0;
        for (let slotIndex = 0; slotIndex < candidate.mealNames.length; slotIndex += 1) {
          const name = candidate.mealNames[slotIndex];
          if (!node.state.distinct.has(name)) newDistinct += 1;
          const bucket = slotIndex === 0 ? 'breakfast' : 'lunchDinner';
          repeatPenalty += (node.state.usage[bucket][name] || 0) * rules.scored.repeatUsePenalty;
        }
        let newCuisines = 0;
        for (const cuisine of candidate.cuisines) {
          if (cuisine && !node.state.cuisines.has(cuisine)) newCuisines += 1;
        }

        const tieBreak = tieBreaks[candidateIndex];
        const score = node.score
          + candidate.baseScore
          + newDistinct * rules.scored.distinctMealBonus
          + newCuisines * rules.scored.weekCuisineVarietyBonus
          - repeatPenalty
          - budgetPressure
          + tieBreak;

        next.push({ node, candidate, score });
      }
    }

    if (next.length === 0) {
      // No branch survives the budgets. Fall back to the best-effort week so
      // the caller gets something the validator can report on, rather than
      // nothing at all.
      return bestEffortWeek({ scored, targetDateKeys, rules, lockedDays });
    }

    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, beamWidth).map(({ node, candidate, score }) => ({
      days: [...node.days, { dateKey, candidate }],
      state: applyDay(node.state, candidate),
      score
    }));
  }

  // Prefer a finished week that also clears the weekly protein floor.
  const clearing = beam.filter((node) => node.state.protein >= proteinFloor);
  const winner = (clearing.length > 0 ? clearing : beam)[0];
  const days = winner.days.map(({ dateKey, candidate }) => ({ dateKey, ...candidate }));
  const summary = summariseWeek(days, rules);

  return {
    days,
    candidateCount: candidates.length,
    feasible: isWeekWithinBudgets(summary),
    summary
  };
};

/** Did a produced week meet the weekly protein floor and every Tier-2 budget? */
export const isWeekWithinBudgets = (summary) =>
  Boolean(summary) &&
  summary.totalProtein >= summary.proteinFloor &&
  summary.daysProteinInBand >= summary.requiredCompliantDays &&
  summary.daysUnderCarbCap >= summary.requiredCompliantDays &&
  summary.daysInCalorieBounds >= summary.requiredCompliantDays;

/**
 * Greedy fallback used when the beam prunes itself empty. Respects Tier 1 but
 * knowingly gives up on the Tier-2 budgets; the validator reports what broke.
 */
const bestEffortWeek = ({ scored, targetDateKeys, rules, lockedDays }) => {
  const state = { ...seedWeekState(lockedDays, rules), protein: 0, inBand: 0, underCarb: 0, inCalorieBounds: 0 };
  const days = [];
  let current = state;

  for (const dateKey of targetDateKeys) {
    const pick = scored.find((candidate) => canPlaceDay(current, candidate, rules)) || scored[0];
    days.push({ dateKey, ...pick });
    current = applyDay(current, pick);
  }

  const summary = summariseWeek(days, rules);
  return { days, candidateCount: scored.length, feasible: false, summary, bestEffort: true };
};

/** Roll a set of generated days up into the figures the acceptance criteria use. */
export const summariseWeek = (days = [], rules) => {
  const dayCount = days.length;
  const totalProtein = days.reduce((sum, day) => sum + (day.totals?.protein ?? summariseDay(day).protein), 0);
  const nominal = Math.round(dayCount * rules.dailyProteinTarget);
  const distinct = new Set();
  for (const day of days) for (const slot of CORE_SLOTS) distinct.add(getMealName(day[slot]));

  return {
    dayCount,
    totalProtein,
    nominalProtein: nominal,
    proteinFloor: weeklyProteinFloor(dayCount, rules),
    proteinPctOfNominal: nominal > 0 ? Number(((totalProtein / nominal) * 100).toFixed(1)) : 0,
    daysProteinInBand: days.filter((day) => day.proteinInBand).length,
    daysUnderCarbCap: days.filter((day) => day.underCarbCap).length,
    daysInCalorieBounds: days.filter((day) => day.inCalorieBounds).length,
    requiredCompliantDays: requiredCompliantDays(dayCount, rules),
    redMeatMeals: days.reduce((sum, day) => sum + (day.redMeatCount || 0), 0),
    distinctMeals: distinct.size
  };
};

// ─── Shortlists for the AI path ─────────────────────────────────────────────

const DEFAULT_SHORTLIST_PER_SLOT = 8;
const DEFAULT_ALTERNATE_DAYS = 60;

/**
 * The `limit` best candidates by score, in the order a stable descending sort
 * would have produced — ties broken by position in `candidates`.
 *
 * The shortlist needs 60 of them. Fully sorting the candidate set to throw away
 * the other 114,054 is the single clearest piece of waste left in the pass.
 *
 * Stability falls out of the strict `>` test: a candidate only displaces the
 * worst kept entry when it scores strictly higher, so among equal scores the
 * earliest-seen candidate stays, which is what the stable sort did.
 */
const topByBaseScore = (candidates, limit) => {
  if (candidates.length <= limit) {
    return [...candidates].sort((a, b) => b.baseScore - a.baseScore);
  }

  const kept = [];
  for (const candidate of candidates) {
    const score = candidate.baseScore;
    if (kept.length === limit && !(score > kept[limit - 1].baseScore)) continue;

    // First position holding a strictly lower score — where a stable sort
    // would place this candidate, after any it ties with.
    let low = 0;
    let high = kept.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (kept[mid].baseScore < score) high = mid;
      else low = mid + 1;
    }

    kept.splice(low, 0, candidate);
    if (kept.length > limit) kept.pop();
  }
  return kept;
};

/**
 * Per-date, per-slot shortlists of legal meal names, derived from the day
 * candidates rather than from three independent slot filters.
 *
 * The chosen deterministic day always leads its slot's list, so the model can
 * reproduce the reference week; the alternates give it real room to pick
 * something more appetising. These names become the `enum` in the tool schema,
 * so a hallucinated meal name is structurally impossible.
 */
export const buildSlotShortlists = ({
  weekDays = [],
  dayCandidates = [],
  rules,
  preferences = {},
  historyMap = {},
  perSlot = DEFAULT_SHORTLIST_PER_SLOT,
  alternateDays = DEFAULT_ALTERNATE_DAYS,
  scoredCandidates = null
}) => {
  // Same scores the week search used, computed once when the caller supplies
  // them. Candidates stay in their original order, which is what makes the
  // selection below tie-break exactly as the old sort did.
  const pool = scoredCandidates || scoreCandidates(dayCandidates, { rules, preferences, historyMap });
  const ranked = topByBaseScore(pool, alternateDays);

  const shortlists = {};
  const stats = {};

  for (const day of weekDays) {
    const perSlotNames = { breakfast: [], lunch: [], dinner: [] };
    const seen = { breakfast: new Set(), lunch: new Set(), dinner: new Set() };

    const push = (slot, meal) => {
      const name = getMealName(meal);
      if (!name || seen[slot].has(name) || perSlotNames[slot].length >= perSlot) return;
      seen[slot].add(name);
      perSlotNames[slot].push(meal);
    };

    // The deterministic pick leads each list.
    for (const slot of CORE_SLOTS) push(slot, day[slot]);
    for (const candidate of ranked) for (const slot of CORE_SLOTS) push(slot, candidate[slot]);

    shortlists[day.dateKey] = perSlotNames;
    stats[day.dateKey] = {
      breakfast: perSlotNames.breakfast.length,
      lunch: perSlotNames.lunch.length,
      dinner: perSlotNames.dinner.length
    };
  }

  return { shortlists, stats };
};

/**
 * One call for the whole deterministic phase: enumerate, search, and produce
 * the shortlists the AI phase will choose from.
 */
export const buildWeekPlan = ({
  mealDatabase,
  rules,
  targetDateKeys,
  historyMap = {},
  preferences = {},
  lockedDays = {},
  beamWidth = DEFAULT_BEAM_WIDTH,
  shortlistPerSlot = DEFAULT_SHORTLIST_PER_SLOT
}) => {
  const dayCandidates = enumerateFeasibleDays({ mealDatabase, rules, preferences });
  // Scored once, here, and shared by both consumers below.
  const scoredCandidates = scoreCandidates(dayCandidates, { rules, preferences, historyMap });
  const week = selectWeek({
    mealDatabase,
    rules,
    targetDateKeys,
    historyMap,
    preferences,
    lockedDays,
    beamWidth,
    dayCandidates,
    scoredCandidates
  });
  const { shortlists, stats } = buildSlotShortlists({
    weekDays: week.days,
    dayCandidates,
    rules,
    preferences,
    historyMap,
    perSlot: shortlistPerSlot,
    scoredCandidates
  });

  return { ...week, dayCandidates, shortlists, stats };
};
