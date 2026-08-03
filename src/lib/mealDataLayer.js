const GOAL_NAMES = ['high_protein', 'low_carb', 'two_meals'];
const METADATA_SIMILARITY_FIELDS = ['format', 'protein_family', 'carb_level', 'cuisine'];

import { ingredients } from '../data/ingredients.js';
import {
  FAT_HEAVY_THRESHOLD,
  FIBRE_MEAL_THRESHOLD,
  HEAVY_MEAL_CALORIES,
  MEDIUM_MEAL_CALORIES
} from './rules.js';

const ALLOWED_MEAL_TYPE_TAGS = new Set(['breakfast', 'lunch_dinner', 'snack']);
const ALLOWED_PROTEIN_FAMILIES = new Set(['chicken', 'fish', 'red_meat', 'vegetarian', 'mixed']);
const ALLOWED_CARB_LEVELS = new Set(['low', 'medium', 'high']);
const ALLOWED_FORMATS = new Set(['curry', 'soup', 'salad', 'toast', 'sandwich', 'chaat', 'bowl', 'plate']);
const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const round1 = (value) => Number(Number(value).toFixed(1));
const round2 = (value) => Number(Number(value).toFixed(2));

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

const normalizedText = (...parts) =>
  parts
    .flat()
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');

const has = (text, pattern) => pattern.test(text);

export const computeMacros = (parts = []) => {
  const totals = { cal: 0, p: 0, c: 0, f: 0, fibre: 0 };

  for (const part of parts) {
    const ing = ingredients[part.ingredientId];
    if (!ing || !ing.per100g) continue;

    let weightG = part.qty;

    // If unit is piece/slice, use the pieceWeightG to determine total mass
    if (part.unit === 'piece' || part.unit === 'slice') {
      const pieceWeight = ing.defaultPortion?.pieceWeightG || 100; // Fallback to 100 if undefined
      weightG = part.qty * pieceWeight;
    }

    const ratio = weightG / 100;
    totals.cal += (ing.per100g.kcal || 0) * ratio;
    totals.p += (ing.per100g.p || 0) * ratio;
    totals.c += (ing.per100g.c || 0) * ratio;
    totals.f += (ing.per100g.f || 0) * ratio;
    totals.fibre += (ing.per100g.fibre || 0) * ratio;
  }

  return {
    cal: Math.round(totals.cal),
    protein: Math.round(totals.p),
    macros: {
      p: Math.round(totals.p),
      c: Math.round(totals.c),
      f: Math.round(totals.f),
      // Fibre keeps one decimal: whole grams would round a 0.4g garnish to
      // zero and a 2.5g side to 3, and the has_fibre threshold sits at 5.
      fibre: round1(totals.fibre)
    }
  };
};

export const normalizeMealTypeTag = (mealType = '') => {
  if (mealType === 'lunchDinner') return 'lunch_dinner';
  const normalized = String(mealType || '').trim().toLowerCase();
  if (normalized === 'lunch_dinner') return 'lunch_dinner';
  if (ALLOWED_MEAL_TYPE_TAGS.has(normalized)) return normalized;
  return 'breakfast';
};

export const inferProteinFamily = (meal = {}) => {
  const text = normalizedText(
    meal.components?.protein,
    meal.components?.veg,
    meal.name,
    meal.canonical_name,
    meal.display_name
  );

  const hasChicken = has(text, /\bchicken\b/);
  const hasFish = has(text, /\b(fish|salmon|tuna|prawn|shrimp|seafood|tilapia|cod|mackerel|sardines?|anchov(y|ies))\b/);

  // `keema` and `kofta` name a preparation — mince and dumpling — not an
  // animal. Treating them as red meat outright classified `Soya keema curry`
  // as red meat, which would have spent the 3-per-week red-meat budget on a
  // vegetarian dish and hidden it from a vegetarian ruleset. They only imply
  // red meat when nothing else in the dish says what the protein is.
  const hasDefiniteRedMeat = has(text, /\b(beef|steak|mutton|lamb|pork|ham|goat|bacon)\b/);
  const hasVegetarianProtein = has(
    text,
    /\b(soya|soy|tofu|tempeh|paneer|mushroom|lentil|dal|chana|chickpea|rajma|bean|egg|eggs)\b/
  );
  const hasAmbiguousMince = has(text, /\b(keema|kofta)\b/);
  const hasRedMeat =
    hasDefiniteRedMeat
    || (hasAmbiguousMince && !hasChicken && !hasFish && !hasVegetarianProtein);

  const nonVegCount = [hasChicken, hasFish, hasRedMeat].filter(Boolean).length;
  if (nonVegCount > 1) return 'mixed';
  if (hasChicken) return 'chicken';
  if (hasFish) return 'fish';
  if (hasRedMeat) return 'red_meat';
  return 'vegetarian';
};

