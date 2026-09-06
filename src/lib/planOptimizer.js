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
  maxPerWeek as tierMaxPerWeek,
  softenTiers,
  stapleNames,
  tierScoreBonus
} from './mealTiers.js';
import {
  CARB_HEAVY_THRESHOLD,
  FAT_HEAVY_THRESHOLD,
  FIBRE_MEAL_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  PROTEIN_BALANCE_MAX_GAP,
  ANCHOR_FAMILY,
  anchorFamilyMaxPerWeek,
  anchorFamilyOf,
  eggBreakfastsFloor,
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
  repeatedFamily: false, primaryIngredient: null,
  signatureIngredients: [], signatureFamilies: []
};

export const mealFacts = (meal) => {
  if (!meal || typeof meal !== 'object') return EMPTY_FACTS;
  const cached = FACT_CACHE.get(meal);
  if (cached) return cached;

  const family = getProteinFamily(meal);
  const fibreScore = getFibreScore(meal);
  const signatureIngredients = Array.isArray(meal?.signature_ingredients) && meal.signature_ingredients.length
    ? meal.signature_ingredients
    : (meal?.primary_ingredient ? [meal.primary_ingredient] : []);
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
    repeatedFamily: hasRepeatedFamilyInsideMeal(meal),
    // Derived in the data layer from parts[]; null for fixtures and
    // user-added meals that carry no ingredient list.
    primaryIngredient: meal?.primary_ingredient || null,
    // Every ingredient a person would name in this meal. Falls back to the
    // anchor alone for fixtures and user-added meals, which carry no
    // `signature_ingredients` — so those keep exactly the coverage they had
    // before this field existed rather than silently losing the anchor cap.
    signatureIngredients,
    // Only the ingredients ANCHOR_FAMILY actually names are counted against
    // the weekly family caps. An unmapped ingredient anchors itself, so
    // counting every signature ingredient here would give `curry_base` and
    // `jowar_roti` a hard cap of 2 a week — and R3 forces seven Indian
    // lunches, most of them built on exactly those. Week-level monotony for
    // the unmapped ones is scored instead, in `scoreWeekMonotony`.
    signatureFamilies: signatureIngredients
      .filter((id) => Object.prototype.hasOwnProperty.call(ANCHOR_FAMILY, id))
      .map(anchorFamilyOf)
  };
  FACT_CACHE.set(meal, facts);
  return facts;
};

/**
 * R5 — does this day name the same ingredient in more than one slot?
 *
 * `cap` is `rules.hard.maxSameSignatureIngredientPerDay`. At 1 (the shipped
 * value) any shared signature ingredient across two slots rejects the day.
 * Written as counting rather than a boolean so raising the cap to 2 is a
 * threshold change in rules.js and not a code change here.
 *
 * Hot path: this runs once per enumerated combination, so the caller splits it
 * — `signatureOverlap(a, b)` is checked for the breakfast/lunch pair in the
 * middle loop and kills the whole dinner loop on a hit.
 */
export const signatureOverlap = (factsA, factsB) => {
  const a = factsA.signatureIngredients;
  const b = factsB.signatureIngredients;
  if (!a.length || !b.length) return false;
  for (const id of a) {
    if (b.includes(id)) return true;
  }
  return false;
};

