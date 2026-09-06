/**
 * planValidator.js — the post-generation check that did not exist.
 *
 * Whatever the model returned used to be written straight into the plan. There
 * was no validation, no repair loop and no retry — `constraintFilter.js:153`
 * even claimed the calorie floor "is checked post-generation" when no such
 * check existed anywhere in the codebase.
 *
 * Everything here reads its thresholds from `rules.js`, so the validator, the
 * optimizer and the single-day generator cannot drift apart.
 *
 * Contract: `validateWeek` never throws on a bad plan — it returns structured
 * violations. `repairWeek` fixes them deterministically and re-validates.
 * Callers must not persist a week that comes back invalid.
 */

import { maxPerWeek as tierMaxPerWeek } from './mealTiers.js';
import {
  anchorFamilyMaxPerWeek,
  eggBreakfastsFloor,
  requiredCompliantDays,
  weeklyProteinFloor
} from './rules.js';
import {
  CORE_SLOTS,
  annotateDay,
  daySignatureCollisions,
  getMealName,
  getMealCuisine,
  getMealProtein,
  isRedMeat,
  selectWeek,
  summariseWeek
} from './planOptimizer.js';

export const TIER = { HARD: 1, BUDGETED: 2 };

const violation = (fields) => ({ tier: TIER.HARD, scope: 'week', ...fields });

// ─── Resolving model output back into catalog meals ─────────────────────────

/**
 * Turn `[{ dateKey, breakfast: 'name', ... }]` into days holding real meals.
 *
 * Meal names used to be matched by lowercased exact match, and a near-miss
 * silently fell back to whatever was already in the slot with no error. Here a
 * name that does not resolve becomes an `unresolved_meal` violation instead.
 */
export const resolveWeek = ({ days = [], mealDatabase, rules }) => {
  const catalog = [
    ...(mealDatabase?.breakfast || []),
    ...(mealDatabase?.lunchDinner || []),
    ...(mealDatabase?.snack || [])
  ];
  const byName = new Map();
  for (const meal of catalog) {
    for (const key of [meal.canonical_name, meal.name]) {
      if (key) byName.set(String(key).trim().toLowerCase(), meal);
    }
  }

  const resolved = [];
  const violations = [];

  for (const day of days) {
    const entry = { dateKey: day?.dateKey };
    for (const slot of CORE_SLOTS) {
      const raw = day?.[slot];
      const meal = typeof raw === 'string' ? byName.get(raw.trim().toLowerCase()) : raw;
      if (!meal) {
        violations.push(violation({
          code: 'unresolved_meal',
          scope: 'day',
          dateKey: day?.dateKey,
          slot,
          actual: typeof raw === 'string' ? raw : null,
          message: `No catalog meal matches "${raw ?? ''}" for ${slot} on ${day?.dateKey}`
        }));
        continue;
      }
      entry[slot] = meal;
    }
    resolved.push(CORE_SLOTS.every((slot) => entry[slot]) ? { ...annotateDay(entry, rules), dateKey: entry.dateKey } : entry);
  }

  return { days: resolved, violations };
};

// ─── Validation ─────────────────────────────────────────────────────────────