export const inferMealWeightClass = (meal = {}) => {
  const calories = asNumber(meal.cal);
  if (!Number.isFinite(calories)) return 'medium';
  if (calories > HEAVY_MEAL_CALORIES) return 'heavy';
  if (calories >= MEDIUM_MEAL_CALORIES) return 'medium';
  return 'light';
};

// ─── Derived meal tags ──────────────────────────────────────────────────────
//
// These three fields used to be hand-typed in `csvTagsMap` alongside computed
// macros, and they disagreed with the macros they sat next to: 12 of 41 meals
// on `is_fat_heavy`, 3 of 41 on `meal_weight`, and `has_fibre` by a margin
// that depended entirely on which heuristic you asked. A hand-typed field
// beside a computed one always drifts, so all three are now derived from the
// ingredient list and the hand-authored map keeps only subjective fields.
//
// Each rule is stated once, here, and reads its threshold from `rules.js`.

/** Fat-heavy: more than FAT_HEAVY_THRESHOLD (25g) of fat in the meal. */
export const deriveIsFatHeavy = (meal = {}) => asNumber(meal.macros?.f) > FAT_HEAVY_THRESHOLD;

/**
 * Fibre meal: at least FIBRE_MEAL_THRESHOLD (3g) of rolled-up dietary fibre.
 * See the constant's comment in `rules.js` for why 3g and not 6g.
 */
export const deriveHasFibre = (meal = {}) => asNumber(meal.macros?.fibre) >= FIBRE_MEAL_THRESHOLD;

/**
 * Display weight label, by calories: >600 Heavy, >=350 Medium, else Light.
 * Display and reporting only — Phase 1 made dinner tapering calorie-based, so
 * nothing in the engine reads this label any more.
 */
export const deriveMealWeight = (meal = {}) => {
  const cls = inferMealWeightClass(meal);
  return cls.charAt(0).toUpperCase() + cls.slice(1);
};

/** All three derived tags for a meal that already has computed macros. */
export const deriveMealTags = (meal = {}) => ({
  is_fat_heavy: deriveIsFatHeavy(meal),
  has_fibre: deriveHasFibre(meal),
  meal_weight: deriveMealWeight(meal)
});

export const inferCarbLevel = (meal = {}) => {
  const carbs = asNumber(meal.macros?.c);
  if (!Number.isFinite(carbs)) return 'medium';
  if (carbs > 50) return 'high';
  if (carbs > 20) return 'medium';
  return 'low';
};

export const inferFormat = (meal = {}) => {
  const text = normalizedText(meal.name, meal.canonical_name, meal.display_name, meal.components?.style);

  if (has(text, /\bsoup\b/)) return 'soup';
  if (has(text, /\bsalad\b/)) return 'salad';
  if (has(text, /\bcurry\b/)) return 'curry';
  if (has(text, /\bsandwich\b/)) return 'sandwich';
  if (has(text, /\btoast\b/)) return 'toast';
  if (has(text, /\bchaat\b/)) return 'chaat';
  if (has(text, /\bbowl\b/)) return 'bowl';
  return 'plate';
};

export const inferEffort = (meal = {}) => {
  const componentCount = [meal.components?.protein, meal.components?.carb, meal.components?.veg].filter(Boolean).length;
  const styleText = normalizedText(meal.components?.style, meal.name, meal.canonical_name);

  if (componentCount <= 2 && (has(styleText, /\b(toast|sandwich|chaat|shake)\b/) || (meal.cal || 0) <= 320)) {
    return 'low';
  }

  if ((meal.cal || 0) > 650 || componentCount >= 4) {
    return 'high';
  }

  if (componentCount >= 3 || has(styleText, /\b(curry|tandoori|grilled|soup)\b/)) {
    return 'medium';
  }

  return 'low';
};

export const scoreGoalHighProtein = (meal = {}) => {
  const protein = asNumber(meal.protein ?? meal.macros?.p);
  if (!Number.isFinite(protein)) return 0;
  return round2(clamp01((protein - 15) / 35));
};

export const scoreGoalLowCarb = (meal = {}) => {
  const carbs = asNumber(meal.macros?.c);
  if (!Number.isFinite(carbs)) return 0;
  return round2(clamp01((60 - carbs) / 40));
};

