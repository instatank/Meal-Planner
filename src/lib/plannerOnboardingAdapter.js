import { ONBOARDING_GOALS, ONBOARDING_ROLE_MODES, normalizeOnboardingProfile } from '../onboarding/profileModel.js';

export const DEFAULT_PLANNER_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

const GOAL_MEAL_TYPES = {
  [ONBOARDING_GOALS.HIGH_PROTEIN]: ['breakfast', 'lunch', 'dinner'],
  [ONBOARDING_GOALS.LOW_CARB]: ['breakfast', 'lunch', 'dinner'],
  [ONBOARDING_GOALS.TWO_MEALS_DAY]: ['lunch', 'dinner']
};

const GOAL_DAILY_PROTEIN_TARGET = {
  [ONBOARDING_GOALS.HIGH_PROTEIN]: 130,
  [ONBOARDING_GOALS.LOW_CARB]: 118,
  [ONBOARDING_GOALS.TWO_MEALS_DAY]: 105
};

export const createPlannerAccessContext = (profileInput) => {
  const profile = normalizeOnboardingProfile(profileInput || {});
  const mealTypes = GOAL_MEAL_TYPES[profile.primaryGoal] || DEFAULT_PLANNER_MEAL_TYPES;
  const roleMode = profile.roleMode || ONBOARDING_ROLE_MODES.OWNER;
  const readOnly = roleMode === ONBOARDING_ROLE_MODES.VIEWER;

  return {
    roleMode,
    goal: profile.primaryGoal,
    mealTypes,
    dailyProteinTarget: GOAL_DAILY_PROTEIN_TARGET[profile.primaryGoal] || GOAL_DAILY_PROTEIN_TARGET[ONBOARDING_GOALS.HIGH_PROTEIN],
    readOnly,
    canMutate: !readOnly
  };
};

export const getRoleLabel = (roleMode) => (roleMode === ONBOARDING_ROLE_MODES.VIEWER ? 'Viewer' : 'Owner');

export const getGoalLabel = (goal) => {
  if (goal === ONBOARDING_GOALS.LOW_CARB) return 'Low-Carb';
  if (goal === ONBOARDING_GOALS.TWO_MEALS_DAY) return '2 Meals/Day';
  return 'High-Protein';
};

export const getPlannerMealTypeOrder = ({ accessContext, plan = {}, history = {} }) => {
  const baseMealTypes = Array.isArray(accessContext?.mealTypes) && accessContext.mealTypes.length > 0
    ? accessContext.mealTypes
    : DEFAULT_PLANNER_MEAL_TYPES;

  const hasSnack = Boolean(plan?.snack || history?.snack);
  if (!hasSnack) return baseMealTypes;

  const result = [];
  let insertedSnack = false;

  for (const mealType of baseMealTypes) {
    if (mealType === 'dinner' && !insertedSnack) {
      result.push('snack');
      insertedSnack = true;
    }
    result.push(mealType);
  }

  if (!insertedSnack) result.push('snack');
  return result;
};