/** Every signature ingredient used more than `cap` times across the day. */
export const daySignatureCollisions = (day, cap = 1) => {
  const counts = {};
  const over = [];
  for (const slot of CORE_SLOTS) {
    for (const id of mealFacts(day?.[slot]).signatureIngredients) {
      counts[id] = (counts[id] || 0) + 1;
      if (counts[id] === cap + 1) over.push(id);
    }
  }
  return over;
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
export const isMealAdmissible = (meal, { rules, preferences = {}, tiers = null }) => {
  if (!meal) return false;
  if (getMealProtein(meal) < rules.hard.minMealProtein) return false;
  if (Number(preferences?.avoids?.[getMealName(meal)] || 0) > rules.hard.avoidScoreExclusiveMax) return false;
  // A meal the user has excluded, or one demoted to `excluded` by repeated
  // rejection, is removed from the pool outright rather than merely scored
  // down. `maxPerWeek: 0` would express the same thing at the week level, but
  // dropping it here also keeps it out of the shortlists handed downstream.
  if (tiers && tierMaxPerWeek(getMealName(meal), tiers) <= 0) return false;
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
export const satisfiesDayHardConstraints = (day, { rules, preferences = {}, tiers = null }) => {
  const meals = CORE_SLOTS.map((slot) => day?.[slot]);
  if (meals.some((meal) => !meal)) return false;
  if (meals.some((mealForSlot) => !isMealAdmissible(mealForSlot, { rules, preferences, tiers }))) return false;

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
 *
 * R3 (Indian lunch + non-Indian dinner) is applied here rather than in the
 * week search, because it is a property of a single day: enforcing it at
 * enumeration means no illegal day is ever built, scored or shortlisted, and
 * it cuts the pool by ~76% (99,900 → 23,688 at the current catalog), which
 * pays for the rest of the rubric's extra week-level bookkeeping.
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

export const enumerateFeasibleDays = ({ mealDatabase, rules, preferences = {}, tiers = null }) => {
  const breakfasts = getMealsForSlot(mealDatabase, 'breakfast')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences, tiers }));
  const lunchDinners = getMealsForSlot(mealDatabase, 'lunch')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences, tiers }));

  // Both pools are already filtered for admissibility, so the per-meal half of
  // `satisfiesDayHardConstraints` is answered before the loop starts. What is
  // left that genuinely varies per combination is the same-meal cap and the
  // protein sanity floor, checked inline below. The rejected combinations no
  // longer allocate a day object on their way to being discarded.
  const {
    maxSameMealPerDay,
    dailyProteinSanityFloor,
    lunchCuisine,
    maxSameSignatureIngredientPerDay
  } = rules.hard;
  // R5 is only a pairwise check while the cap is 1: three slots can only
  // exceed "at most once" by two of them sharing an ingredient. Above 1 the
  // pairwise shortcut is not equivalent, so fall back to counting the day.
  const pairwiseSignatureCheck = (maxSameSignatureIngredientPerDay ?? 1) === 1;
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

      // R3 is no longer gated here. It was: a non-Indian lunch killed the
      // whole dinner loop, which is why the pool was 84% smaller and why no
      // meal could ever appear in both slots. It is now a Tier-2 budget,
      // counted per day in `annotateDay` and judged 5-of-7 across the week.
      // R5, breakfast/lunch half. Hoisted here so a colliding pair skips every
      // dinner at once instead of being rejected 75 times over.
      if (pairwiseSignatureCheck && signatureOverlap(b, l)) continue;

      for (let dinnerIndex = 0; dinnerIndex < lunchDinners.length; dinnerIndex += 1) {
        const d = lunchDinnerFacts[dinnerIndex];
        if (!withinSameMealCap(b.name, l.name, d.name, maxSameMealPerDay)) continue;
        if (pairwiseSignatureCheck && (signatureOverlap(b, d) || signatureOverlap(l, d))) continue;

        const protein = pairProtein + d.protein;
        if (protein < dailyProteinSanityFloor) continue;

        const totals = {
          protein,
          carbs: pairCarbs + d.carbs,
          fat: pairFat + d.fat,
          calories: pairCalories + d.calories
        };
        const day = { breakfast, lunch: lunchDinners[lunchIndex], dinner: lunchDinners[dinnerIndex] };
        if (!pairwiseSignatureCheck && daySignatureCollisions(day, maxSameSignatureIngredientPerDay).length) continue;
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
  const dishNames = mealNames.filter(Boolean);

  return {
    ...day,
    totals: resolvedTotals,
    mealNames,
    // Precomputed once here because the sort tie-breaker and the beam's
    // per-candidate hash both need it, and both used to rebuild it per call.
    nameKey: mealNames.join('|'),
    // Order-independent form of the same three names, used for the
    // duplicate-day check: a day with lunch and dinner swapped is still the
    // same day to a person eating it, even though `nameKey` differs.
    dishSetKey: dishNames.length ? [...dishNames].sort().join('|') : '',
    redMeatCount: (breakfast.redMeat ? 1 : 0) + (lunch.redMeat ? 1 : 0) + (dinner.redMeat ? 1 : 0),
    cuisines: [breakfast.cuisine, lunch.cuisine, dinner.cuisine],
    // The anchor-ingredient families this day spends, for the weekly cap.
    // Breakfast counts too — a chicken breakfast spends the same poultry
    // budget as a chicken dinner would.
    // Weekly family caps count every *signature* ingredient the day names, not
    // just the three anchors. Counting anchors alone is what let a paneer
    // breakfast and a palak paneer lunch both pass the `cheese_soft` cap:
    // the breakfast anchored on its chilla and the paneer in it was invisible.
    anchorFamilies: [breakfast, lunch, dinner].flatMap((meal) => meal.signatureFamilies),
    // Flat list of every signature ingredient used today, for the week-level
    // monotony score. Duplicates within a day cannot occur — R5 rejects them.
    signatureIngredients: [breakfast, lunch, dinner].flatMap((meal) => meal.signatureIngredients),
    proteinInBand: resolvedTotals.protein >= dailyProteinMin && resolvedTotals.protein <= dailyProteinMax,
    underCarbCap: resolvedTotals.carbs <= dailyCarbCap,
    inCalorieBounds: resolvedTotals.calories >= dailyCalorieMin && resolvedTotals.calories <= dailyCalorieMax,
    // R2 — does this day's breakfast spend one of the week's 3–4 egg slots?
    // Computed here so the beam reads a flag rather than re-deriving the
    // anchor for every (node, candidate) pair.
    isEggBreakfast: rules.hard.eggAnchorIngredients.includes(breakfast.primaryIngredient),
    // R3 — Indian lunch + non-Indian dinner. A Tier-2 verdict now, in the
    // same shape as `proteinInBand` and friends, rather than a precondition
    // for the day existing at all.
    cuisineDirectionOk:
      Boolean(day.breakfast && day.lunch && day.dinner) &&
      lunch.cuisine === rules.hard.lunchCuisine &&
      dinner.cuisine !== rules.hard.lunchCuisine,
    // R4 — both lunch and dinner built on flatbread/pasta. Scored in
    // `scoreDayStandalone`, reported here so a caller can count the days.
    bothFlatbreadPasta:
      day.lunch?.carb_type === 'flatbread_pasta' && day.dinner?.carb_type === 'flatbread_pasta'
  };
};

// ─── Tier 3 — day-level scoring ─────────────────────────────────────────────

/**
 * Score the parts of a day that do not depend on the rest of the week.
 * Higher is better; this never rejects.
 */
