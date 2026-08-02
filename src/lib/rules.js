/**
 * rules.js — the single source of truth for meal-planning constraints.
 *
 * Every engine that decides whether a plan is acceptable (the deterministic
 * day generator in `plannerGenerator.js`, the week optimizer in
 * `planOptimizer.js`, and the post-generation validator in
 * `planValidator.js`) reads its thresholds from here. Nothing else may
 * hard-code a numeric limit.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The model: AIM DAILY, JUDGE WEEKLY.
 *
 * Every day is *targeted* at the daily protein goal, but a week is accepted
 * or rejected on weekly performance. Up to 2 of 7 days may fall out of band,
 * and those days are genuinely flexible — there is deliberately no meaningful
 * per-day protein floor beyond a 50g sanity check. What keeps the week sound
 * is the weekly protein floor, which forces the other five days to compensate.
 *
 * Rules are split into three tiers:
 *
 *   Tier 1 — HARD      Never violate. A plan containing one is invalid.
 *   Tier 2 — BUDGETED  Violations are allowed, counted, and capped per week.
 *   Tier 3 — SCORED    Never reject; used only to rank otherwise-legal plans.
 */

// ─── Goal identifiers ───────────────────────────────────────────────────────
//
// Three layers used to disagree about goal names: onboarding declares five
// goals, the old filter knew two, and the data layer tagged meals `two_meals`
// where onboarding said `two_meals_day`. `normalizeGoalId` reconciles the
// spelling; `getRules` refuses to serve a goal that is merely declared.

export const GOAL = {
  HIGH_PROTEIN: 'high_protein',
  STANDARD: 'standard',
  LOW_CARB: 'low_carb',
  TWO_MEALS: 'two_meals',
  VEGETARIAN: 'vegetarian'
};

/** Every goal the UI is aware of, implemented or not. */
export const DECLARED_GOALS = Object.freeze([
  GOAL.HIGH_PROTEIN,
  GOAL.STANDARD,
  GOAL.LOW_CARB,
  GOAL.TWO_MEALS,
  GOAL.VEGETARIAN
]);

/** Goals that actually have a ruleset behind them. */
export const IMPLEMENTED_GOALS = Object.freeze([GOAL.HIGH_PROTEIN, GOAL.STANDARD]);

/** Onboarding/data-layer spelling differences, resolved to the canonical id. */
export const GOAL_ALIASES = Object.freeze({
  two_meals_day: GOAL.TWO_MEALS,
  twoMeals: GOAL.TWO_MEALS,
  highProtein: GOAL.HIGH_PROTEIN,
  lowCarb: GOAL.LOW_CARB
});

export class UnsupportedGoalError extends Error {
  constructor(goal, { declared = false } = {}) {
    super(
      declared
        ? `Goal "${goal}" is declared in onboarding but has no ruleset. Implemented goals: ${IMPLEMENTED_GOALS.join(', ')}.`
        : `Unknown goal "${goal}". Implemented goals: ${IMPLEMENTED_GOALS.join(', ')}.`
    );
    this.name = 'UnsupportedGoalError';
    this.goal = goal;
    this.declared = declared;
  }
}

export const normalizeGoalId = (goal) => {
  const raw = String(goal ?? '').trim();
  if (!raw) return '';
  return GOAL_ALIASES[raw] || raw;
};

export const isDeclaredGoal = (goal) => DECLARED_GOALS.includes(normalizeGoalId(goal));
export const isImplementedGoal = (goal) => IMPLEMENTED_GOALS.includes(normalizeGoalId(goal));

// ─── Per-goal rule definitions ──────────────────────────────────────────────

const CORE_SLOTS = Object.freeze(['breakfast', 'lunch', 'dinner']);

/**
 * The number of days a full week contains, and how many of them are permitted
 * to break each budgeted constraint. "2 of 7" is the founder's settled call.
 */
const WEEK_DAYS = 7;
const MAX_MISS_DAYS_PER_WEEK = 2;

