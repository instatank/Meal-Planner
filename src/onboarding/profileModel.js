export const ONBOARDING_PROFILE_VERSION = 1;

export const ONBOARDING_ROLE_MODES = {
  OWNER: 'owner',
  VIEWER: 'viewer'
};

export const ONBOARDING_GOALS = {
  HIGH_PROTEIN: 'high-protein',
  LOW_CARB: 'low-carb',
  TWO_MEALS_DAY: '2-meals-day'
};

export const ONBOARDING_ROLE_OPTIONS = [
  {
    id: ONBOARDING_ROLE_MODES.OWNER,
    label: 'Owner',
    description: 'Full access to generate, edit, swap, and confirm meals.'
  },
  {
    id: ONBOARDING_ROLE_MODES.VIEWER,
    label: 'Viewer',
    description: 'Read-only access to review meal plans and progress.'
  }
];

export const ONBOARDING_GOAL_OPTIONS = [
  {
    id: ONBOARDING_GOALS.HIGH_PROTEIN,
    label: 'High-Protein',
    description: 'Prioritize protein-rich meals while keeping balance.'
  },
  {
    id: ONBOARDING_GOALS.LOW_CARB,
    label: 'Low-Carb',
    description: 'Deprioritize carb-heavy meals and prefer lower-carb choices.'
  },
  {
    id: ONBOARDING_GOALS.TWO_MEALS_DAY,
    label: '2 Meals/Day',
    description: 'Default to lunch and dinner planning.'
  }
];

export const DEFAULT_ONBOARDING_PROFILE = {
  version: ONBOARDING_PROFILE_VERSION,
  roleMode: ONBOARDING_ROLE_MODES.OWNER,
  primaryGoal: ONBOARDING_GOALS.HIGH_PROTEIN,
  completedAt: '',
  updatedAt: ''
};

const VALID_ROLE_MODES = new Set(Object.values(ONBOARDING_ROLE_MODES));
const VALID_GOALS = new Set(Object.values(ONBOARDING_GOALS));

export const normalizeOnboardingProfile = (value = {}) => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ONBOARDING_PROFILE };

  const roleMode = VALID_ROLE_MODES.has(value.roleMode) ? value.roleMode : DEFAULT_ONBOARDING_PROFILE.roleMode;
  const primaryGoal = VALID_GOALS.has(value.primaryGoal) ? value.primaryGoal : DEFAULT_ONBOARDING_PROFILE.primaryGoal;

  return {
    version: Number(value.version) || ONBOARDING_PROFILE_VERSION,
    roleMode,
    primaryGoal,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
  };
};

export const buildOnboardingProfile = ({ roleMode, primaryGoal } = {}) => {
  const now = new Date().toISOString();
  const normalized = normalizeOnboardingProfile({ roleMode, primaryGoal });
  return {
    ...normalized,
    version: ONBOARDING_PROFILE_VERSION,
    completedAt: normalized.completedAt || now,
    updatedAt: now
  };
};

export const hasCompletedOnboarding = (value) => {
  if (!value || typeof value !== 'object') return false;
  return VALID_ROLE_MODES.has(value.roleMode) && VALID_GOALS.has(value.primaryGoal);
};