const collectDayViolations = ({ day, rules, preferences }) => {
  const found = [];
  const dateKey = day.dateKey;
  const meals = CORE_SLOTS.map((slot) => day[slot]);

  if (meals.some((meal) => !meal)) {
    found.push(violation({ code: 'incomplete_day', scope: 'day', dateKey, message: `${dateKey} is missing a meal` }));
    return found;
  }

  for (let i = 0; i < CORE_SLOTS.length; i += 1) {
    const meal = meals[i];
    const protein = getMealProtein(meal);
    if (protein < rules.hard.minMealProtein) {
      found.push(violation({
        code: 'meal_below_protein_floor',
        scope: 'day',
        dateKey,
        slot: CORE_SLOTS[i],
        actual: protein,
        limit: rules.hard.minMealProtein,
        message: `${getMealName(meal)} has ${protein}g protein, below the ${rules.hard.minMealProtein}g per-meal floor`
      }));
    }
    const avoidScore = Number(preferences?.avoids?.[getMealName(meal)] || 0);
    if (avoidScore > rules.hard.avoidScoreExclusiveMax) {
      found.push(violation({
        code: 'avoided_meal_used',
        scope: 'day',
        dateKey,
        slot: CORE_SLOTS[i],
        actual: avoidScore,
        limit: rules.hard.avoidScoreExclusiveMax,
        message: `${getMealName(meal)} is avoided (score ${avoidScore}) on ${dateKey}`
      }));
    }
  }

  const names = meals.map(getMealName);
  const counts = {};
  for (const name of names) counts[name] = (counts[name] || 0) + 1;
  for (const [name, count] of Object.entries(counts)) {
    if (count > rules.hard.maxSameMealPerDay) {
      found.push(violation({
        code: 'duplicate_meal_in_day',
        scope: 'day',
        dateKey,
        actual: count,
        limit: rules.hard.maxSameMealPerDay,
        message: `${name} appears ${count} times on ${dateKey}`
      }));
    }
  }

  // R3 is deliberately absent from this function. It was a Tier-1, day-scoped
  // violation; it is now a Tier-2 budget counted across the week in
  // `collectWeekViolations`, because a single day breaking the cuisine
  // direction is no longer a defect — two of them a week are allowed.

  // R5 — no signature ingredient twice in the same day. Hard here as well as
  // at enumeration, for the same reason R3 is: Phase 2 hands the model flat
  // per-slot shortlists with the day structure thrown away, so a recombination
  // can put paneer at breakfast and palak paneer at lunch and nothing
  // downstream would notice. Day-scoped, so repair replaces just this day.
  const signatureCap = rules.hard.maxSameSignatureIngredientPerDay;
  if (Number.isFinite(signatureCap)) {
    for (const ingredientId of daySignatureCollisions(day, signatureCap)) {
      found.push(violation({
        code: 'signature_ingredient_repeated_in_day',
        scope: 'day',
        dateKey,
        actual: ingredientId,
        limit: signatureCap,
        message: `${dateKey} uses ${ingredientId} in more than ${signatureCap} slot(s)`
      }));
    }
  }

  const protein = day.totals?.protein ?? meals.reduce((sum, meal) => sum + getMealProtein(meal), 0);
  if (protein < rules.hard.dailyProteinSanityFloor) {
    found.push(violation({
      code: 'day_below_sanity_floor',
      scope: 'day',
      dateKey,
      actual: protein,
      limit: rules.hard.dailyProteinSanityFloor,
      message: `${dateKey} totals ${protein}g protein, below the ${rules.hard.dailyProteinSanityFloor}g sanity floor`
    }));
  }

  return found;
};