export const scoreDayStandalone = (day, { rules, preferences = {}, tiers = null }) => {
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

  // R4 — lunch and dinner both flatbread/pasta. Scored, not gated, on purpose:
  // 18 of the 28 Indian lunches R3 forces are flatbread, so gating this would
  // regularly leave no legal day at all. As a penalty the beam avoids it
  // wherever the macro budgets leave room and eats the -5 where they do not.
  if (day.lunch?.carb_type === 'flatbread_pasta' && day.dinner?.carb_type === 'flatbread_pasta') {
    score -= w.bothFlatbreadPastaPenalty;
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
export const scoreCandidates = (candidates, { rules, preferences = {}, historyMap = {}, tiers = null }) => {
  const historyCounts = buildHistoryCounts(historyMap);
  const historyRepeatPenalty = rules.scored.historyRepeatPenalty;

  for (const candidate of candidates) {
    let historyPenalty = 0;
    for (const name of candidate.mealNames) {
      historyPenalty += Number(historyCounts[name] || 0) * historyRepeatPenalty;
    }
    candidate.baseScore = scoreDayStandalone(candidate, { rules, preferences, tiers }) - historyPenalty;
  }
  return candidates;
};

/**
 * Week-level ingredient monotony.
 *
 * R5 stops an ingredient appearing twice in a *day*; nothing stopped it
 * appearing ten times in a week. Measured before this existed: `curry_base` 10
 * uses and `jowar_roti` 7 in a single generated week, with every hard counter
 * reading green because the caps only ever looked at one anchor per meal.
 *
 * Scored, not gated, and only past `signatureMonotonyFreeUses`: R3 forces
 * seven Indian lunches and most Indian lunches in this catalog are built on
 * exactly these bases, so a hard cap would make the week infeasible. The free
 * allowance is what keeps a normal Indian week from being penalised for being
 * an Indian week.
 */
export const scoreWeekMonotony = (signatureCounts, rules) => {
  const penaltyPerUse = Number(rules.scored.signatureMonotonyPenalty || 0);
  if (!penaltyPerUse) return 0;
  const free = Number(rules.scored.signatureMonotonyFreeUses ?? 4);
  let penalty = 0;
  for (const count of Object.values(signatureCounts || {})) {
    if (count > free) penalty += (count - free) * penaltyPerUse;
  }
  return -penalty;
};

const DEFAULT_BEAM_WIDTH = 40;

/**
 * Complete alternative weeks returned alongside the chosen one.
 *
 * 6 keeps the Phase 2 prompt small while giving the model a real choice. They
 * cost nothing to produce — the beam is holding `beamWidth` finished weeks at
 * the last iteration and all of them were previously discarded.
 */
const DEFAULT_ALTERNATIVE_WEEKS = 6;

/**
 * The three Tier-2 budgets, as (per-day verdict, running counter) pairs.
 * Everything that enforces "at most 2 of 7 days may miss this" iterates here.
 */
// Cap on how many day candidates the beam considers. Kept stratified rather
// than "top N by score", because the days that satisfy a rare budget (only ~20%
// of combinations reach the 1600 kcal floor) are not the highest-scoring ones
// and a naive trim deletes exactly the days the week needs.
//
// Sized off the number of budget classes rather than a flat literal. At a flat
// 960 with four budgets each class got only 60 candidates, and the beam ran out
// of distinct days to choose from — it produced weeks with two *identical* days
// and 14 distinct meals. 150 per class restores that headroom: measured 20
// distinct meals and no duplicate day on both goals.
// 150 x 16 classes = 2400 working candidates.
//
// Measured cost/quality curve after R3 became a budget (110 meals, 61,794
// enumerated days, median of 5):
//
//   2400 -> 1131ms   all three staples placed, one of them twice
//   1600 ->  929ms   all three placed
//   1200 ->  628ms   all three placed  <- the floor
//    960 ->  546ms   tiers had to be relaxed; one staple dropped to zero
//    800 ->  573ms   same failure
//
// The cliff is between 1200 and 960, and it shows up as the tier system
// silently giving up on a meal the user asked for. 2400 is kept because the
// extra ~500ms is client-side work sitting in front of an API call with a 90s
// timeout, and it buys the best staple satisfaction. Anyone tuning this for
// speed should not go below 1200.
const CANDIDATES_PER_BUDGET_CLASS = 150;

const BUDGETS = [
  { flag: 'proteinInBand', counter: 'inBand' },
  { flag: 'underCarbCap', counter: 'underCarb' },
  { flag: 'inCalorieBounds', counter: 'inCalorieBounds' },
  // R3. It was a fourth budget once, then became a hard per-day gate, and is
  // now a budget again — this time as the cuisine *direction* (Indian lunch,
  // non-Indian dinner) rather than the looser "cuisine balance" it used to be.
  { flag: 'cuisineDirectionOk', counter: 'cuisineDirection' }
];

// The beam's working set, sized in budget-compliance classes.
//
// Held at 16 rather than `2 ** (BUDGETS.length + 1)`, which is what it
// evaluated to when there were three budgets. Adding R3 as a fourth would have
// doubled it to 32, and because the beam does `beamWidth x pool x days` work,
// doubling the pool doubled the search: measured 537ms -> 3176ms, well past
// what the Vercel proxy's budget can absorb. 16 classes x 150 keeps the
// working set exactly where it was while `trimCandidatePool` still stratifies
// across all four budgets, so the rare-but-needed day is no likelier to be
// trimmed away than before.
const CANDIDATE_BUDGET_CLASSES = 16;
const DEFAULT_MAX_CANDIDATES = CANDIDATE_BUDGET_CLASSES * CANDIDATES_PER_BUDGET_CLASS;

/**
 * Reduce the candidate pool to `maxCandidates`, keeping the best of each
 * budget-compliance class so no class is trimmed out of existence.
 */
const trimCandidatePool = (sortedCandidates, maxCandidates) => {
  if (sortedCandidates.length <= maxCandidates) return sortedCandidates;

  // One class per combination of the BUDGETS flags. Strata the trim does not
  // know about get squeezed out, which is exactly how a rare-but-required day
  // disappears before the search ever sees it.
  const perClass = Math.ceil(maxCandidates / (2 ** BUDGETS.length));
  const classCounts = new Map();
  const kept = [];
  const keptSet = new Set();

  for (const candidate of sortedCandidates) {
    const key = BUDGETS.map((budget) => (candidate[budget.flag] ? 1 : 0)).join('');
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

/**
 * R1 — how many times this dish may appear in the week.
 *
 * One counter for the whole week, not one per slot: the rubric says "every
 * dish appears at most once per week, applies to all three slots", so a dish
 * eaten at lunch on Monday and at dinner on Thursday is a repeat. The old
 * split namespaces (breakfast 4, lunch/dinner 2) could not express that.
 */
/**
 * How many times this dish may appear in the week.
 *
 * Resolution order:
 *   1. the meal's tier (mealTiers.js), when a tier table is supplied,
 *   2. the legacy `pinnedDish` argument, kept so existing callers and tests
 *      keep working — nothing in the app ever set it, which is why the
 *      "one favourite may repeat" affordance never actually existed,
 *   3. `rules.hard.maxDishRepeatsPerWeek`, the flat default.
 *
 * The flat default is still 1. What changed is that it is now a *default*
 * rather than a ceiling: a meal the user eats every week resolves to `staple`
 * and is allowed three, so wanting something often is finally expressible.
 */
const dishCap = (name, rules, pinnedDish, tiers = null) => {
  if (tiers && Object.prototype.hasOwnProperty.call(tiers, name)) return tierMaxPerWeek(name, tiers);
  if (pinnedDish && name === pinnedDish) return rules.hard.pinnedDishMaxPerWeek;
  return rules.hard.maxDishRepeatsPerWeek;
};

/** Is this breakfast anchored on an egg, for R2? */
const isEggBreakfast = (meal, rules) =>
  rules.hard.eggAnchorIngredients.includes(mealFacts(meal).primaryIngredient);

/**
 * Seed the week-level counters from days that are already fixed — locked days
 * inside the same week. Weekly repetition and the red-meat cap are counted
 * against the week being produced, which the old filter never did.
 */
const seedWeekState = (lockedDays, rules) => {
  const usage = {};
  const families = {};
  let redMeat = 0;
  let eggBreakfasts = 0;
  for (const day of Object.values(lockedDays || {})) {
    if (!day) continue;
    // R1 counts one dish across every slot, so locked days seed a single map.
    for (const slot of CORE_SLOTS) {
      const name = getMealName(day[slot]);
      if (name) usage[name] = (usage[name] || 0) + 1;
    }
    if (day.breakfast && isEggBreakfast(day.breakfast, rules)) eggBreakfasts += 1;
    // Anchor-family cap counts all three slots — a chicken breakfast spends
    // the same poultry budget a chicken lunch or dinner would.
    for (const slot of CORE_SLOTS) {
      const family = anchorFamilyOf(mealFacts(day[slot]).primaryIngredient);
      if (family) families[family] = (families[family] || 0) + 1;
    }
    redMeat += CORE_SLOTS.map((slot) => day[slot]).filter(Boolean).filter(isRedMeat).length;
  }
  const dayKeys = new Set();
  for (const day of Object.values(lockedDays || {})) {
    if (!day) continue;
    const dishNames = CORE_SLOTS.map((slot) => getMealName(day[slot])).filter(Boolean);
    if (dishNames.length) dayKeys.add([...dishNames].sort().join('|'));
  }
  const signatureCounts = {};
  for (const day of Object.values(lockedDays || {})) {
    if (!day) continue;
    for (const slot of CORE_SLOTS) {
      for (const id of mealFacts(day[slot]).signatureIngredients) {
        signatureCounts[id] = (signatureCounts[id] || 0) + 1;
      }
    }
  }
  return { usage, families, redMeat, eggBreakfasts, dayKeys, signatureCounts, cuisines: new Set(), distinct: new Set() };
};

const canPlaceDay = (state, candidate, rules, pinnedDish = null, tiers = null) => {
  // R1 — one week-wide counter per dish. Counted within the candidate day too,
  // so a day that would place the same dish in two slots spends two of its
  // allowance rather than one.
  const pending = {};
  for (const name of candidate.mealNames) {
    if (!name) continue;
    pending[name] = (pending[name] || 0) + 1;
    if ((state.usage[name] || 0) + pending[name] > dishCap(name, rules, pinnedDish, tiers)) return false;
  }

  // R2 ceiling. The floor cannot be checked here — a partial week is allowed
  // to be short on eggs — so the beam does that with a look-ahead instead.
  if (candidate.isEggBreakfast && state.eggBreakfasts + 1 > rules.hard.eggBreakfastsMax) return false;

  // Anchor-ingredient-family cap. Counted within the candidate day too, so a
  // day that puts the same family at breakfast, lunch and dinner spends three
  // of its allowance rather than one.
  const pendingFamilies = {};
  for (const family of candidate.anchorFamilies || []) {
    pendingFamilies[family] = (pendingFamilies[family] || 0) + 1;
    const familyCap = anchorFamilyMaxPerWeek(family, rules);
    if ((state.families[family] || 0) + pendingFamilies[family] > familyCap) return false;
  }

  // No two identical days in a week, regardless of which slot each dish
  // lands in — swapping lunch and dinner is still the same day to the person
  // eating it. The per-meal repeat caps allow each meal twice, so a whole
  // day repeating (in any slot order) broke no rule while being the most
  // obvious defect a person sees in a generated plan.
  if (candidate.dishSetKey && state.dayKeys.has(candidate.dishSetKey)) return false;

  if (state.redMeat + candidate.redMeatCount > rules.hard.redMeatMealsPerWeek) return false;
  return true;
};

const applyDay = (state, candidate) => {
  const usage = { ...state.usage };
  for (const name of candidate.mealNames) {
    if (name) usage[name] = (usage[name] || 0) + 1;
  }
  const distinct = new Set(state.distinct);
  for (const name of candidate.mealNames) distinct.add(name);
  const cuisines = new Set(state.cuisines);
  for (const cuisine of candidate.cuisines) if (cuisine) cuisines.add(cuisine);
  const families = { ...state.families };
  for (const family of candidate.anchorFamilies || []) {
    families[family] = (families[family] || 0) + 1;
  }
  const dayKeys = new Set(state.dayKeys);
  if (candidate.dishSetKey) dayKeys.add(candidate.dishSetKey);
  const signatureCounts = { ...state.signatureCounts };
  for (const id of candidate.signatureIngredients || []) {
    signatureCounts[id] = (signatureCounts[id] || 0) + 1;
  }

  return {
    usage,
    signatureCounts,
    distinct,
    cuisines,
    families,
    dayKeys,
    redMeat: state.redMeat + candidate.redMeatCount,
    eggBreakfasts: state.eggBreakfasts + (candidate.isEggBreakfast ? 1 : 0),
    protein: state.protein + candidate.totals.protein,
    inBand: state.inBand + (candidate.proteinInBand ? 1 : 0),
    underCarb: state.underCarb + (candidate.underCarbCap ? 1 : 0),
    inCalorieBounds: state.inCalorieBounds + (candidate.inCalorieBounds ? 1 : 0),
    cuisineDirection: state.cuisineDirection + (candidate.cuisineDirectionOk ? 1 : 0)
  };
};

/**
 * Keep the `limit` highest-scoring entries, in the order a stable descending
 * sort followed by a slice would have produced.
 *
 * The beam used to push every surviving (node, candidate) pair into an array
 * and sort the whole thing once per day, then throw away all but `beamWidth`.
 * With R3 moved from a hard gate to a budget the candidate pool became far
 * more varied, so many more pairs survive `canPlaceDay` and that array grew to
 * tens of thousands per day — measured as the single largest cost in the
 * search (~1150ms of a ~1500ms generation; the full candidate sort it was
 * previously blamed on is only 50ms).
 *
 * Stability falls out of the strict `>` test, exactly as in `topByBaseScore`:
 * an entry only displaces the worst kept one when it scores strictly higher,
 * so among equal scores the earliest-seen survives — which is what V8's stable
 * sort did.
 */
const keepTopScoring = (kept, entry, limit) => {
  if (kept.length === limit && !(entry.score > kept[limit - 1].score)) return;
  let low = 0;
  let high = kept.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (kept[mid].score < entry.score) high = mid;
    else low = mid + 1;
  }
  kept.splice(low, 0, entry);
  if (kept.length > limit) kept.pop();
};

/**
 * Build a full week.
 *
 * Beam search over dates. A partial week is pruned the moment it can no longer
 * satisfy a Tier-2 budget or reach the weekly protein floor, so the budgets are
 * enforced by construction rather than checked afterwards.
 */
export const selectWeek = (params) => {
  const {
  mealDatabase,
  rules,
  targetDateKeys = [],
  historyMap = {},
  preferences = {},
  lockedDays = {},
  pinnedDish = null,
  tiers = null,
  beamWidth = DEFAULT_BEAM_WIDTH,
  // How many *other* complete legal weeks to hand back alongside the winner.
  // Free: they are already sitting in the final beam.
  maxAlternativeWeeks = DEFAULT_ALTERNATIVE_WEEKS,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  dayCandidates = null,
  scoredCandidates = null
  } = params;
  const dayCount = targetDateKeys.length;
  const candidates = scoredCandidates || dayCandidates || enumerateFeasibleDays({ mealDatabase, rules, preferences, tiers });

  if (dayCount === 0 || candidates.length === 0) {
    return {
      days: [],
      // Every exit from `selectWeek` returns the same shape — a caller reading
      // `.alternatives` must never get `undefined`, whichever way the search
      // ended.
      alternatives: [],
      candidateCount: candidates.length,
      feasible: candidates.length > 0,
      summary: null
    };
  }

  // Sorting a copy leaves the caller's candidate order untouched — the
  // shortlist builder relies on it for its own stable sort.
  const scored = [...(scoredCandidates || scoreCandidates(candidates, { rules, preferences, historyMap, tiers }))];
  scored.sort((a, b) => b.baseScore - a.baseScore || (a.nameKey < b.nameKey ? -1 : 1));

  const pool = trimCandidatePool(scored, maxCandidates);
  const maxDayProtein = pool.reduce((max, day) => Math.max(max, day.totals.protein), 0);
  const proteinFloor = weeklyProteinFloor(dayCount, rules);
  const requiredCompliant = requiredCompliantDays(dayCount, rules);
  const eggBreakfastsMin = eggBreakfastsFloor(dayCount, rules);

  // Staples that actually exist in the pool. A staple the rules exclude for
  // some other reason must not doom every branch — it simply cannot be placed.
  const placeableNames = new Set();
  for (const candidate of pool) for (const name of candidate.mealNames) placeableNames.add(name);
  const requiredStaples = tiers ? stapleNames(tiers).filter((name) => placeableNames.has(name)) : [];
  const staplePressurePenalty = Number(rules.scored.staplePressurePenalty ?? 0);

  const seed = seedWeekState(lockedDays, rules);
  let beam = [{
    days: [],
    state: {
      ...seed,
      protein: 0,
      inBand: 0,
      underCarb: 0,
      inCalorieBounds: 0,
      cuisineDirection: 0
    },
    score: 0
  }];

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const dateKey = targetDateKeys[dayIndex];
    const remainingAfter = dayCount - dayIndex - 1;
    // Bounded to `beamWidth` as it is built, rather than collected in full and
    // sorted afterwards. See `keepTopScoring`.
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
        if (!canPlaceDay(node.state, candidate, rules, pinnedDish, tiers)) continue;

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

        // R2 floor look-ahead, the same shape. The ceiling is enforced in
        // `canPlaceDay`; the floor cannot be, because a partial week being
        // short on eggs is not yet a violation. What *is* a violation is a
        // branch with fewer days left than eggs still owed.
        const eggsSoFar = node.state.eggBreakfasts + (candidate.isEggBreakfast ? 1 : 0);
        if (eggsSoFar + remainingAfter < eggBreakfastsMin) continue;

        // Staple floor, in the same shape as the Tier-2 budget pressure above.
        // A staple that has not been placed yet costs more the fewer days are
        // left to place it in, and a branch with more unplaced staples than
        // its remaining days could physically hold is already dead.
        let staplePressure = 0;
        if (requiredStaples.length) {
          let unplaced = 0;
          for (const name of requiredStaples) {
            if (node.state.distinct.has(name) || candidate.mealNames.includes(name)) continue;
            unplaced += 1;
          }
          // A day holds three slots, so this is the honest necessary condition
          // rather than a guess — it prunes only branches that genuinely
          // cannot finish.
          if (unplaced > remainingAfter * CORE_SLOTS.length) continue;
          const slack = Math.max(0, remainingAfter - unplaced);
          staplePressure = unplaced * (staplePressurePenalty / (1 + slack));
        }

        // Score before expanding state: cloning the usage maps for every
        // (node, candidate) pair is by far the most expensive step, so only
        // the survivors of the beam cut pay for it.
        let newDistinct = 0;
        let repeatPenalty = 0;
        for (const name of candidate.mealNames) {
          if (!node.state.distinct.has(name)) newDistinct += 1;
          // Anti-greedy: a second use of a dish is worse than a first. It is
          // deliberately NOT charged on a dish whose tier allows more than one
          // use a week. The penalty exists to stop the beam reaching for the
          // same high-scoring dish over and over when nothing said it should;
          // a `staple` or `regular` is exactly the case where something did
          // say so, and charging it here would cancel the tier bonus that the
          // tier exists to grant. Measured: with this penalty applied to
          // staples, a dish confirmed 6 times out of 6 still appeared once.
          if (dishCap(name, rules, pinnedDish, tiers) <= 1) {
            repeatPenalty += (node.state.usage[name] || 0) * rules.scored.repeatUsePenalty;
          }
        }

        // Week-level ingredient monotony, charged incrementally: the delta
        // this candidate adds to the running penalty, so the beam sees the
        // cost of a seventh jowar roti at the moment it considers placing it.
        let monotonyDelta = 0;
        const freeUses = Number(rules.scored.signatureMonotonyFreeUses ?? 4);
        const monotonyPerUse = Number(rules.scored.signatureMonotonyPenalty || 0);
        if (monotonyPerUse) {
          const pendingSignature = {};
          for (const id of candidate.signatureIngredients || []) {
            pendingSignature[id] = (pendingSignature[id] || 0) + 1;
            const used = (node.state.signatureCounts[id] || 0) + pendingSignature[id];
            if (used > freeUses) monotonyDelta += monotonyPerUse;
          }
        }
        let newCuisines = 0;
        for (const cuisine of candidate.cuisines) {
          if (cuisine && !node.state.cuisines.has(cuisine)) newCuisines += 1;
        }

        // Tier pull, applied here rather than in `scoreDayStandalone`.
        //
        // It must not reach `baseScore`, because `baseScore` is what
        // `trimCandidatePool` ranks by. With a +9 staple bonus baked in, every
        // budget class filled up with days containing the staples, the pool
        // lost the variety the rest of the week needs, and a user with two
        // staples got an exhausted beam and a `bestEffort` week carrying
        // duplicate days and three anchor-family violations. Scoring the
        // *placement* keeps the candidate pool representative while still
        // making the search reach for a favourite before it reaches for
        // novelty — which is the whole point, since the distinct-meal bonus
        // (+6 per unused dish) would otherwise crowd favourites out.
        let tierBonus = 0;
        if (tiers) {
          const tierWeight = Number(rules.scored.tierBonusWeight ?? 1);
          for (const name of candidate.mealNames) tierBonus += tierScoreBonus(name, tiers) * tierWeight;
        }

        const tieBreak = tieBreaks[candidateIndex];
        const score = node.score
          + candidate.baseScore
          + tierBonus
          + newDistinct * rules.scored.distinctMealBonus
          + newCuisines * rules.scored.weekCuisineVarietyBonus
          - repeatPenalty
          - budgetPressure
          - monotonyDelta
          - staplePressure
          + tieBreak;

        keepTopScoring(next, { node, candidate, score }, beamWidth);
      }
    }

    if (next.length === 0) {
      // A tier is a preference, and a preference must never be the reason a
      // week comes back invalid. Before giving up, ask for the favourites less
      // insistently: staple -> regular -> occasional, at most two extra passes.
      // The pre-computed candidates are deliberately not reused — a softened
      // tier can change admissibility (an `excluded` meal is filtered out of
      // the pool entirely), so the enumeration has to run again.
      const softened = tiers ? softenTiers(tiers) : null;
      if (softened) {
        return selectWeek({
          ...params,
          tiers: softened,
          dayCandidates: null,
          scoredCandidates: null,
          tiersRelaxedFrom: params.tiersRelaxedFrom || tiers
        });
      }

      // No branch survives. Fall back to the best-effort week so the caller
      // gets something the validator can report on, rather than nothing at
      // all — but carry the diagnosis of what ran out, because under the
      // rubric this is no longer only a budget failure: R1 needs 21 distinct
      // dishes and R3 splits the lunch/dinner catalog into two pools that
      // cannot cover for each other.
      return bestEffortWeek({
        scored,
        targetDateKeys,
        rules,
        lockedDays,
        pinnedDish,
        tiers,
        diagnostics: {
          exhaustedOnDayIndex: dayIndex,
          ...rubricFeasibility({ candidates: pool, mealDatabase, rules, preferences, tiers })
        }
      });
    }

    beam = next.map(({ node, candidate, score }) => ({
      days: [...node.days, { dateKey, candidate }],
      state: applyDay(node.state, candidate),
      score
    }));
  }

  // Prefer a finished week that clears both weekly floors. The beam is sorted
  // by score, so the first survivor of each filter is the best one.
  const placedEveryStaple = (node) => requiredStaples.every((name) => node.state.distinct.has(name));
  const clearingAll = beam.filter(
    (node) => node.state.protein >= proteinFloor
      && node.state.eggBreakfasts >= eggBreakfastsMin
      && placedEveryStaple(node)
  );
  const clearingBoth = beam.filter(
    (node) => node.state.protein >= proteinFloor && node.state.eggBreakfasts >= eggBreakfastsMin
  );
  const clearingProtein = beam.filter((node) => node.state.protein >= proteinFloor);
  const winner = (clearingAll[0] || clearingBoth[0] || clearingProtein[0] || beam[0]);
  const days = winner.days.map(({ dateKey, candidate }) => ({ dateKey, ...candidate }));
  const summary = summariseWeek(days, rules);

  // Every *other* finished week the beam is still holding.
  //
  // These are what Phase 2 should be choosing between. The beam has already
  // built them subject to every hard rule and every Tier-2 budget, so any of
  // them is a legal answer — which is exactly what the flat per-slot
  // shortlists were not. Measured on the shipped catalog, sampling the
  // shortlists the way the tool schema permits produced a legal week 0 times
  // in 400, because a week must place 21 distinct dishes and the union of all
  // seven days' breakfast lists held 9 meals. Handing the model whole weeks
  // instead of parts makes an illegal answer unrepresentable rather than
  // merely detected afterwards.
  const alternatives = [];
  const seenWeeks = new Set([winner.days.map(({ candidate }) => candidate.nameKey).join('#')]);
  const alternativePool = clearingAll.length
    ? clearingAll
    : clearingBoth.length ? clearingBoth : clearingProtein.length ? clearingProtein : beam;
  for (const node of alternativePool) {
    if (alternatives.length >= maxAlternativeWeeks) break;
    const key = node.days.map(({ candidate }) => candidate.nameKey).join('#');
    if (seenWeeks.has(key)) continue;
    seenWeeks.add(key);
    const altDays = node.days.map(({ dateKey, candidate }) => ({ dateKey, ...candidate }));
    alternatives.push({ days: altDays, summary: summariseWeek(altDays, rules), score: node.score });
  }

  return {
    days,
    alternatives,
    candidateCount: candidates.length,
    feasible: isWeekWithinBudgets(summary),
    summary,
    // Set when the tier pull had to be stepped down to find a legal week, so
    // the caller can tell the user their favourite appears less often than
    // they asked rather than silently delivering fewer.
    ...(params.tiersRelaxedFrom ? { tiersRelaxedFrom: params.tiersRelaxedFrom, tiersUsed: tiers } : {})
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
/**
 * Why the search ran out of candidates, in terms a person can act on.
 *
 * Computed only on the failure path, so its cost never touches a normal run.
 * Each count is the size of the pool the *next* rule has to work with, so the
 * line where the number collapses is the rule that made the week impossible.
 */
export const rubricFeasibility = ({ candidates, mealDatabase, rules, preferences = {}, tiers = null }) => {
  const breakfasts = getMealsForSlot(mealDatabase, 'breakfast')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences, tiers }));
  const lunchDinners = getMealsForSlot(mealDatabase, 'lunch')
    .filter((meal) => isMealAdmissible(meal, { rules, preferences, tiers }));

  return {
    // R1 needs 3 distinct dishes per day, all distinct across the week.
    distinctBreakfasts: breakfasts.length,
    distinctEggBreakfasts: breakfasts.filter((meal) =>
      rules.hard.eggAnchorIngredients.includes(mealFacts(meal).primaryIngredient)).length,
    distinctNonEggBreakfasts: breakfasts.filter((meal) =>
      !rules.hard.eggAnchorIngredients.includes(mealFacts(meal).primaryIngredient)).length,
    // R3 splits the lunch/dinner catalog into two pools that cannot substitute
    // for each other: every lunch comes from one, every dinner from the other.
    distinctIndianLunches: lunchDinners.filter((meal) => mealFacts(meal).cuisine === rules.hard.lunchCuisine).length,
    distinctNonIndianDinners: lunchDinners.filter((meal) => mealFacts(meal).cuisine !== rules.hard.lunchCuisine).length,
    dayCandidatesAfterR3: candidates.length,
    dayCandidatesInBudget: candidates.filter(
      (day) => day.proteinInBand && day.underCarbCap && day.inCalorieBounds).length
  };
};