export const scoreGoalTwoMeals = (meal = {}) => {
  const calories = asNumber(meal.cal);
  const protein = asNumber(meal.protein ?? meal.macros?.p);
  if (!Number.isFinite(calories) || !Number.isFinite(protein)) return 0;

  const calorieScore = clamp01((calories - 320) / 320);
  const proteinScore = clamp01((protein - 20) / 25);
  return round2(calorieScore * 0.55 + proteinScore * 0.45);
};

export const getGoalScores = (meal = {}) => ({
  high_protein: scoreGoalHighProtein(meal),
  low_carb: scoreGoalLowCarb(meal),
  two_meals: scoreGoalTwoMeals(meal)
});

export const deriveGoalFitTags = (meal = {}, minScore = 0.65) => {
  const scores = getGoalScores(meal);
  return GOAL_NAMES.filter((goalName) => Number(scores[goalName] || 0) >= minScore);
};

export const inferSourceType = (nutritionSource = '') => {
  const text = String(nutritionSource || '').toLowerCase();
  const hasIfct = text.includes('ifct');
  const hasUsda = text.includes('usda');
  const hasAssumption = text.includes('assumption');

  if (hasIfct && hasUsda) return 'composite_reference';
  if (hasIfct) return 'ifct_reference';
  if (hasUsda) return 'usda_reference';
  if (hasAssumption) return 'user_assumption';
  return 'unknown';
};

export const validateMacroCalorieConsistency = (meal = {}, options = {}) => {
  const calories = asNumber(meal.cal);
  const protein = asNumber(meal.macros?.p ?? meal.protein);
  const carbs = asNumber(meal.macros?.c);
  const fat = asNumber(meal.macros?.f);

  if (![calories, protein, carbs, fat].every(Number.isFinite)) {
    return {
      is_consistent: false,
      expected_kcal: null,
      delta_kcal: null,
      tolerance_kcal: null
    };
  }

  const expectedKcal = protein * 4 + carbs * 4 + fat * 9;
  const delta = Math.abs(calories - expectedKcal);
  const toleranceFloor = Number(options.toleranceFloor || 35);
  const toleranceRatio = Number(options.toleranceRatio || 0.2);
  const tolerance = Math.max(toleranceFloor, calories * toleranceRatio);

  return {
    is_consistent: delta <= tolerance,
    expected_kcal: round2(expectedKcal),
    delta_kcal: round2(delta),
    tolerance_kcal: round2(tolerance)
  };
};

export const getInvalidValueIssues = (meal = {}) => {
  const issues = [];
  const numberChecks = [
    { label: 'cal', value: meal.cal },
    { label: 'protein', value: meal.protein },
    { label: 'macros.p', value: meal.macros?.p },
    { label: 'macros.c', value: meal.macros?.c },
    { label: 'macros.f', value: meal.macros?.f }
  ];

  for (const check of numberChecks) {
    const n = asNumber(check.value);
    if (!Number.isFinite(n) || n < 0) {
      issues.push({
        code: 'invalid_value',
        field: check.label,
        message: `${check.label} must be a non-negative number`,
        severity: 'error'
      });
    }
  }

  return issues;
};

const getInvalidTagIssues = (tags = {}) => {
  const issues = [];
  const mealType = String(tags.meal_type || '');
  const proteinFamily = String(tags.protein_family || '');
  const carbLevel = String(tags.carb_level || '');
  const format = String(tags.format || '');
  const effort = String(tags.effort || '');

  if (!ALLOWED_MEAL_TYPE_TAGS.has(mealType)) {
    issues.push({ code: 'invalid_tag_value', field: 'tags.meal_type', message: 'Unsupported meal_type tag', severity: 'error' });
  }
  if (!ALLOWED_PROTEIN_FAMILIES.has(proteinFamily)) {
    issues.push({ code: 'invalid_tag_value', field: 'tags.protein_family', message: 'Unsupported protein_family tag', severity: 'error' });
  }
  if (!ALLOWED_CARB_LEVELS.has(carbLevel)) {
    issues.push({ code: 'invalid_tag_value', field: 'tags.carb_level', message: 'Unsupported carb_level tag', severity: 'error' });
  }
  if (!ALLOWED_FORMATS.has(format)) {
    issues.push({ code: 'invalid_tag_value', field: 'tags.format', message: 'Unsupported format tag', severity: 'error' });
  }
  if (!ALLOWED_EFFORT.has(effort)) {
    issues.push({ code: 'invalid_tag_value', field: 'tags.effort', message: 'Unsupported effort tag', severity: 'error' });
  }

  return issues;
};