const GOAL_DEFINITIONS = {
  [GOAL.HIGH_PROTEIN]: {
    label: 'High protein',
    defaultDailyProteinTarget: 132,
    hard: {
      minMealProtein: 20,
      dailyProteinSanityFloor: 50,
      maxSameMealPerDay: 1,
      maxBreakfastRepeatsPerWeek: 4,
      maxLunchDinnerRepeatsPerWeek: 2,
      redMeatMealsPerWeek: 3,
      // A meal is excluded outright once the user's avoid score passes this.
      avoidScoreExclusiveMax: 3,
      weeklyProteinFloorRatio: 0.85,
      // Carried over verbatim from constraintFilter.js so the optimizer swap
      // changes the engine and not the rules. This excludes every `Heavy` meal
      // from dinner, which removes the three highest-protein dishes in the
      // catalog — see docs/EVAL_AND_ROADMAP.md 3.5. Replaced by the scored,
      // calorie-based taper in a later commit.
      requireDinnerTaper: true,
      dinnerWeightAllowed: ['Light', 'Medium']
    },
    budgeted: {
      proteinBandRatio: 0.10,
      dailyCarbCap: 130,
      dailyCalorieMin: 1600,
      dailyCalorieMax: 2200,
      maxMissDaysPerWeek: MAX_MISS_DAYS_PER_WEEK
    },
    scored: {
      // Protein proximity dominates: this is what "aim daily" means.
      proteinProximity: 1.0,
      outOfBandPenalty: 12,
      // Applied when a candidate day misses a Tier-2 budget, scaled up as the
      // remaining days run out of room to make it back. Without this the beam
      // fills with high-variety branches that are already doomed.
      budgetPressurePenalty: 45,
      carbOverCapPenalty: 0.35,
      calorieOutOfBoundsPenalty: 0.02,
      // Dinner tapering is a preference, not an exclusion. Expressed as the
      // share of the day's calories we would like dinner to stay under.
      dinnerCalorieShareTarget: 0.40,
      dinnerTaperPenalty: 14,
      distinctMealBonus: 6,
      repeatUsePenalty: 5,
      lunchDinnerCuisineClashPenalty: 3,
      weekCuisineVarietyBonus: 1.5,
      sameProteinFamilyTwiceInDayPenalty: 4,
      fibreBonus: 1.5,
      preferenceAcceptWeight: 2.5,
      preferenceEditWeight: 1.0,
      preferenceAvoidWeight: 3.0,
      historyRepeatPenalty: 2.5
    }
  },

  [GOAL.STANDARD]: {
    label: 'Standard / balanced',
    defaultDailyProteinTarget: 100,
    hard: {
      minMealProtein: 12,
      dailyProteinSanityFloor: 40,
      maxSameMealPerDay: 1,
      maxBreakfastRepeatsPerWeek: 3,
      maxLunchDinnerRepeatsPerWeek: 2,
      redMeatMealsPerWeek: 4,
      avoidScoreExclusiveMax: 3,
      weeklyProteinFloorRatio: 0.85,
      requireDinnerTaper: false,
      dinnerWeightAllowed: null
    },
    budgeted: {
      proteinBandRatio: 0.10,
      // No hard carb target for `standard` — the cap exists but never binds.
      dailyCarbCap: Infinity,
      dailyCalorieMin: 1800,
      dailyCalorieMax: 2400,
      maxMissDaysPerWeek: MAX_MISS_DAYS_PER_WEEK
    },
    scored: {
      proteinProximity: 0.6,
      outOfBandPenalty: 8,
      budgetPressurePenalty: 45,
      carbOverCapPenalty: 0,
      calorieOutOfBoundsPenalty: 0.02,
      dinnerCalorieShareTarget: 0.40,
      dinnerTaperPenalty: 8,
      // `standard`'s stated priority is maximum catalog coverage.
      distinctMealBonus: 10,
      repeatUsePenalty: 8,
      lunchDinnerCuisineClashPenalty: 4,
      weekCuisineVarietyBonus: 2.5,
      sameProteinFamilyTwiceInDayPenalty: 3,
      fibreBonus: 3,
      preferenceAcceptWeight: 2.5,
      preferenceEditWeight: 1.0,
      preferenceAvoidWeight: 3.0,
      historyRepeatPenalty: 2.5
    }
  }
};

// ─── Tier-3 thresholds shared by every goal ─────────────────────────────────
//
// These describe meals, not limits, so they are goal-independent. They used
// to live as loose constants in `plannerGenerator.js`.