/**
 * The last-resort week, used when no branch of the beam survives.
 *
 * This is the one path that can emit a week breaking R1–R3: when nothing is
 * placeable it takes the best-scoring candidate regardless. That is deliberate
 * — the caller needs *something* the validator can report on — but it must
 * never be mistaken for a legal week, so it is flagged `bestEffort` and
 * `feasible: false`, and carries the diagnosis of what ran out. Callers write
 * a week only after `validateWeek`, which fails it on the same rules.
 */
const bestEffortWeek = ({ scored, targetDateKeys, rules, lockedDays, pinnedDish = null, tiers = null, diagnostics = null }) => {
  const state = {
    ...seedWeekState(lockedDays, rules),
    protein: 0, inBand: 0, underCarb: 0, inCalorieBounds: 0, eggBreakfasts: 0
  };
  const days = [];
  let current = state;
  let constraintsRelaxed = false;

  for (const dateKey of targetDateKeys) {
    const placeable = scored.find((candidate) => canPlaceDay(current, candidate, rules, pinnedDish, tiers));
    if (!placeable) constraintsRelaxed = true;
    const pick = placeable || scored[0];
    days.push({ dateKey, ...pick });
    current = applyDay(current, pick);
  }

  const summary = summariseWeek(days, rules);
  return {
    days,
    // Same shape as the happy path. A caller reading `.alternatives` must not
    // get `undefined` just because the search had to fall back here.
    alternatives: [],
    candidateCount: scored.length,
    feasible: false,
    summary,
    bestEffort: true,
    // True when at least one day had no legal placement at all, so this week
    // is known to break a hard rule rather than merely a budget.
    constraintsRelaxed,
    diagnostics
  };
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
    // R3 holds by construction (enumeration filters it), so this counts what
    // reached the week rather than what was allowed to.
    daysR3Compliant: days.filter(
      (day) => mealFacts(day.lunch).cuisine === rules.hard.lunchCuisine
        && mealFacts(day.dinner).cuisine !== rules.hard.lunchCuisine
    ).length,
    daysBothFlatbreadPasta: days.filter((day) => day.bothFlatbreadPasta).length,
    eggBreakfasts: days.filter((day) => day.isEggBreakfast).length,
    eggBreakfastsFloor: eggBreakfastsFloor(days.length, rules),
    eggBreakfastsMax: rules.hard.eggBreakfastsMax,
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
  // R1's optional pin. Superseded by `tiers` — kept because tests and the
  // scoring path still accept it, and because a pin is exactly a one-off
  // `staple` for callers that have no tier table.
  pinnedDish = null,
  // Per-meal repeat allowances from mealTiers.js. Null means "no tier table",
  // in which case every dish falls back to `rules.hard.maxDishRepeatsPerWeek`
  // and the engine behaves exactly as it did before tiers existed.
  tiers = null,
  beamWidth = DEFAULT_BEAM_WIDTH,
  // Was not forwarded to `selectWeek` at all, so callers tuning it were
  // silently tuning nothing and the default was always in force.
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  maxAlternativeWeeks = DEFAULT_ALTERNATIVE_WEEKS,
  shortlistPerSlot = DEFAULT_SHORTLIST_PER_SLOT,
  // Per-slot shortlists exist only for the retired shortlist-assembly Phase 2
  // (`generateWeeklyPlan`). The week-choice path does not read them, and
  // building them walks the whole candidate set — measured at ~300ms of a
  // ~1250ms generation, spent on an object nothing consumes. Off by default;
  // pass `withShortlists: true` if you genuinely need them.
  withShortlists = false
}) => {
  const dayCandidates = enumerateFeasibleDays({ mealDatabase, rules, preferences, tiers });
  // Scored once, here, and shared by both consumers below.
  const scoredCandidates = scoreCandidates(dayCandidates, { rules, preferences, historyMap, tiers });
  const week = selectWeek({
    mealDatabase,
    rules,
    targetDateKeys,
    historyMap,
    preferences,
    lockedDays,
    pinnedDish,
    tiers,
    beamWidth,
    maxCandidates,
    maxAlternativeWeeks,
    dayCandidates,
    scoredCandidates
  });
  const { shortlists, stats } = withShortlists
    ? buildSlotShortlists({
      weekDays: week.days,
      dayCandidates,
      rules,
      preferences,
      historyMap,
      perSlot: shortlistPerSlot,
      scoredCandidates
    })
    : { shortlists: {}, stats: {} };

  return { ...week, dayCandidates, shortlists, stats };
};
