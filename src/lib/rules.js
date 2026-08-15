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

// ─── Anchor-ingredient families ─────────────────────────────────────────────
//
// The anchor cap used to count a meal's primary ingredient (see
// `derivePrimaryIngredient` in mealDataLayer.js) directly, one counter per
// ingredient id. That missed the case a person actually notices: `Paneer
// bowl`, `Feta salad` and `Halloumi wrap` are three different ingredients and
// so were each allowed to their own cap independently — a week can read as
// "cheese, cheese, cheese" while every individual counter is still legal.
//
// `ANCHOR_FAMILY` groups ingredients that read as the same headline protein
// to a person. An ingredient absent from this map anchors itself (see
// `anchorFamilyOf`), so nothing loses cap coverage by not being named here —
// it just gets a family of one.
export const ANCHOR_FAMILY = Object.freeze({
  // Soft cheeses — the paneer/feta/halloumi/cottage-cheese cluster.
  paneer: 'cheese_soft',
  feta: 'cheese_soft',
  halloumi: 'cheese_soft',
  ricotta_partskim: 'cheese_soft',
  cottage_cheese: 'cheese_soft',
  cheese_slice: 'cheese_soft',
  // Soy-based proteins.
  tofu_firm: 'soy',
  soya_chunks: 'soy',
  edamame: 'soy',
  // Fatty/omega-3 fish, canned or fresh.
  grilled_salmon: 'oily_fish',
  smoked_salmon: 'oily_fish',
  sardines: 'oily_fish',
  mackerel_canned: 'oily_fish',
  tuna_water: 'oily_fish',
  // Lean white fish and shellfish — the light-seafood counterpart to oily_fish.
  fish_fillet: 'white_fish',
  prawns: 'white_fish',
  // Legumes where the dish is *about* the legume (rajma chawal, chana masala),
  // as opposed to a dal served alongside another headline dish.
  rajma: 'legume_feature',
  chole: 'legume_feature',
  kaala_chanaa: 'legume_feature',
  white_beans: 'legume_feature',
  // Dal-as-staple: a side/base rather than the dish's headline ingredient.
  arhar_dal: 'legume_staple',
  moong_dal_chilla: 'legume_staple',
  // Poultry.
  chicken_breast: 'poultry',
  smoked_chicken: 'poultry',
  chicken_keema: 'poultry',
  chicken_sausage: 'poultry',
  // Red meat — kept in step with `isRedMeat` in planOptimizer.js.
  beef_steak: 'red_meat',
  pork_chop: 'red_meat',
  mutton_keema: 'red_meat',
  lamb_seekh_kabab: 'red_meat',
  ham_slice: 'red_meat',
  // Eggs.
  egg_whole: 'egg',
  egg_white: 'egg',
  egg_yolk: 'egg',
  // Avocado.
  avocado: 'avocado'
});

/** Family an anchor ingredient belongs to, or the ingredient itself if unmapped. */
export const anchorFamilyOf = (primaryIngredient) => {
  if (!primaryIngredient) return null;
  return ANCHOR_FAMILY[primaryIngredient] || primaryIngredient;
};

/**
 * Per-family weekly cap used by every goal unless overridden below. 2 mirrors
 * the old per-ingredient cap, so an unmapped ingredient (a family of one)
 * keeps exactly the coverage it had before families existed.
 */
const DEFAULT_ANCHOR_FAMILY_CAP = 2;

/**
 * Builds a goal's per-family anchor caps. `poultry` and `egg` sit above the
 * default because they are catalog staples the per-meal repeat caps already
 * keep varied by name — a family ceiling at the default would make chicken
 * or egg breakfasts infeasible most weeks. `red_meat` is passed in rather
 * than hard-coded so it always matches that goal's own `redMeatMealsPerWeek`
 * instead of drifting into a second, silently different red-meat limit.
 */
const buildAnchorFamilyCaps = (redMeatMealsPerWeek) => ({
  cheese_soft: DEFAULT_ANCHOR_FAMILY_CAP,
  soy: DEFAULT_ANCHOR_FAMILY_CAP,
  oily_fish: DEFAULT_ANCHOR_FAMILY_CAP,
  white_fish: DEFAULT_ANCHOR_FAMILY_CAP,
  legume_feature: DEFAULT_ANCHOR_FAMILY_CAP,
  legume_staple: DEFAULT_ANCHOR_FAMILY_CAP,
  avocado: DEFAULT_ANCHOR_FAMILY_CAP,
  poultry: 5,
  egg: 4,
  red_meat: redMeatMealsPerWeek
});

/**
 * The cap for `family` under `rules`, falling back to the shared default for
 * any family (or unmapped ingredient acting as its own family) the goal's
 * `anchorFamilyMaxPerWeek` table does not name explicitly.
 */
export const anchorFamilyMaxPerWeek = (family, rules) => {
  const fromRules = rules?.hard?.anchorFamilyMaxPerWeek?.[family];
  return Number.isFinite(fromRules) ? fromRules : DEFAULT_ANCHOR_FAMILY_CAP;
};

/**
 * The number of days a full week contains, and how many of them are permitted
 * to break each budgeted constraint. "2 of 7" is the founder's settled call.
 */
const WEEK_DAYS = 7;
const MAX_MISS_DAYS_PER_WEEK = 2;