export const CARB_HEAVY_THRESHOLD = 55;
export const FAT_HEAVY_THRESHOLD = 25;
export const HEAVY_MEAL_CALORIES = 600;
export const PROTEIN_BALANCE_MAX_GAP = 40;

// ─── Derivation helpers ─────────────────────────────────────────────────────

const asFiniteNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * How many days of a `dayCount`-day run may break a budgeted constraint.
 *
 * Pro-rated from "2 of 7" and floored, so partial regenerations do not
 * quietly buy themselves a full week's worth of allowances: a 7-day week gets
 * 2 misses, a 4-day remainder gets 1, and a 1-day regeneration gets none.
 */
export const allowedMissDays = (dayCount, rules) => {
  const days = Math.max(0, Math.floor(asFiniteNumber(dayCount, 0)));
  const perWeek = asFiniteNumber(rules?.budgeted?.maxMissDaysPerWeek, MAX_MISS_DAYS_PER_WEEK);
  return Math.floor((days * perWeek) / WEEK_DAYS);
};

/** The minimum number of `dayCount` days that must satisfy a budgeted rule. */
export const requiredCompliantDays = (dayCount, rules) => {
  const days = Math.max(0, Math.floor(asFiniteNumber(dayCount, 0)));
  return days - allowedMissDays(days, rules);
};

/** The weekly protein floor in grams for a run of `dayCount` days. */
export const weeklyProteinFloor = (dayCount, rules) => {
  const days = Math.max(0, Math.floor(asFiniteNumber(dayCount, 0)));
  const target = asFiniteNumber(rules?.dailyProteinTarget, 0);
  const ratio = asFiniteNumber(rules?.hard?.weeklyProteinFloorRatio, 0.85);
  return Math.round(days * target * ratio);
};

/**
 * Resolve a goal + optional protein target into a frozen ruleset.
 *
 * Throws `UnsupportedGoalError` for anything not in `IMPLEMENTED_GOALS` —
 * including goals onboarding declares but nobody built. Silently falling back
 * to `high_protein` is how a vegetarian used to get a week of chicken.
 */
export const getRules = (goal, { dailyProteinTarget } = {}) => {
  const id = normalizeGoalId(goal);
  const definition = GOAL_DEFINITIONS[id];
  if (!definition) throw new UnsupportedGoalError(goal, { declared: isDeclaredGoal(goal) });

  const target = Math.max(
    1,
    asFiniteNumber(dailyProteinTarget, definition.defaultDailyProteinTarget)
  );
  const bandRatio = definition.budgeted.proteinBandRatio;

  const rules = {
    goal: id,
    label: definition.label,
    slots: CORE_SLOTS,
    weekDays: WEEK_DAYS,
    dailyProteinTarget: target,
    hard: { ...definition.hard },
    budgeted: {
      ...definition.budgeted,
      dailyProteinMin: Math.round(target * (1 - bandRatio)),
      dailyProteinMax: Math.round(target * (1 + bandRatio))
    },
    scored: { ...definition.scored }
  };

  // Convenience: the canonical 7-day figures, so callers reporting against the
  // acceptance criteria do not have to re-derive them.
  rules.week = {
    nominalProtein: Math.round(WEEK_DAYS * target),
    proteinFloor: weeklyProteinFloor(WEEK_DAYS, rules),
    minDaysProteinInBand: requiredCompliantDays(WEEK_DAYS, rules),
    minDaysUnderCarbCap: requiredCompliantDays(WEEK_DAYS, rules),
    minDaysInCalorieBounds: requiredCompliantDays(WEEK_DAYS, rules)
  };

  return Object.freeze({
    ...rules,
    hard: Object.freeze(rules.hard),
    budgeted: Object.freeze(rules.budgeted),
    scored: Object.freeze(rules.scored),
    week: Object.freeze(rules.week)
  });
};

/**
 * Ruleset for a goal, falling back to `high_protein` when the goal is missing
 * entirely (a fresh profile) but still throwing for a goal that was chosen and
 * is not implemented. Use this at UI entry points where an unset profile is
 * legitimate; use `getRules` everywhere else.
 */
export const getRulesForProfile = (goal, options) =>
  getRules(normalizeGoalId(goal) || GOAL.HIGH_PROTEIN, options);

export { CORE_SLOTS, WEEK_DAYS, MAX_MISS_DAYS_PER_WEEK };
