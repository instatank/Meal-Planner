import { GOAL, isDeclaredGoal, normalizeGoalId } from './rules.js';

export const ONBOARDING_PROFILE_VERSION = 1;

export const ONBOARDING_MODE = {
  OWNER: 'owner',
  VIEWER: 'viewer'
};

/**
 * The goals onboarding offers, taken from `rules.js` rather than declared a
 * second time here. This module used to carry its own enum whose `two_meals_day`
 * disagreed with the engine's `two_meals`, so a goal name only survived the trip
 * from the picker to the ruleset if someone remembered to add it to
 * `GOAL_ALIASES`.
 *
 * `TWO_MEALS_DAY` is retained as a key so existing callers keep resolving, but
 * it now holds the canonical id. Profiles persisted under the old spelling are
 * accepted and canonicalized on read below, so nobody gets re-onboarded.
 */
export const ONBOARDING_GOAL = Object.freeze({
  ...GOAL,
  TWO_MEALS_DAY: GOAL.TWO_MEALS
});

export const ONBOARDING_MODE_OPTIONS = [
  {
    value: ONBOARDING_MODE.OWNER,
    title: 'Owner',
    subtitle: 'Can plan, edit, confirm, swap, and regenerate meals.'
  },
  {
    value: ONBOARDING_MODE.VIEWER,
    title: 'Viewer',
    subtitle: 'Read-only access for checking plans and progress.'
  }
];

export const ONBOARDING_GOAL_OPTIONS = [
  {
    value: ONBOARDING_GOAL.HIGH_PROTEIN,
    title: 'High-Protein',
    subtitle: 'Prioritize meals with higher protein content.'
  },
  {
    value: ONBOARDING_GOAL.STANDARD,
    title: 'Standard / Balanced',
    subtitle: 'A well-rounded, balanced macro setup.'
  },
  {
    value: ONBOARDING_GOAL.LOW_CARB,
    title: 'Low-Carb (Coming Soon)',
    subtitle: 'Deprioritize carb-heavy meals.',
    disabled: true
  },
  {
    value: ONBOARDING_GOAL.TWO_MEALS_DAY,
    title: '2 Meals/Day (Coming Soon)',
    subtitle: 'Lunch + dinner focused planning by default.',
    disabled: true
  },
  {
    value: ONBOARDING_GOAL.VEGETARIAN,
    title: 'Vegetarian (Coming Soon)',
    subtitle: 'Plant-based meal planning.',
    disabled: true
  }
];

const MODE_LABELS = {
  [ONBOARDING_MODE.OWNER]: 'Owner',
  [ONBOARDING_MODE.VIEWER]: 'Viewer'
};

const GOAL_LABELS = {
  [ONBOARDING_GOAL.HIGH_PROTEIN]: 'High-Protein',
  [ONBOARDING_GOAL.STANDARD]: 'Standard / Balanced',
  [ONBOARDING_GOAL.LOW_CARB]: 'Low-Carb',
  [ONBOARDING_GOAL.TWO_MEALS_DAY]: '2 Meals/Day',
  [ONBOARDING_GOAL.VEGETARIAN]: 'Vegetarian'
};

const asIsoString = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const isValidOnboardingMode = (mode) => Object.values(ONBOARDING_MODE).includes(mode);

/** Accepts either spelling — `rules.js` owns the reconciliation. */
export const isValidOnboardingGoal = (goal) => isDeclaredGoal(goal);

export const getOnboardingModeLabel = (mode) => MODE_LABELS[mode] || 'Unknown';

export const getOnboardingGoalLabel = (goal) => GOAL_LABELS[normalizeGoalId(goal)] || 'Unknown';

export const getDefaultOnboardingDraft = () => ({
  mode: ONBOARDING_MODE.OWNER,
  goal: ONBOARDING_GOAL.HIGH_PROTEIN
});

export const normalizeOnboardingProfile = (value) => {
  if (!value || typeof value !== 'object') return null;

  const version = Number(value.version);
  if (version !== ONBOARDING_PROFILE_VERSION) return null;
  if (!isValidOnboardingMode(value.mode) || !isValidOnboardingGoal(value.goal)) return null;

  const completedAt = asIsoString(value.completedAt);
  const updatedAt = asIsoString(value.updatedAt || value.completedAt);
  if (!completedAt || !updatedAt) return null;

  return {
    version: ONBOARDING_PROFILE_VERSION,
    mode: value.mode,
    // Canonicalized on read, so a profile persisted under the legacy
    // `two_meals_day` spelling reaches `getRules` as `two_meals`.
    goal: normalizeGoalId(value.goal),
    completedAt,
    updatedAt
  };
};

export const buildOnboardingProfile = ({ mode, goal, previousProfile = null, now = new Date() }) => {
  if (!isValidOnboardingMode(mode) || !isValidOnboardingGoal(goal)) return null;

  const nowIso = asIsoString(now) || new Date().toISOString();
  const normalizedPrevious = normalizeOnboardingProfile(previousProfile);

  return {
    version: ONBOARDING_PROFILE_VERSION,
    mode,
    goal: normalizeGoalId(goal),
    completedAt: normalizedPrevious?.completedAt || nowIso,
    updatedAt: nowIso
  };
};