const computeConfidenceScore = ({ sourceType, issueCount, hasAssumptions }) => {
  const baseBySource = {
    composite_reference: 0.88,
    ifct_reference: 0.8,
    usda_reference: 0.8,
    user_assumption: 0.58,
    unknown: 0.45
  };

  const base = Number(baseBySource[sourceType] ?? baseBySource.unknown);
  const issuePenalty = Number(issueCount || 0) * 0.08;
  const assumptionPenalty = hasAssumptions ? 0.05 : 0;
  return round2(clamp01(base - issuePenalty - assumptionPenalty));
};

export const buildMealDataMetadata = ({ meal = {}, mealType = '' } = {}) => {
  const existingTags = meal.tags && typeof meal.tags === 'object' ? meal.tags : {};
  const existingNutrition = meal.nutrition_metadata && typeof meal.nutrition_metadata === 'object' ? meal.nutrition_metadata : {};
  const scores = getGoalScores(meal);

  const tags = {
    meal_type: normalizeMealTypeTag(existingTags.meal_type || mealType),
    protein_family: existingTags.protein_family || meal.rule_metadata?.protein_family || inferProteinFamily(meal),
    carb_level: existingTags.carb_level || meal.rule_metadata?.carb_level || inferCarbLevel(meal),
    cuisine: String(existingTags.cuisine || meal.cuisine || 'global').toLowerCase(),
    format: existingTags.format || inferFormat(meal),
    effort: existingTags.effort || inferEffort(meal),
    goal_fit: Array.isArray(existingTags.goal_fit) ? existingTags.goal_fit.filter((goal) => GOAL_NAMES.includes(goal)) : deriveGoalFitTags(meal)
  };

  const macroCheck = validateMacroCalorieConsistency(meal);
  const issues = [
    ...getInvalidValueIssues(meal),
    ...getInvalidTagIssues(tags),
    ...(!macroCheck.is_consistent
      ? [
        {
          code: 'macro_calorie_mismatch',
          field: 'cal/macros',
          message: 'Calories deviate from macro-derived calories beyond tolerance',
          severity: 'warn'
        }
      ]
      : [])
  ];

  const sourceType = String(existingNutrition.source_type || inferSourceType(meal.nutrition_source));
  const sourceUrl = String(existingNutrition.source_url || meal.nutrition_source_url || '');
  const confidenceScore =
    typeof existingNutrition.confidence_score === 'number'
      ? round2(clamp01(existingNutrition.confidence_score))
      : computeConfidenceScore({
        sourceType,
        issueCount: issues.length,
        hasAssumptions: /assumption/i.test(String(meal.nutrition_source || ''))
      });
  const needsReview =
    typeof existingNutrition.needs_review === 'boolean'
      ? existingNutrition.needs_review
      : issues.some((issue) => issue.severity === 'error') || !macroCheck.is_consistent || confidenceScore < 0.6;

  return {
    tags,
    goal_scores: scores,
    nutrition_metadata: {
      source_type: sourceType,
      source_url: sourceUrl,
      confidence_score: confidenceScore,
      needs_review: Boolean(needsReview)
    },
    validation: {
      macro_calorie: macroCheck,
      issues
    }
  };
};

export const enrichMealForDataLayer = (meal = {}, mealType = '') => {
  const built = buildMealDataMetadata({ meal, mealType });
  const existingRule = meal.rule_metadata || {};

  return {
    ...meal,
    tags: built.tags,
    nutrition_metadata: built.nutrition_metadata,
    rule_metadata: {
      protein_family: existingRule.protein_family || built.tags.protein_family,
      meal_weight_class: existingRule.meal_weight_class || inferMealWeightClass(meal),
      carb_level: existingRule.carb_level || built.tags.carb_level
    }
  };
};

export const flattenMealDatabase = (mealDatabase = {}) => {
  const flat = [];

  for (const [mealType, meals] of Object.entries(mealDatabase || {})) {
    if (!Array.isArray(meals)) continue;
    for (const meal of meals) {
      const enriched = meal?.tags ? meal : enrichMealForDataLayer(meal, mealType);
      flat.push({
        ...enriched,
        meal_type: normalizeMealTypeTag(mealType)
      });
    }
  }

  return flat;
};

export const scoreMealMetadataSimilarity = (baseMeal = {}, candidateMeal = {}) => {
  const baseTags = baseMeal.tags || {};
  const candidateTags = candidateMeal.tags || {};
  const matchedFields = [];
  let score = 0;

  for (const field of METADATA_SIMILARITY_FIELDS) {
    const a = String(baseTags[field] || '').toLowerCase();
    const b = String(candidateTags[field] || '').toLowerCase();
    if (!a || !b) continue;
    if (a === b) {
      matchedFields.push(field);
      score += 1;
    }
  }

  return {
    score,
    matched_fields: matchedFields
  };
};
