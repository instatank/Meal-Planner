const ROLE_CONFIG = {
  owner: {
    id: 'owner',
    label: 'Owner',
    description: 'Can update plans, confirm meals, and manage weekly changes.',
    readOnly: false
  },
  viewer: {
    id: 'viewer',
    label: 'Viewer',
    description: 'Read-only access for reviewing plans and progress.',
    readOnly: true
  }
};

const GOAL_CONFIG = {
  high_protein: {
    id: 'high_protein',
    label: 'High-Protein',
    description: 'Bias toward protein-forward meal choices.',
    adapterKey: 'goal_high_protein'
  },
  low_carb: {
    id: 'low_carb',
    label: 'Low-Carb',
    description: 'Bias toward lighter carb allocations.',
    adapterKey: 'goal_low_carb'
  },
  two_meals_day: {
    id: 'two_meals_day',
    label: '2 Meals/Day',
    description: 'Optimize around two primary meals per day.',
    adapterKey: 'goal_two_meals_day'
  }
};

const DEFAULT_ROLE = 'owner';
const DEFAULT_GOAL = 'high_protein';

const normalizeRole = (value) => (ROLE_CONFIG[value] ? value : DEFAULT_ROLE);
const normalizeGoal = (value) => (GOAL_CONFIG[value] ? value : DEFAULT_GOAL);

export const ROLE_OPTIONS = Object.values(ROLE_CONFIG);
export const GOAL_OPTIONS = Object.values(GOAL_CONFIG);

export const getDefaultProfileDraft = () => ({
  role: DEFAULT_ROLE,
  goal: DEFAULT_GOAL
});

export const createOnboardingProfile = (draft = {}, nowIso = new Date().toISOString()) => ({
  version: 1,
  isComplete: true,
  role: normalizeRole(draft.role),
  goal: normalizeGoal(draft.goal),
  completedAt: nowIso,
  updatedAt: nowIso
});

export const normalizeStoredOnboardingProfile = (value) => {
  if (!value || typeof value !== 'object') return null;

  const role = normalizeRole(value.role);
  const goal = normalizeGoal(value.goal);
  const completedAt = typeof value.completedAt === 'string' && value.completedAt ? value.completedAt : null;
  const isComplete = value.isComplete === true || Boolean(completedAt);

  if (!isComplete) return null;

  return {
    version: Number(value.version) || 1,
    isComplete: true,
    role,
    goal,
    completedAt: completedAt || new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : completedAt || new Date(0).toISOString()
  };
};

export const getRoleUiConfig = (role) => ROLE_CONFIG[normalizeRole(role)];
export const getGoalUiConfig = (goal) => GOAL_CONFIG[normalizeGoal(goal)];

export const mapProfileToRulesAdapter = (profile) => {
  const role = normalizeRole(profile?.role);
  const goal = normalizeGoal(profile?.goal);

  return {
    roleKey: role,
    goalKey: GOAL_CONFIG[goal].adapterKey,
    // This adapter is the only place that should know contract key mapping details.
    contractPayload: {
      role,
      goal
    }
  };
};