const collectWeekViolations = ({ days, rules, lockedDays, summary, pinnedDish = null, tiers = null }) => {
  const found = [];
  const dayCount = days.length;

  // R1 — every dish at most once a week, one optional pinned dish up to 3.
  // One counter across all three slots, not one per slot: a dish eaten at
  // lunch on Monday and at dinner on Thursday is a repeat to the person
  // eating it, which the old split breakfast/lunch-dinner ceilings could not
  // express. See docs/QUALITY_RUBRIC.md R1.
  const dishUse = {};
  let eggBreakfasts = 0;
  const tally = (day) => {
    for (const slot of CORE_SLOTS) {
      const name = getMealName(day?.[slot]);
      if (name) dishUse[name] = (dishUse[name] || 0) + 1;
    }
    if (day?.breakfast && rules.hard.eggAnchorIngredients.includes(day.breakfast.primary_ingredient)) {
      eggBreakfasts += 1;
    }
  };
  days.forEach(tally);
  Object.values(lockedDays || {}).forEach(tally);

  for (const [name, count] of Object.entries(dishUse)) {
    // Same resolution order as `dishCap` in planOptimizer.js: tier, then the
    // legacy pin, then the flat default. The two must agree — if the validator
    // used the flat cap while the optimizer used the tier, every week
    // containing a staple would be "repaired" back into a week without one.
    const hasTier = tiers && Object.prototype.hasOwnProperty.call(tiers, name);
    const isPinned = !hasTier && pinnedDish && name === pinnedDish;
    const limit = hasTier
      ? tierMaxPerWeek(name, tiers)
      : (isPinned ? rules.hard.pinnedDishMaxPerWeek : rules.hard.maxDishRepeatsPerWeek);
    if (count > limit) {
      found.push(violation({
        code: 'dish_repeat_exceeded',
        actual: count,
        limit,
        message: `${name} is used ${count} times this week (max ${limit}${hasTier ? `, tier ${tiers[name]}` : (isPinned ? ', pinned' : '')})`
      }));
    }
  }

  // R2 — egg-anchored breakfasts, a floor as well as a ceiling. The floor
  // pro-rates for partial runs exactly as the Tier-2 budgets do.
  // Pro-rated on `dayCount` (the days under validation), matching how the
  // weekly protein floor and the Tier-2 budgets below already scale.
  const eggFloor = eggBreakfastsFloor(dayCount, rules);
  if (eggBreakfasts < eggFloor) {
    found.push(violation({
      code: 'egg_breakfasts_below_floor',
      actual: eggBreakfasts,
      limit: eggFloor,
      message: `${eggBreakfasts} egg-anchored breakfasts across ${dayCount} days (min ${eggFloor})`
    }));
  }
  if (eggBreakfasts > rules.hard.eggBreakfastsMax) {
    found.push(violation({
      code: 'egg_breakfasts_above_ceiling',
      actual: eggBreakfasts,
      limit: rules.hard.eggBreakfastsMax,
      message: `${eggBreakfasts} egg-anchored breakfasts (max ${rules.hard.eggBreakfastsMax})`
    }));
  }

  // annotateDay computes each day's order-independent dish set and its
  // anchor-ingredient families the same way the optimizer does during
  // construction, so the validator cannot drift into checking a stricter or
  // looser rule than the search actually enforced.
  const annotated = [...days, ...Object.values(lockedDays || {})]
    .filter(Boolean)
    .map((day) => annotateDay(day, rules));

  // Two identical days in one week — same dishes, any slot order. Never had
  // a rule: the per-meal weekly repeat caps allow each meal twice, so a
  // whole day repeating (even lunch and dinner merely swapped) broke
  // nothing while being the single most obvious defect a person sees in a
  // generated plan.
  const seenDays = new Map();
  for (const { dishSetKey } of annotated) {
    if (!dishSetKey) continue;
    seenDays.set(dishSetKey, (seenDays.get(dishSetKey) || 0) + 1);
  }
  for (const [key, count] of seenDays) {
    if (count > 1) {
      found.push(violation({
        code: 'duplicate_day_in_week',
        actual: count,
        limit: 1,
        message: `The same day (${key.split('|').join(' / ')}) appears ${count} times this week`
      }));
    }
  }

  // Anchor-ingredient-family cap, counting breakfast, lunch and dinner alike.
  // Name-based repeat limits miss this entirely: two differently-named rajma
  // dishes were each allowed twice, producing four rajma meals in a week
  // with no rule broken; grouping by family also catches a paneer breakfast,
  // a feta lunch and a halloumi dinner reading as "cheese all day."
  const familyUse = {};
  for (const { anchorFamilies } of annotated) {
    for (const family of anchorFamilies || []) {
      familyUse[family] = (familyUse[family] || 0) + 1;
    }
  }
  for (const [family, count] of Object.entries(familyUse)) {
    const familyCap = anchorFamilyMaxPerWeek(family, rules);
    if (count > familyCap) {
      found.push(violation({
        code: 'anchor_family_repeat_exceeded',
        actual: count,
        limit: familyCap,
        message: `${family} anchors ${count} meals this week (max ${familyCap})`
      }));
    }
  }

  const redMeat = [...days, ...Object.values(lockedDays || {})]
    .flatMap((day) => CORE_SLOTS.map((slot) => day?.[slot]))
    .filter(Boolean)
    .filter(isRedMeat).length;
  if (redMeat > rules.hard.redMeatMealsPerWeek) {
    found.push(violation({
      code: 'red_meat_cap_exceeded',
      actual: redMeat,
      limit: rules.hard.redMeatMealsPerWeek,
      message: `${redMeat} red-meat meals this week (max ${rules.hard.redMeatMealsPerWeek})`
    }));
  }

  const floor = weeklyProteinFloor(dayCount, rules);
  if (summary.totalProtein < floor) {
    found.push(violation({
      code: 'weekly_protein_below_floor',
      actual: summary.totalProtein,
      limit: floor,
      message: `Week totals ${summary.totalProtein}g protein, below the ${floor}g floor (${rules.hard.weeklyProteinFloorRatio * 100}% of ${summary.nominalProtein}g nominal)`
    }));
  }

  // Tier 2 — budgeted. These are the rules a week is allowed to break on up to
  // 2 of 7 days; only blowing the budget is a violation.
  const required = requiredCompliantDays(dayCount, rules);
  const budgets = [
    { code: 'protein_band_budget_exceeded', actual: summary.daysProteinInBand, label: 'in the protein band' },
    { code: 'carb_cap_budget_exceeded', actual: summary.daysUnderCarbCap, label: 'under the carb cap' },
    { code: 'calorie_bounds_budget_exceeded', actual: summary.daysInCalorieBounds, label: 'within calorie bounds' },
    // R3, now a budget. This slot previously read `summary.daysCuisineBalanced`
    // — a field `summariseWeek` stopped computing when R3 replaced the old
    // cuisine-balance rule — so `actual` was `undefined`, `undefined < required`
    // is false, and the check silently never fired. It is now wired to the
    // figure the summary actually produces.
    {
      code: 'cuisine_direction_budget_exceeded',
      actual: summary.daysR3Compliant,
      label: `${rules.hard.lunchCuisine} lunch + non-${rules.hard.lunchCuisine} dinner (R3)`
    }
  ];
  for (const budget of budgets) {
    if (budget.actual < required) {
      found.push({
        tier: TIER.BUDGETED,
        scope: 'week',
        code: budget.code,
        actual: budget.actual,
        limit: required,
        message: `Only ${budget.actual} of ${dayCount} days are ${budget.label} (need ${required})`
      });
    }
  }

  return found;
};