// ─── The quality rubric (docs/QUALITY_RUBRIC.md) ────────────────────────────
//
// R1–R3 are enforced during generation (planOptimizer), re-checked as hard
// gates after it (planValidator), and scored after the fact (planScorer). Three
// consumers, so the numbers live here — the one place this repo keeps
// thresholds — rather than being restated in each. `planScorer.RUBRIC` reads
// them from here for exactly that reason; its *penalties* (−15/−10/−5) stay
// with the scorer, since nothing else has any use for them.
//
// These are goal-independent: the rubric describes what a good week looks like
// to this user, not what a protein target implies. Each goal spreads them into
// its own `hard` block so consumers keep reading `rules.hard.*` uniformly.

export const RUBRIC_LIMITS = Object.freeze({
  // R1 — every dish at most once a week, except one optional pinned dish.
  maxDishRepeatsPerWeek: 1,
  pinnedDishMaxPerWeek: 3,
  // R2 — egg-anchored breakfasts, a floor as well as a ceiling.
  eggBreakfastsMin: 3,
  eggBreakfastsMax: 4,
  // Anchor ingredients that make a breakfast "an egg breakfast". Matches on
  // the anchor, not the name, so `egg_noodles` at dinner can never count.
  eggAnchorIngredients: Object.freeze(['egg_whole', 'egg_white', 'egg_yolk']),
  // R3 — the only free pattern is Indian lunch + non-Indian dinner.
  lunchCuisine: 'indian'
});

const GOAL_DEFINITIONS = {
  [GOAL.HIGH_PROTEIN]: {
    label: 'High protein',
    defaultDailyProteinTarget: 120,
    hard: {
      minMealProtein: 20,
      dailyProteinSanityFloor: 50,
      maxSameMealPerDay: 1,
      // R1 replaces the old per-slot repeat caps (breakfast 4, lunch/dinner 2).
      // Those were what let a week carry four different rajma dinners and two
      // identical lunches while breaking no rule.
      ...RUBRIC_LIMITS,
      // Counts the *anchor ingredient*, not the meal name. Name-based repeat
      // caps let `Rajma chawal + raita` and `Rajma + paneer bowl` each appear
      // twice — four rajma dinners in one week, all individually legal.
      maxSamePrimaryIngredientPerWeek: 2,
      anchorFamilyMaxPerWeek: buildAnchorFamilyCaps(3),
      redMeatMealsPerWeek: 3,
      // A meal is excluded outright once the user's avoid score passes this.
      avoidScoreExclusiveMax: 3,
      weeklyProteinFloorRatio: 0.85
      // No hard dinner taper. The old `dinnerWeightAllowed: ['Light','Medium']`
      // excluded every `Heavy` meal from dinner, which removed the three
      // highest-protein dishes in the catalog (61g, 56g, 46g) — the goal was
      // fighting its own rules. Tapering is now Tier 3, by calories, via
      // `scored.dinnerCalorieShareTarget`.
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
      // R4 — lunch and dinner both flatbread/pasta. Scored, never a gate: it
      // genuinely conflicts with the macro budgets (18 of 28 Indian lunches
      // are flatbread), so a hard rule here would trade a -5 for an
      // out-of-band day. Weighted just above the taper so the beam gives it up
      // only when a budget is at stake.
      bothFlatbreadPastaPenalty: 16,
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
      ...RUBRIC_LIMITS,
      maxSamePrimaryIngredientPerWeek: 2,
      anchorFamilyMaxPerWeek: buildAnchorFamilyCaps(4),
      redMeatMealsPerWeek: 4,
      avoidScoreExclusiveMax: 3,
      weeklyProteinFloorRatio: 0.85
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
      bothFlatbreadPastaPenalty: 16,
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
export const MEDIUM_MEAL_CALORIES = 350;
export const PROTEIN_BALANCE_MAX_GAP = 40;

/**
 * Grams of dietary fibre at which a meal counts as a fibre meal.
 *
 * 3g is the EU/FSSAI "source of fibre" claim threshold — a real regulatory
 * definition for a per-serving bar, and a meal is at least a serving. The
 * "high in fibre" bar of 6g was the obvious alternative and was rejected on a
 * measurement: at 6g only 15 of 41 catalog meals qualify and *no* breakfast
 * that clears the 20g protein floor does, which would make the prompt's
 * "prefer 2 of 3 daily meals with fibre" unsatisfiable at breakfast by
 * construction.
 *
 * At 3g, 30 of 41 meals qualify and the ones excluded are the ones a human
 * would exclude by eye: poha (0.9g), chicken red curry + rice (1.1g), fish
 * curry + rice (1.2g), pad krapow (1.6g), chicken soup + salmon salad (1.8g),
 * scrambled eggs + toast (1.9g).
 *
 * This is a new constant, not a changed one. No Tier-1/2/3 threshold moved.
 */
export const FIBRE_MEAL_THRESHOLD = 3;

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
/**
 * R2's floor, pro-rated for partial-week runs exactly as `allowedMissDays`
 * pro-rates the Tier-2 budgets. A 4-day remainder is owed 1 egg breakfast, not
 * the full week's 3 — asking 3 of 4 days would be a stricter rule than the one
 * a whole week is judged by.
 *
 * The *ceiling* is deliberately not pro-rated: `seedWeekState` counts the egg
 * breakfasts already sitting in locked days, so it is genuinely a weekly
 * count and stays at `eggBreakfastsMax`.
 */
export const eggBreakfastsFloor = (dayCount, rules) => {
  const days = Math.max(0, Math.floor(asFiniteNumber(dayCount, 0)));
  const perWeek = asFiniteNumber(rules?.hard?.eggBreakfastsMin, RUBRIC_LIMITS.eggBreakfastsMin);
  return Math.floor((days * perWeek) / WEEK_DAYS);
};

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