/**
 * Validate a week against all three tiers.
 *
 * @returns {{ valid: boolean, violations: Array, summary: Object,
 *             hardViolations: Array, budgetViolations: Array,
 *             invalidDateKeys: string[] }}
 */
export const validateWeek = ({ days = [], rules, preferences = {}, lockedDays = {}, pinnedDish = null, tiers = null }) => {
  const annotated = days.map((day) => (day.totals ? day : { ...annotateDay(day, rules), dateKey: day.dateKey }));
  const summary = summariseWeek(annotated, rules);

  const violations = [
    ...annotated.flatMap((day) => collectDayViolations({ day, rules, preferences })),
    ...collectWeekViolations({ days: annotated, rules, lockedDays, summary, pinnedDish, tiers })
  ];

  const hardViolations = violations.filter((v) => v.tier === TIER.HARD);
  const budgetViolations = violations.filter((v) => v.tier === TIER.BUDGETED);

  return {
    valid: violations.length === 0,
    violations,
    hardViolations,
    budgetViolations,
    summary,
    days: annotated,
    invalidDateKeys: Array.from(
      new Set(violations.filter((v) => v.scope === 'day' && v.dateKey).map((v) => v.dateKey))
    )
  };
};

/** One-line-per-violation text, suitable for logs or for feeding back to the model. */
export const formatViolations = (violations = []) =>
  violations.map((v) => `- [tier ${v.tier}] ${v.code}: ${v.message}`).join('\n');

// ─── Repair ─────────────────────────────────────────────────────────────────

/**
 * Fix a week deterministically, keeping as much of the original selection as
 * the rules allow.
 *
 * Two passes, in order of how much they throw away:
 *   1. Re-optimize only the days carrying a Tier-1 violation, treating the
 *      rest of the week as locked.
 *   2. If budgets are still blown, re-optimize the whole run from scratch.
 *
 * The second pass is the deterministic reference week, so this always
 * terminates with the best week the catalog can produce — which may still be
 * invalid if the catalog simply cannot satisfy the rules. That case is
 * reported, never silently written.
 */
export const repairWeek = ({
  days = [],
  mealDatabase,
  rules,
  preferences = {},
  historyMap = {},
  lockedDays = {},
  pinnedDish = null,
  tiers = null
}) => {
  const initial = validateWeek({ days, rules, preferences, lockedDays, pinnedDish, tiers });
  if (initial.valid) {
    return { days: initial.days, validation: initial, repaired: false, strategy: 'none' };
  }

  const targetDateKeys = days.map((day) => day.dateKey).filter(Boolean);

  // Pass 1 — replace only the days that broke a hard rule.
  const brokenDates = new Set(
    initial.hardViolations.filter((v) => v.scope === 'day' && v.dateKey).map((v) => v.dateKey)
  );
  if (brokenDates.size > 0 && brokenDates.size < targetDateKeys.length) {
    const keptDays = initial.days.filter((day) => !brokenDates.has(day.dateKey));
    const keptLocked = { ...lockedDays };
    for (const day of keptDays) keptLocked[day.dateKey] = day;

    const replacement = selectWeek({
      mealDatabase,
      rules,
      targetDateKeys: targetDateKeys.filter((dateKey) => brokenDates.has(dateKey)),
      historyMap,
      preferences,
      lockedDays: keptLocked,
      pinnedDish,
      tiers
    });

    const merged = mergeByDate(initial.days, replacement.days);
    const validation = validateWeek({ days: merged, rules, preferences, lockedDays, pinnedDish, tiers });
    if (validation.valid) {
      return { days: validation.days, validation, repaired: true, strategy: 'replaced_invalid_days' };
    }
  }

  // Pass 2 — rebuild the whole run deterministically.
  const rebuilt = selectWeek({
    mealDatabase,
    rules,
    targetDateKeys,
    historyMap,
    preferences,
    lockedDays,
    pinnedDish,
    tiers
  });
  const validation = validateWeek({ days: rebuilt.days, rules, preferences, lockedDays, pinnedDish, tiers });

  return {
    days: validation.days,
    validation,
    repaired: true,
    strategy: 'regenerated_week',
    // True when even the deterministic optimizer cannot satisfy the rules on
    // this catalog — a Phase 2 finding, not a bug in the caller.
    catalogInfeasible: !validation.valid
  };
};

const mergeByDate = (original, replacements) => {
  const byDate = new Map(replacements.map((day) => [day.dateKey, day]));
  return original.map((day) => byDate.get(day.dateKey) || day);
};

/**
 * The full post-generation path: resolve names, validate, repair if needed.
 *
 * Callers persist `result.days` only when `result.validation.valid` is true,
 * or knowingly persist a repaired-but-still-invalid week having surfaced
 * `result.validation.violations` to the user.
 */
export const validateAndRepairWeek = ({
  days = [],
  mealDatabase,
  rules,
  preferences = {},
  historyMap = {},
  lockedDays = {},
  pinnedDish = null,
  tiers = null
}) => {
  // A day carrying an unresolvable name comes back incomplete, which
  // `validateWeek` reports as `incomplete_day` — a Tier-1, day-scoped
  // violation, so repair replaces that day rather than dropping the date.
  const { days: resolved, violations: resolutionViolations } = resolveWeek({ days, mealDatabase, rules });

  const repair = repairWeek({
    days: resolved,
    mealDatabase,
    rules,
    preferences,
    historyMap,
    lockedDays,
    pinnedDish,
    tiers
  });

  return { ...repair, resolutionViolations };
};
