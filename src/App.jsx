import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Check, TrendingUp, X, Edit3 } from 'lucide-react';
import { mealDatabase } from './data/mealDatabase';
import {
  CORE_MEAL_TYPES,
  getMealsForType as plannerGetMealsForType,
  createDefaultPlan as plannerCreateDefaultPlan,
  generatePlanForDate as plannerGeneratePlanForDate,
  normalizePreferences as plannerNormalizePreferences
} from './lib/plannerGenerator';
import {
  createMealEvent,
  normalizeMealEvents,
  derivePreferencesFromEvents,
  getUndoTargetsForSlots,
  hasPreferenceSignals,
  getCustomMealOccurrenceCount,
  getCustomMealCandidates
} from './lib/mealEvents';
import {
  ROLE_OPTIONS,
  GOAL_OPTIONS,
  getDefaultProfileDraft,
  createOnboardingProfile,
  normalizeStoredOnboardingProfile,
  getRoleUiConfig,
  getGoalUiConfig,
  mapProfileToRulesAdapter
} from './lib/profileAdapter';

const MealPlannerApp = () => {
  const IST_TIME_ZONE = 'Asia/Kolkata';
  const STORAGE_API_BASE = '/api/storage';
  const DEFAULT_USER_CATALOG = { breakfast: [], lunchDinner: [], snack: [] };
  const ONBOARDING_PROFILE_STORAGE_KEY = 'meal-onboarding-profile';

  const [expandedMeals, setExpandedMeals] = useState({});
  const [showWeekly, setShowWeekly] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showOrderOutModal, setShowOrderOutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customMealText, setCustomMealText] = useState('');
  const [currentModalMealType, setCurrentModalMealType] = useState('');
  const [editedComponents, setEditedComponents] = useState({});
  const [manualEditText, setManualEditText] = useState('');
  const [notification, setNotification] = useState('');
  const [loading, setLoading] = useState(true);
  const [userMealCatalog, setUserMealCatalog] = useState(DEFAULT_USER_CATALOG);
  const [onboardingProfile, setOnboardingProfile] = useState(null);
  const [onboardingDraft, setOnboardingDraft] = useState(() => getDefaultProfileDraft());
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const todayDate = new Date().toLocaleDateString('en-IN', { 
    timeZone: IST_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const getTodayDayName = () => {
    return new Date().toLocaleDateString('en-IN', { 
      timeZone: IST_TIME_ZONE,
      weekday: 'short'
    });
  };

  // Component options for swapping
  const componentOptions = {
    protein: [
      { name: "Chicken breast", cal: 165, p: 31, c: 0, f: 3.6, per100g: true },
      { name: "Fish fillet", cal: 110, p: 23, c: 0, f: 2, per100g: true },
      { name: "Grilled salmon", cal: 206, p: 22, c: 0, f: 13, per100g: true },
      { name: "Smoked salmon", cal: 117, p: 18, c: 0, f: 4.3, per100g: true },
      { name: "Eggs (whole)", cal: 155, p: 13, c: 1, f: 11, per100g: true },
      { name: "Paneer", cal: 265, p: 18, c: 3, f: 20, per100g: true },
      { name: "Beef steak", cal: 250, p: 26, c: 0, f: 16, per100g: true },
      { name: "Pork chop", cal: 233, p: 23, c: 0, f: 15, per100g: true },
      { name: "Lamb (seekh kabab)", cal: 280, p: 17, c: 2, f: 22, per100g: true },
      { name: "Mutton keema", cal: 230, p: 19, c: 0, f: 17, per100g: true }
    ],
    carb: [
      { name: "Cooked rice", cal: 130, p: 2.4, c: 28, f: 0.3, per100g: true },
      { name: "Quinoa", cal: 120, p: 4.4, c: 21, f: 1.9, per100g: true },
      { name: "Jowar roti (millet)", cal: 125, p: 2.7, c: 24, f: 1.3, perUnit: true },
      { name: "Rice noodles", cal: 110, p: 2, c: 25, f: 0.2, per100g: true },
      { name: "Pasta", cal: 131, p: 5, c: 25, f: 1.1, per100g: true },
      { name: "Spaghetti aglio e olio (small portion)", cal: 185, p: 4.5, c: 29, f: 6.2, per100g: true },
      { name: "Garlic rice (small portion)", cal: 150, p: 3, c: 28, f: 3, per100g: true },
      { name: "Whole wheat toast", cal: 80, p: 4, c: 15, f: 1, perUnit: true },
      { name: "Poha", cal: 180, p: 6, c: 38, f: 1, per100g: true },
      { name: "No carb", cal: 0, p: 0, c: 0, f: 0, per100g: true }
    ],
    vegetable: [
      { name: "Mixed salad", cal: 20, p: 1.3, c: 3.3, f: 0, per100g: true },
      { name: "Mixed greens salad", cal: 18, p: 1.5, c: 3.2, f: 0.2, per100g: true },
      { name: "Pumpkin salad", cal: 95, p: 2.2, c: 12, f: 4, per100g: true },
      { name: "Smoked chicken + avocado salad", cal: 165, p: 12, c: 6, f: 10, per100g: true },
      { name: "Smoked salmon salad", cal: 145, p: 10, c: 5, f: 8, per100g: true },
      { name: "Sautéed spinach", cal: 35, p: 3, c: 4, f: 1, per100g: true },
      { name: "Sautéed broccoli", cal: 55, p: 4, c: 7, f: 2, per100g: true },
      { name: "Cauliflower", cal: 25, p: 2, c: 5, f: 0.3, per100g: true },
      { name: "Sautéed peppers", cal: 40, p: 1, c: 6, f: 1.5, per100g: true },
      { name: "Asparagus", cal: 27, p: 3, c: 3, f: 0.5, per100g: true },
      { name: "Zucchini", cal: 21, p: 1.5, c: 3.1, f: 0.4, per100g: true },
      { name: "Mixed veg sabzi", cal: 80, p: 3, c: 12, f: 2, per100g: true }
    ],
    style: [
      { name: "Grilled", modifier: 1.0 },
      { name: "Curry style", modifier: 1.15, addCal: 80 },
      { name: "Tandoori", modifier: 1.05 },
      { name: "Pan-fried", modifier: 1.1, addCal: 40 },
      { name: "Soup style", modifier: 0.9, addCal: 60 }
    ]
  };


  const orderOutOptions = {
    breakfast: [
      { name: "Protein smoothie bowl", protein: 28, cal: 320, note: "High-protein, low-carb" },
      { name: "Eggs royale (salmon + poached eggs)", protein: 34, cal: 420, note: "Gourmet breakfast" }
    ],
    lunch: [
      { name: "Grilled chicken tikka (6 pcs)", protein: 48, cal: 420, note: "High-protein, low-carb" },
      { name: "Mutton kathi roll", protein: 28, cal: 450, note: "Moderate carbs" },
      { name: "Seekh kabab platter", protein: 35, cal: 480, note: "Lamb kababs" },
      { name: "Thai tom yum soup", protein: 30, cal: 320, note: "Light & spicy" },
      { name: "Vietnamese bun cha", protein: 38, cal: 480, note: "Grilled pork" },
      { name: "Ramen bowl", protein: 32, cal: 520, note: "Hearty noodle soup" }
    ],
    dinner: [
      { name: "Tandoori fish + salad", protein: 38, cal: 340, note: "Low-carb, high-protein" },
      { name: "Chicken kebab platter", protein: 45, cal: 450, note: "Mixed kebabs" },
      { name: "Grilled steak + vegetables", protein: 52, cal: 600, note: "Premium protein" },
      { name: "Shammi kabab (lamb)", protein: 30, cal: 420, note: "Rich & flavorful" },
      { name: "Barra kabab platter", protein: 40, cal: 520, note: "Lamb chops" }
    ]
  };

  const slugifyMealId = (text = '') =>
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  const normalizeUserMealCatalog = (value = {}) => ({
    breakfast: Array.isArray(value.breakfast) ? value.breakfast : [],
    lunchDinner: Array.isArray(value.lunchDinner) ? value.lunchDinner : [],
    snack: Array.isArray(value.snack) ? value.snack : []
  });

  const mergeMealsUniqueByCanonicalName = (baseMeals = [], extraMeals = []) => {
    const seen = new Set();
    const merged = [];

    for (const meal of [...baseMeals, ...extraMeals]) {
      const key = String(meal?.canonical_name || meal?.name || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(meal);
    }

    return merged;
  };

  const normalizeCandidateKey = (value = '') =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s+]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const getCandidateTargetLabel = (targetMealType) => {
    if (targetMealType === 'breakfast') return 'Breakfast';
    if (targetMealType === 'snack') return 'Snack';
    return 'Lunch/Dinner';
  };

  const mergedMealDatabase = useMemo(
    () => ({
      breakfast: mergeMealsUniqueByCanonicalName(mealDatabase.breakfast || [], userMealCatalog.breakfast || []),
      lunchDinner: mergeMealsUniqueByCanonicalName(mealDatabase.lunchDinner || [], userMealCatalog.lunchDinner || []),
      snack: mergeMealsUniqueByCanonicalName(mealDatabase.snack || [], userMealCatalog.snack || [])
    }),
    [userMealCatalog]
  );

  const allExistingMealNames = useMemo(
    () =>
      Object.values(mergedMealDatabase)
        .flat()
        .map((meal) => meal?.canonical_name || meal?.name || '')
        .filter(Boolean),
    [mergedMealDatabase]
  );

  const getMealsForType = (mealType) => plannerGetMealsForType(mergedMealDatabase, mealType);

  const createDefaultPlan = () => plannerCreateDefaultPlan(mergedMealDatabase);

  const formatDateKeyFromUtcDate = (date) => {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDateKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: IST_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (year && month && day) return `${year}-${month}-${day}`;
    return formatDateKeyFromUtcDate(date);
  };

  const parseDateKey = (dateKey) => {
    const matches = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
    if (!matches) {
      const parsed = new Date(dateKey);
      if (!Number.isNaN(parsed.getTime())) return parsed;
      return new Date(Number.NaN);
    }

    const [, year, month, day] = matches;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  };

  const shiftDateKey = (dateKey, offsetDays) => {
    const date = parseDateKey(dateKey);
    if (Number.isNaN(date.getTime())) return getDateKey();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return formatDateKeyFromUtcDate(date);
  };

  const formatDateLabel = (dateKey) => {
    const date = parseDateKey(dateKey);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-IN', {
      timeZone: IST_TIME_ZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getDayOrdinal = (day) => {
    if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
    if (day % 10 === 1) return `${day}st`;
    if (day % 10 === 2) return `${day}nd`;
    if (day % 10 === 3) return `${day}rd`;
    return `${day}th`;
  };

  const formatWeekSnapshotDateLabel = (dateKey) => {
    const date = parseDateKey(dateKey);
    if (Number.isNaN(date.getTime())) return dateKey;
    const weekday = date.toLocaleDateString('en-US', {
      timeZone: IST_TIME_ZONE,
      weekday: 'short'
    });
    const day = date.getUTCDate();
    return `${weekday}, ${getDayOrdinal(day)}`;
  };

  const getWeekDateKeys = (centerKey) => {
    const center = parseDateKey(centerKey);
    if (Number.isNaN(center.getTime())) {
      return Array.from({ length: 7 }, (_, idx) => shiftDateKey(getDateKey(), idx));
    }
    const dayIndex = center.getUTCDay();
    const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
    return Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(center);
      d.setUTCDate(center.getUTCDate() + mondayOffset + idx);
      return formatDateKeyFromUtcDate(d);
    });
  };
  

  const getMealTypeOrder = (plan = {}, history = {}) =>
    plan?.snack || history?.snack ? ['breakfast', 'lunch', 'snack', 'dinner'] : CORE_MEAL_TYPES;


  const hasLockedHistoryForDate = (dateKey, historyState) => {
    const day = historyState?.[dateKey] || {};
    return CORE_MEAL_TYPES.some((mealType) => day[mealType]?.confirmed || day[mealType]?.skipped);
  };

  const isSamePlanByName = (a, b) => {
    if (!a || !b) return false;
    return CORE_MEAL_TYPES.every((mealType) => a[mealType]?.name && b[mealType]?.name && a[mealType].name === b[mealType].name);
  };

  const generatePlanForDate = (dateKey, plans, preferences) =>
    plannerGeneratePlanForDate({
      dateKey,
      plans,
      preferences,
      mealDatabase: mergedMealDatabase
    });

  const normalizePreferences = (prefs = {}) => plannerNormalizePreferences(prefs);

  const [selectedDateKey, setSelectedDateKey] = useState(getDateKey());
  const [mealPlans, setMealPlans] = useState({});
  const [mealHistory, setMealHistory] = useState({});
  const [preferences, setPreferences] = useState(() => normalizePreferences({}));
  const [mealEvents, setMealEvents] = useState([]);
  const hasCompletedOnboarding = Boolean(onboardingProfile?.isComplete);
  const roleConfig = getRoleUiConfig(onboardingProfile?.role);
  const goalConfig = getGoalUiConfig(onboardingProfile?.goal);
  const isViewerMode = Boolean(roleConfig?.readOnly);
  const rulesProfileAdapter = useMemo(() => mapProfileToRulesAdapter(onboardingProfile), [onboardingProfile]);

  const safeParseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const normalizeDateMap = (value = {}) => {
    if (!value || typeof value !== 'object') return {};
    const normalized = {};

    for (const [key, data] of Object.entries(value)) {
      const parsed = parseDateKey(key);
      const normalizedKey = Number.isNaN(parsed.getTime()) ? key : getDateKey(parsed);
      normalized[normalizedKey] = data;
    }

    return normalized;
  };

  const putToApiStorage = async (key, value) => {
    try {
      const response = await fetch(`${STORAGE_API_BASE}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const storageGet = async (key) => {
    if (typeof window === 'undefined') return null;

    const localValue = safeParseJson(window.localStorage.getItem(key), null);

    try {
      const response = await fetch(`${STORAGE_API_BASE}/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload?.value != null) {
          window.localStorage.setItem(key, JSON.stringify(payload.value));
          return payload.value;
        }

        if (localValue != null) {
          void putToApiStorage(key, localValue);
        }
      }
    } catch (error) {
      console.warn('API storage read failed; using local fallback for', key, error);
    }

    if (window.storage?.get) {
      try {
        const result = await window.storage.get(key);
        const fallbackValue = safeParseJson(result?.value, null);
        if (fallbackValue != null) {
          window.localStorage.setItem(key, JSON.stringify(fallbackValue));
          return fallbackValue;
        }
      } catch (error) {
        console.warn('window.storage read failed; using local fallback for', key, error);
      }
    }

    return localValue;
  };

  const saveToStorage = async (key, data) => {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(key, JSON.stringify(data));

    const apiSaved = await putToApiStorage(key, data);
    if (apiSaved) return;

    if (window.storage?.set) {
      try {
        await window.storage.set(key, JSON.stringify(data));
      } catch (error) {
        console.error('Storage error (window.storage):', error);
      }
    }
  };

  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const historyResult = await storageGet('meal-history');
        const prefsResult = await storageGet('meal-preferences');
        const plansResult = await storageGet('meal-plans');
        const eventsResult = await storageGet('meal-events');
        const userCatalogResult = await storageGet('meal-user-catalog');
        const onboardingProfileResult = await storageGet(ONBOARDING_PROFILE_STORAGE_KEY);

        const parsedHistory = normalizeDateMap(safeParseJson(historyResult, historyResult) || {});
        const parsedPrefs = normalizePreferences(safeParseJson(prefsResult, prefsResult) || {});
        const parsedPlans = normalizeDateMap(safeParseJson(plansResult, plansResult) || {});
        const parsedEventsRaw = safeParseJson(eventsResult, eventsResult);
        const parsedUserCatalog = normalizeUserMealCatalog(safeParseJson(userCatalogResult, userCatalogResult) || {});
        const parsedOnboardingProfile = normalizeStoredOnboardingProfile(
          safeParseJson(onboardingProfileResult, onboardingProfileResult)
        );
        let parsedEvents = normalizeMealEvents(parsedEventsRaw || []);

        if (!parsedEvents.length && hasPreferenceSignals(parsedPrefs)) {
          parsedEvents = [
            createMealEvent({
              type: 'legacy_import',
              dateKey: getDateKey(),
              mealType: 'system',
              importedPreferences: parsedPrefs,
              note: 'Auto-migrated from legacy meal-preferences'
            })
          ];
        }

        const derivedPreferences = derivePreferencesFromEvents(parsedEvents);

        setMealHistory(parsedHistory);
        setPreferences(derivedPreferences);
        setMealPlans(parsedPlans);
        setMealEvents(parsedEvents);
        setUserMealCatalog(parsedUserCatalog);
        setOnboardingProfile(parsedOnboardingProfile);
        setOnboardingDraft(parsedOnboardingProfile ? { role: parsedOnboardingProfile.role, goal: parsedOnboardingProfile.goal } : getDefaultProfileDraft());
        setOnboardingStep(1);

        void saveToStorage('meal-history', parsedHistory);
        void saveToStorage('meal-preferences', derivedPreferences);
        void saveToStorage('meal-plans', parsedPlans);
        void saveToStorage('meal-events', parsedEvents);
        void saveToStorage('meal-user-catalog', parsedUserCatalog);
        if (parsedOnboardingProfile) {
          void saveToStorage(ONBOARDING_PROFILE_STORAGE_KEY, parsedOnboardingProfile);
        }
      } catch (error) {
        console.log('No stored data', error);
      }
      setLoading(false);
    };

    loadStoredData();
  }, []);

  useEffect(() => {
    if (loading) return;

    const keysToEnsure = Array.from(new Set([selectedDateKey, ...getWeekDateKeys(selectedDateKey)])).sort();
    const nextPlans = { ...mealPlans };
    let changed = false;

    for (const key of keysToEnsure) {
      const existing = nextPlans[key];
      if (!existing) {
        nextPlans[key] = generatePlanForDate(key, nextPlans, preferences);
        changed = true;
        continue;
      }

      const previousKey = shiftDateKey(key, -1);
      const previousPlan = nextPlans[previousKey];
      const isLegacyClone = isSamePlanByName(existing, previousPlan);
      const isLocked = hasLockedHistoryForDate(key, mealHistory);

      if (isLegacyClone && !isLocked) {
        nextPlans[key] = generatePlanForDate(key, nextPlans, preferences);
        changed = true;
      }
    }

    if (changed) {
      setMealPlans(nextPlans);
      saveToStorage('meal-plans', nextPlans);
    }
  }, [selectedDateKey, mealPlans, loading, preferences, mealHistory, mergedMealDatabase]);

  useEffect(() => {
    if (loading) return;
    const nextPreferences = derivePreferencesFromEvents(mealEvents);
    setPreferences(nextPreferences);
    void saveToStorage('meal-events', mealEvents);
    void saveToStorage('meal-preferences', nextPreferences);
  }, [mealEvents, loading]);

  const selectedDayPlan = mealPlans[selectedDateKey] || createDefaultPlan();
  const selectedDayHistory = mealHistory[selectedDateKey] || {};
  const customCandidates = useMemo(
    () => getCustomMealCandidates(mealEvents, allExistingMealNames, { lookbackDays: 45, minCount: 3 }),
    [mealEvents, allExistingMealNames]
  );

  const updateSelectedPlan = (updater) => {
    setMealPlans((prev) => {
      const currentPlan = prev[selectedDateKey] || createDefaultPlan();
      const nextPlan = typeof updater === 'function' ? updater(currentPlan) : updater;
      const nextState = { ...prev, [selectedDateKey]: nextPlan };
      saveToStorage('meal-plans', nextState);
      return nextState;
    });
  };

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const persistOnboardingProfile = async (draft, options = {}) => {
    const { silent = false } = options;
    const nextProfile = createOnboardingProfile(draft);
    setOnboardingProfile(nextProfile);
    setOnboardingDraft({ role: nextProfile.role, goal: nextProfile.goal });
    setOnboardingStep(1);
    await saveToStorage(ONBOARDING_PROFILE_STORAGE_KEY, nextProfile);
    if (!silent) {
      showNotification('✓ Preferences saved');
    }
    return nextProfile;
  };

  const openPreferencesEditor = () => {
    const fallbackDraft = getDefaultProfileDraft();
    setOnboardingDraft({
      role: onboardingProfile?.role || fallbackDraft.role,
      goal: onboardingProfile?.goal || fallbackDraft.goal
    });
    setShowPreferencesModal(true);
  };

  const blockViewerAction = () => {
    if (!isViewerMode) return false;
    showNotification('👁️ Viewer mode is read-only');
    return true;
  };

  const toggleExpand = (meal) => {
    setExpandedMeals((prev) => ({ ...prev, [meal]: !prev[meal] }));
  };

  const appendMealEvent = (payload) => {
    const event = createMealEvent(payload);
    setMealEvents((prev) => [...prev, event]);
    return event;
  };

  const buildPromotedCustomMeal = (candidateName, targetMealType) => {
    const canonicalName = String(candidateName || '').trim();
    const label = canonicalName.length > 44 ? `${canonicalName.slice(0, 43)}…` : canonicalName;
    const idSuffix = slugifyMealId(canonicalName);
    const profileByType = {
      breakfast: { p: 20, c: 30, f: 10, cal: 310 },
      lunchDinner: { p: 24, c: 42, f: 14, cal: 450 },
      snack: { p: 12, c: 20, f: 8, cal: 220 }
    };
    const profile = profileByType[targetMealType] || profileByType.lunchDinner;

    return {
      meal_id: `user_${targetMealType}_${idSuffix}`,
      canonical_name: canonicalName,
      display_name: label,
      nutrition_source: 'User-promoted custom meal',
      assumption_version: 'user_promoted_v1',
      name: canonicalName,
      protein: profile.p,
      cal: profile.cal,
      macros: { p: profile.p, c: profile.c, f: profile.f },
      cuisine: 'custom',
      isUserAdded: true
    };
  };

  const approveCustomCandidate = async (candidate) => {
    if (blockViewerAction()) return;
    if (!candidate?.displayName) return;
    const normalizedKey = candidate.normalizedKey || normalizeCandidateKey(candidate.displayName);
    const targetMealType = candidate.suggestedMealType || 'lunchDinner';

    const alreadyExists = allExistingMealNames.some((mealName) => normalizeCandidateKey(mealName) === normalizedKey);
    if (alreadyExists) {
      showNotification('⚠️ This meal is already in your database');
      return;
    }

    const promotedMeal = buildPromotedCustomMeal(candidate.displayName, targetMealType);
    const nextCatalog = normalizeUserMealCatalog({
      ...userMealCatalog,
      [targetMealType]: [...(userMealCatalog[targetMealType] || []), promotedMeal]
    });

    setUserMealCatalog(nextCatalog);
    await saveToStorage('meal-user-catalog', nextCatalog);

    appendMealEvent({
      type: 'custom_promoted',
      dateKey: selectedDateKey,
      mealType: targetMealType,
      customMealText: candidate.displayName,
      promotedMealName: promotedMeal.name
    });

    showNotification(`✓ Added to meals: ${promotedMeal.display_name}`);
  };

  const handleSwap = (mealType) => {
    if (blockViewerAction()) return;
    const currentMeal = selectedDayPlan[mealType];
    const availableMeals = getMealsForType(mealType);
    if (!availableMeals.length) {
      showNotification('⚠️ No alternatives available');
      return;
    }
    const currentIndex = availableMeals.findIndex((m) => m.name === currentMeal.name);
    const nextIndex = (currentIndex + 1) % availableMeals.length;
    const nextMeal = availableMeals[nextIndex];

    updateSelectedPlan((prev) => ({ ...prev, [mealType]: nextMeal }));
    appendMealEvent({
      type: 'swap',
      dateKey: selectedDateKey,
      mealType,
      fromMealName: currentMeal?.name || '',
      toMealName: nextMeal?.name || ''
    });
    showNotification(`✓ Swapped to: ${nextMeal.name}`);
  };

  const handleEdit = (mealType) => {
    if (blockViewerAction()) return;
    const meal = selectedDayPlan[mealType];
    setEditedComponents({
      protein: meal.components?.protein || componentOptions.protein[0].name,
      carb: meal.components?.carb || componentOptions.carb[0].name,
      veg: meal.components?.veg || 'None',
      style: meal.components?.style || componentOptions.style[0].name
    });
    setManualEditText(meal.name || '');
    setCurrentModalMealType(mealType);
    setShowEditModal(true);
  };

  const getNearestMealProfile = (manualText, mealType) => {
    const q = manualText.toLowerCase().replace(/[^a-z0-9\s+]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) return null;

    const tokens = q.split(' ').filter((t) => t.length > 1);
    const candidates = getMealsForType(mealType);

    let best = null;
    let bestScore = 0;

    for (const meal of candidates) {
      const hay = [
        meal.name,
        meal.cuisine,
        meal.components?.protein,
        meal.components?.carb,
        meal.components?.veg,
        meal.components?.style
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      let score = 0;
      if (hay.includes(q)) score += 8;
      for (const token of tokens) {
        if (hay.includes(token)) score += 2;
      }

      if (score > bestScore) {
        best = meal;
        bestScore = score;
      }
    }

    if (!best || bestScore <= 0) return null;
    return { meal: best, score: bestScore };
  };

  const applyComponentEdit = () => {
    if (blockViewerAction()) return;
    const manualText = manualEditText.trim();
    const originalMealName = (selectedDayPlan[currentModalMealType]?.name || '').trim();
    const isManualOverride = manualText.length > 0 && manualText.toLowerCase() !== originalMealName.toLowerCase();

    if (isManualOverride) {
      const inferred = getNearestMealProfile(manualText, currentModalMealType);
      const inferredMeal = inferred?.meal;
      const currentMeal = selectedDayPlan[currentModalMealType] || {};
      const fallbackProtein = currentMeal.protein || 0;
      const fallbackCal = currentMeal.cal || 0;
      const fallbackMacros = currentMeal.macros || { p: fallbackProtein, c: 0, f: 0 };

      const inferredProtein = inferredMeal?.protein ?? fallbackProtein;
      const inferredCal = inferredMeal?.cal ?? fallbackCal;
      const inferredMacros = inferredMeal?.macros || fallbackMacros;

      const manualMeal = {
        name: manualText,
        protein: inferredProtein,
        cal: inferredCal,
        macros: {
          p: inferredMacros.p ?? inferredProtein,
          c: inferredMacros.c ?? fallbackMacros.c ?? 0,
          f: inferredMacros.f ?? fallbackMacros.f ?? 0
        },
        isManualEntry: true,
        inferredFrom: inferredMeal?.name || null
      };

      appendMealEvent({
        type: 'edit',
        dateKey: selectedDateKey,
        mealType: currentModalMealType,
        originalMealName: originalMealName || currentMeal?.name || '',
        updatedMealName: inferredMeal?.name || null,
        editedToMealName: manualText,
        isManualEntry: true
      });

      updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: manualMeal }));
      setShowEditModal(false);

      if (inferredMeal) {
        showNotification('✓ Saved manual meal. Profile matched to: ' + inferredMeal.name);
      } else {
        showNotification('✓ Saved manual meal');
      }
      return;
    }

    const proteinData = componentOptions.protein.find((p) => p.name === editedComponents.protein);
    const carbData = componentOptions.carb.find((c) => c.name === editedComponents.carb);
    const vegData = editedComponents.veg !== 'None' ? componentOptions.vegetable.find((v) => v.name === editedComponents.veg) : null;

    const proteinAmount = 150;
    const carbAmount = carbData.perUnit ? 2 : 100;
    const vegAmount = 100;

    let totalCal = (proteinData.cal * proteinAmount) / 100;
    let totalP = (proteinData.p * proteinAmount) / 100;
    let totalC = carbData.perUnit ? carbData.c * carbAmount : (carbData.c * carbAmount) / 100;
    let totalF = (proteinData.f * proteinAmount) / 100;

    if (carbData.name !== 'No carb') {
      totalCal += carbData.perUnit ? carbData.cal * carbAmount : (carbData.cal * carbAmount) / 100;
      totalP += carbData.perUnit ? carbData.p * carbAmount : (carbData.p * carbAmount) / 100;
      totalF += carbData.perUnit ? carbData.f * carbAmount : (carbData.f * carbAmount) / 100;
    }

    if (vegData) {
      totalCal += (vegData.cal * vegAmount) / 100;
      totalP += (vegData.p * vegAmount) / 100;
      totalC += (vegData.c * vegAmount) / 100;
      totalF += (vegData.f * vegAmount) / 100;
    }

    const newMeal = {
      name: `${editedComponents.style} ${editedComponents.protein}${carbData.name !== 'No carb' ? ' + ' + editedComponents.carb : ''}${
        vegData ? ' + ' + editedComponents.veg : ''
      }`,
      protein: Math.round(totalP),
      cal: Math.round(totalCal),
      macros: { p: Math.round(totalP), c: Math.round(totalC), f: Math.round(totalF) },
      components: {
        protein: editedComponents.protein,
        amount: proteinAmount,
        carb: editedComponents.carb,
        carbAmount,
        veg: vegData ? editedComponents.veg : null,
        vegAmount,
        style: editedComponents.style
      }
    };

    appendMealEvent({
      type: 'edit',
      dateKey: selectedDateKey,
      mealType: currentModalMealType,
      originalMealName,
      updatedMealName: newMeal.name,
      isManualEntry: false
    });

    updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: newMeal }));
    setShowEditModal(false);
    showNotification(`✓ Meal updated: ${newMeal.name}`);
  };

  const handleCustom = (mealType) => {
    if (blockViewerAction()) return;
    setCurrentModalMealType(mealType);
    setCustomMealText('');
    setShowCustomModal(true);
  };

  const saveCustomMeal = () => {
    if (blockViewerAction()) return;
    if (!customMealText.trim()) {
      showNotification('⚠️ Please enter a meal description');
      return;
    }
    const trimmedCustomText = customMealText.trim();

    const customMeal = {
      name: `Custom: ${trimmedCustomText}`,
      protein: 15,
      cal: 0,
      macros: { p: 15, c: 0, f: 0 },
      isCustom: true
    };

    updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: customMeal }));

    const newHistory = { ...mealHistory };
    if (!newHistory[selectedDateKey]) newHistory[selectedDateKey] = {};

    const existingPlanned = newHistory[selectedDateKey][currentModalMealType]?.planned || selectedDayPlan[currentModalMealType].name;

    newHistory[selectedDateKey][currentModalMealType] = {
      planned: existingPlanned,
      actual: trimmedCustomText,
      meal: trimmedCustomText,
      protein: 15,
      confirmed: true,
      isCustom: true,
      timestamp: new Date().toISOString()
    };

    const customEvent = appendMealEvent({
      type: 'custom',
      dateKey: selectedDateKey,
      mealType: currentModalMealType,
      originalMealName: existingPlanned,
      customMealText: trimmedCustomText
    });
    const updatedEventStream = [...mealEvents, customEvent];
    const customCount = getCustomMealOccurrenceCount(updatedEventStream, trimmedCustomText, 45);

    setMealHistory(newHistory);
    saveToStorage('meal-history', newHistory);
    setShowCustomModal(false);
    if (customCount === 3) {
      showNotification(`✓ Custom meal recorded: ${trimmedCustomText} (3x in 45 days, ready to add to database)`);
    } else {
      showNotification(`✓ Custom meal recorded: ${trimmedCustomText}`);
    }
  };

  const handleConfirm = async (mealType) => {
    if (blockViewerAction()) return;
    const confirmedMeal = selectedDayPlan[mealType];

    const newHistory = { ...mealHistory };
    if (!newHistory[selectedDateKey]) newHistory[selectedDateKey] = {};

    newHistory[selectedDateKey][mealType] = {
      planned: confirmedMeal.name,
      actual: confirmedMeal.name,
      meal: confirmedMeal.name,
      protein: confirmedMeal.protein,
      confirmed: true,
      timestamp: new Date().toISOString()
    };

    setMealHistory(newHistory);
    await saveToStorage('meal-history', newHistory);

    appendMealEvent({
      type: 'confirm',
      dateKey: selectedDateKey,
      mealType,
      mealName: confirmedMeal.name
    });

    showNotification(`✓ Confirmed: ${confirmedMeal.name}`);
  };

  const undoConfirmedForSelectedDay = async () => {
    if (blockViewerAction()) return;
    const dayHistory = mealHistory[selectedDateKey];
    if (!dayHistory) {
      showNotification('⚠️ No confirmed meals to undo for this day');
      return;
    }

    const nextDayHistory = { ...dayHistory };
    let undoneCount = 0;
    const affectedSlots = [];

    const mealTypesForDay = getMealTypeOrder(selectedDayPlan, dayHistory);
    for (const mealType of mealTypesForDay) {
      const entry = nextDayHistory[mealType];
      if (!entry?.confirmed) continue;

      delete nextDayHistory[mealType];
      undoneCount += 1;
      affectedSlots.push(mealType);
    }

    if (!undoneCount) {
      showNotification('⚠️ No confirmed meals to undo for this day');
      return;
    }

    const nextHistory = { ...mealHistory };
    if (Object.keys(nextDayHistory).length === 0) delete nextHistory[selectedDateKey];
    else nextHistory[selectedDateKey] = nextDayHistory;

    setMealHistory(nextHistory);
    await saveToStorage('meal-history', nextHistory);

    const undoTargets = getUndoTargetsForSlots(mealEvents, selectedDateKey, affectedSlots);
    appendMealEvent({
      type: 'undo',
      dateKey: selectedDateKey,
      mealType: 'day',
      undoTargets,
      affectedSlots
    });

    showNotification(`↩️ Undid ${undoneCount} confirmed meal${undoneCount > 1 ? 's' : ''}`);
  };

  const selectOrderOutOption = (option) => {
    if (blockViewerAction()) return;
    const newMeal = {
      name: option.name,
      protein: option.protein,
      cal: option.cal,
      macros: { p: option.protein, c: 0, f: 0 },
      orderOut: true
    };

    updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: newMeal }));
    setShowOrderOutModal(false);
    showNotification(`✓ Ordered: ${option.name}`);
  };

  const processQuickAction = (action) => {
    if (blockViewerAction()) return;
    const lunchMeals = getMealsForType('lunch');
    const dinnerMeals = getMealsForType('dinner');
    const snackMeals = getMealsForType('snack');

    const lunchConfirmed = selectedDayHistory?.lunch?.confirmed || selectedDayHistory?.lunch?.skipped;
    const dinnerConfirmed = selectedDayHistory?.dinner?.confirmed || selectedDayHistory?.dinner?.skipped;

    switch (action) {
      case 'light': {
        const lightLunch =
          lunchMeals.find((m) => m.cal < 400 && m.components?.carb === 'No carb') ||
          lunchMeals.find((m) => m.cal < 400) ||
          lunchMeals.find((m) => m.components?.carb === 'No carb');

        const lightDinner =
          dinnerMeals.find((m) => m.cal < 350 && m.components?.carb === 'No carb') ||
          dinnerMeals.find((m) => m.cal < 350) ||
          dinnerMeals.find((m) => m.components?.carb === 'No carb');

        updateSelectedPlan((prev) => ({
          ...prev,
          lunch: lunchConfirmed ? prev.lunch : lightLunch || prev.lunch,
          dinner: dinnerConfirmed ? prev.dinner : lightDinner || prev.dinner
        }));
        showNotification('✓ Switched to light low-carb meals');
        break;
      }
      case 'indian': {
        const indianMeals = lunchMeals.filter((m) => m.cuisine === 'indian');
        const indianLunch = indianMeals[0];
        const indianDinner = indianMeals.find((m) => m.name !== indianLunch?.name) || indianMeals[0];

        updateSelectedPlan((prev) => ({
          ...prev,
          lunch: lunchConfirmed ? prev.lunch : indianLunch || prev.lunch,
          dinner: dinnerConfirmed ? prev.dinner : indianDinner || prev.dinner
        }));
        showNotification('✓ Indian cuisine selected');
        break;
      }
      case 'surprise':
        if (!lunchConfirmed) handleSwap('lunch');
        if (!dinnerConfirmed) handleSwap('dinner');
        showNotification('🎲 Surprised you with new meals!');
        break;
      case 'addsnack':
        if (selectedDayPlan.snack) {
          showNotification('⚠️ Snack already added for this day');
          break;
        }
        if (!snackMeals.length) {
          showNotification('⚠️ No snack options found');
          break;
        }
        updateSelectedPlan((prev) => ({ ...prev, snack: snackMeals[0] }));
        showNotification(`✓ Snack added: ${snackMeals[0].name}`);
        break;
      default:
        break;
    }
  };

  const getTotalProtein = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return mealTypes.reduce((sum, mealType) => sum + (selectedDayPlan[mealType]?.protein || 0), 0);
  };

  const getTotalCalories = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return mealTypes.reduce((sum, mealType) => sum + (selectedDayPlan[mealType]?.cal || 0), 0);
  };

  const getWeeklyStats = () => {
    const sortedDays = Object.keys(mealHistory).sort();
    const last7Days = sortedDays.slice(-7);
    const proteinTotals = last7Days.map((day) => {
      const dayData = mealHistory[day] || {};
      const plan = mealPlans[day] || {};
      const mealTypesForDay = getMealTypeOrder(plan, dayData);
      return mealTypesForDay.reduce((sum, mealType) => sum + (dayData[mealType]?.protein || 0), 0);
    });

    const avg = proteinTotals.reduce((a, b) => a + b, 0) / (proteinTotals.length || 1);
    return {
      days: last7Days.length,
      avgProtein: Math.round(avg),
      above100: proteinTotals.filter((p) => p >= 100).length
    };
  };

  const getDayCompletion = (dateKey) => {
    const dayData = mealHistory[dateKey] || {};
    const dayPlan = mealPlans[dateKey] || {};
    const mealTypesForDay = getMealTypeOrder(dayPlan, dayData);
    const confirmedCount = mealTypesForDay.filter((m) => dayData[m]?.confirmed).length;
    const protein = mealTypesForDay.reduce((sum, mealType) => sum + (dayData[mealType]?.protein || 0), 0);
    return { confirmedCount, protein, totalSlots: mealTypesForDay.length };
  };

  const copyTodaysPlan = () => {
    const b = selectedDayPlan.breakfast;
    const l = selectedDayPlan.lunch;
    const s = selectedDayPlan.snack;
    const d = selectedDayPlan.dinner;
    const total = getTotalProtein();
    const snackText = s ? `\n\n🥜 SNACK: ${s.name}\nProtein: ${s.protein}g` : '';

    const text = `📅 MEAL PLAN (${formatDateLabel(selectedDateKey)})\n\n🍳 BREAKFAST: ${b.name}\nProtein: ${b.protein}g\n\n🍽️ LUNCH: ${l.name}\nProtein: ${l.protein}g${snackText}\n\n🌙 DINNER: ${d.name}\nProtein: ${d.protein}g\n\n💪 TOTAL PROTEIN: ${total}g`;

    const copyWithTextareaFallback = () => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
      } catch {
        return false;
      }
    };

    const shareOrCopy = async () => {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'Meal Plan', text });
          showNotification('✓ Plan shared');
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          showNotification('✓ Plan copied! Paste in WhatsApp');
          return;
        } catch {
          // Continue to legacy fallback
        }
      }

      if (copyWithTextareaFallback()) {
        showNotification('✓ Plan copied! Paste in WhatsApp');
        return;
      }

      showNotification('⚠️ Share/copy failed on this browser');
    };

    void shareOrCopy();
  };



  const regenerateRestOfWeek = () => {
    if (blockViewerAction()) return;
    const weekKeys = getWeekDateKeys(selectedDateKey).sort();
    const remainingWeekKeys = weekKeys.filter((k) => k > selectedDateKey);

    if (remainingWeekKeys.length === 0) {
      showNotification('⚠️ No remaining days in this week to regenerate');
      return;
    }

    const chosenMealNames = getMealTypeOrder(selectedDayPlan, selectedDayHistory)
      .map((mealType) => selectedDayPlan[mealType]?.name)
      .filter(Boolean);

    const nextPlans = { ...mealPlans };
    let regeneratedDays = 0;
    let keptLockedDays = 0;

    for (const dayKey of remainingWeekKeys) {
      if (hasLockedHistoryForDate(dayKey, mealHistory)) {
        keptLockedDays += 1;
        continue;
      }

      nextPlans[dayKey] = generatePlanForDate(dayKey, nextPlans, preferences);
      regeneratedDays += 1;
    }

    if (regeneratedDays === 0) {
      showNotification(keptLockedDays > 0 ? '⚠️ All remaining days are locked (confirmed)' : '⚠️ No days regenerated');
      return;
    }

    setMealPlans(nextPlans);
    saveToStorage('meal-plans', nextPlans);
    appendMealEvent({
      type: 'regen',
      dateKey: selectedDateKey,
      mealType: 'week',
      regeneratedDays,
      keptLockedDays,
      contextMeals: Array.from(new Set(chosenMealNames))
    });

    showNotification(`✓ Regenerated ${regeneratedDays} day(s)${keptLockedDays > 0 ? `, kept ${keptLockedDays} locked` : ''}`);
  };
  const todayKey = getDateKey();
  const weekDateKeys = getWeekDateKeys(selectedDateKey);
  const selectedMealTypeOrder = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
  const mealTypeLabels = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    snack: 'Snack',
    dinner: 'Dinner'
  };
  const formatMealName = (mealOrName) => {
    if (!mealOrName) return '';
    const text = typeof mealOrName === 'string' ? mealOrName : mealOrName.display_name || mealOrName.name || '';
    return text.length > 44 ? `${text.slice(0, 43)}…` : text;
  };
  const selectedRoleOption = ROLE_OPTIONS.find((option) => option.id === onboardingDraft.role) || ROLE_OPTIONS[0];
  const selectedGoalOption = GOAL_OPTIONS.find((option) => option.id === onboardingDraft.goal) || GOAL_OPTIONS[0];
  const readOnlyHint = 'Viewer mode: this action is disabled';

  const saveOnboardingAndContinue = async () => {
    await persistOnboardingProfile(onboardingDraft, { silent: true });
    showNotification('✓ Onboarding complete');
  };

  const saveEditedPreferences = async () => {
    await persistOnboardingProfile(onboardingDraft);
    setShowPreferencesModal(false);
  };

  const renderOnboardingFlow = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-lg shadow-md p-5 mt-6">
          <h1 className="text-xl font-bold text-gray-800">Welcome to Meal Planner</h1>
          <p className="text-sm text-gray-600 mt-1">Set your role and planning goal to personalize this workspace.</p>

          <div className="mt-4 mb-5 flex items-center gap-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className={`h-2 flex-1 rounded-full ${step <= onboardingStep ? 'bg-blue-500' : 'bg-gray-200'}`} />
            ))}
          </div>

          {onboardingStep === 1 && (
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">Step 1 of 3: Select your role</p>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((option) => {
                  const selected = onboardingDraft.role === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setOnboardingDraft((prev) => ({ ...prev, role: option.id }))}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="font-semibold text-gray-800">{option.label}</div>
                      <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {onboardingStep === 2 && (
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">Step 2 of 3: Select your goal</p>
              <div className="space-y-2">
                {GOAL_OPTIONS.map((option) => {
                  const selected = onboardingDraft.goal === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setOnboardingDraft((prev) => ({ ...prev, goal: option.id }))}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="font-semibold text-gray-800">{option.label}</div>
                      <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {onboardingStep === 3 && (
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">Step 3 of 3: Review and confirm</p>
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Role</div>
                  <div className="text-sm font-semibold text-gray-800">{selectedRoleOption?.label}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Goal</div>
                  <div className="text-sm font-semibold text-gray-800">{selectedGoalOption?.label}</div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setOnboardingStep((prev) => Math.max(prev - 1, 1))}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              disabled={onboardingStep === 1}
            >
              Back
            </button>
            {onboardingStep < 3 ? (
              <button
                onClick={() => setOnboardingStep((prev) => Math.min(prev + 1, 3))}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Next
              </button>
            ) : (
              <button
                onClick={saveOnboardingAndContinue}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Confirm
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your meal plan...</p>
        </div>
      </div>
    );
  }

  if (!hasCompletedOnboarding) {
    return renderOnboardingFlow();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        {notification && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-pulse">{notification}</div>
        )}

        {showPreferencesModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowPreferencesModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Edit Preferences</h3>
                <button onClick={() => setShowPreferencesModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>

              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Role</p>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map((option) => {
                    const selected = onboardingDraft.role === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setOnboardingDraft((prev) => ({ ...prev, role: option.id }))}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="font-semibold text-gray-800">{option.label}</div>
                        <div className="text-xs text-gray-600">{option.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Goal</p>
                <div className="space-y-2">
                  {GOAL_OPTIONS.map((option) => {
                    const selected = onboardingDraft.goal === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setOnboardingDraft((prev) => ({ ...prev, goal: option.id }))}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="font-semibold text-gray-800">{option.label}</div>
                        <div className="text-xs text-gray-600">{option.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-gray-500 mb-4">
                Rules adapter keys: role <strong>{rulesProfileAdapter.roleKey}</strong>, goal <strong>{rulesProfileAdapter.goalKey}</strong>
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowPreferencesModal(false)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm font-semibold"
                >
                  Cancel
                </button>
                <button onClick={saveEditedPreferences} className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {showCustomModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowCustomModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Custom Meal</h3>
                <button onClick={() => setShowCustomModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">Enter what you ate (nutrition tracking not needed - just for weekly analysis)</p>
              <input
                type="text"
                placeholder="e.g., Sushi + miso soup, Burger + fries, etc."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:border-blue-500"
                value={customMealText}
                onChange={(e) => setCustomMealText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && saveCustomMeal()}
                disabled={isViewerMode}
                autoFocus
              />
              <button
                onClick={saveCustomMeal}
                className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                Save Custom Meal
              </button>
            </div>
          </div>
        )}

        {showOrderOutModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowOrderOutModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Order Out - {currentModalMealType}</h3>
                <button onClick={() => setShowOrderOutModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
              <div className="space-y-3">
                {orderOutOptions[currentModalMealType]?.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectOrderOutOption(option);
                    }}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors active:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isViewerMode}
                    title={isViewerMode ? readOnlyHint : ''}
                  >
                    <div className="font-semibold text-gray-800">{option.name}</div>
                    <div className="text-sm text-blue-600 font-bold mt-1">P: {option.protein}g | {option.cal} kcal</div>
                    <div className="text-xs text-gray-600 mt-1">{option.note}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {showEditModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowEditModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">
                  <Edit3 className="inline mr-2" size={20} />
                  Edit Meal Components
                </h3>
                <button onClick={() => setShowEditModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">If manual entry is filled, dropdown selections are ignored. Leave manual entry blank to use dropdown editing.</p>
              <div className="mb-4 p-3 rounded-lg border border-blue-100 bg-blue-50">
                <label className="text-xs font-semibold text-blue-800">Quick Manual Entry</label>
                <p className="text-xs text-blue-700 mt-1 mb-2">
                  Type your meal/components here. Matching is temporarily disabled while we stabilize this input.
                </p>
                <textarea
                  className="w-full px-3 py-2 border border-blue-200 rounded text-sm bg-white"
                  rows={2}
                  placeholder="Type meal components here..."
                  value={manualEditText}
                  onChange={(e) => setManualEditText(e.target.value)}
                  disabled={isViewerMode}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700">Protein</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
                    value={editedComponents.protein}
                    onChange={(e) => setEditedComponents((prev) => ({ ...prev, protein: e.target.value }))}
                    disabled={isViewerMode}
                  >
                    {componentOptions.protein.map((opt, idx) => (
                      <option key={idx} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Carb/Base</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
                    value={editedComponents.carb}
                    onChange={(e) => setEditedComponents((prev) => ({ ...prev, carb: e.target.value }))}
                    disabled={isViewerMode}
                  >
                    <option value="No carb">None</option>
                    {componentOptions.carb
                      .filter((c) => c.name !== 'No carb')
                      .map((opt, idx) => (
                        <option key={idx} value={opt.name}>
                          {opt.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Vegetable/Side</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
                    value={editedComponents.veg}
                    onChange={(e) => setEditedComponents((prev) => ({ ...prev, veg: e.target.value }))}
                    disabled={isViewerMode}
                  >
                    <option value="None">None</option>
                    {componentOptions.vegetable.map((opt, idx) => (
                      <option key={idx} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Cooking Style</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
                    value={editedComponents.style}
                    onChange={(e) => setEditedComponents((prev) => ({ ...prev, style: e.target.value }))}
                    disabled={isViewerMode}
                  >
                    {componentOptions.style.map((opt, idx) => (
                      <option key={idx} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={applyComponentEdit}
                  className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300"
                  disabled={isViewerMode}
                  title={isViewerMode ? readOnlyHint : ''}
                >
                  Apply Changes
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">🍽️ My Meal Companion</h1>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-[11px] px-2 py-1 rounded-full font-semibold ${isViewerMode ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-700'}`}>
              {roleConfig?.label}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full font-semibold bg-blue-100 text-blue-700">{goalConfig?.label}</span>
            <button
              onClick={openPreferencesEditor}
              className="text-[11px] px-2 py-1 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-semibold"
            >
              Edit Preferences
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">{formatDateLabel(selectedDateKey)}</p>
            <div className="flex items-center gap-2">
              <button onClick={copyTodaysPlan} className="text-xs px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold whitespace-nowrap">
                📋 Share Day
              </button>
              <button
                onClick={undoConfirmedForSelectedDay}
                className="text-[11px] px-2 py-1 bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200 font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                Undo
              </button>
            </div>
          </div>
        </div>

        {isViewerMode && (
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 mb-4">
            <p className="text-sm font-semibold text-gray-700">Viewer mode is active</p>
            <p className="text-xs text-gray-600 mt-1">Swap, edit, confirm, undo, and regen actions are disabled in read-only mode.</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          {selectedMealTypeOrder.map((mealType) => {
            const historyEntry = selectedDayHistory?.[mealType];
            const meal =
              selectedDayPlan[mealType] ||
              (historyEntry
                ? {
                    name: historyEntry.meal || historyEntry.actual || historyEntry.planned || 'Logged meal',
                    protein: historyEntry.protein || 0,
                    cal: 0,
                    macros: { p: historyEntry.protein || 0, c: 0, f: 0 }
                  }
                : null);

            if (!meal) return null;
            const isConfirmed = selectedDayHistory?.[mealType]?.confirmed;
            const isSkipped = selectedDayHistory?.[mealType]?.skipped;

            return (
              <div key={mealType} className="mb-4 pb-4 border-b border-gray-200 last:border-0">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-gray-600">{mealTypeLabels[mealType]}:</span>
                    <span className="ml-2 text-gray-800">{formatMealName(meal)}</span>
                    <span className="ml-3 text-blue-600 font-bold">P: {meal.protein}g</span>
                    {meal.orderOut && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">OO</span>}
                    {isConfirmed && <Check className="inline ml-2 text-green-500" size={16} />}
                    {isSkipped && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">⊘ Skipped</span>}
                  </div>
                </div>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <button
                    onClick={() => handleConfirm(mealType)}
                    className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isConfirmed || isSkipped || isViewerMode}
                    title={isViewerMode ? readOnlyHint : ''}
                  >
                    {isConfirmed ? '✓ Confirmed' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => handleSwap(mealType)}
                    className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isConfirmed || isSkipped || isViewerMode}
                    title={isViewerMode ? readOnlyHint : ''}
                  >
                    Swap
                  </button>
                  {mealType !== 'snack' && meal.components && (
                    <button
                      onClick={() => handleEdit(mealType)}
                      className="text-xs px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isConfirmed || isSkipped || isViewerMode}
                      title={isViewerMode ? readOnlyHint : ''}
                    >
                      <Edit3 className="inline mr-1" size={12} />
                      Edit
                    </button>
                  )}
                  {mealType !== 'snack' && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCurrentModalMealType(mealType);
                        setShowOrderOutModal(true);
                      }}
                      className="text-xs px-3 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isConfirmed || isSkipped || isViewerMode}
                      title={isViewerMode ? readOnlyHint : ''}
                    >
                      Order out
                    </button>
                  )}
                  {mealType !== 'snack' && (
                    <button
                      onClick={() => handleCustom(mealType)}
                      className="text-xs px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isConfirmed || isSkipped || isViewerMode}
                      title={isViewerMode ? readOnlyHint : ''}
                    >
                      Custom
                    </button>
                  )}
                </div>
                <button onClick={() => toggleExpand(mealType)} className="text-xs text-blue-600 flex items-center gap-1 hover:text-blue-800">
                  Details {expandedMeals[mealType] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {expandedMeals[mealType] && (
                  <div className="mt-3 pl-4 border-l-2 border-blue-200">
                    <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                      <strong>Total:</strong> {meal.cal} kcal | P: {meal.macros.p}g | C: {meal.macros.c}g | F: {meal.macros.f}g
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="mb-4 border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">⚡ Quick Actions:</p>
            <div className="grid grid-cols-4 gap-2 mb-2">
              <button
                onClick={() => processQuickAction('light')}
                className="text-[11px] px-2 py-1.5 bg-green-100 text-green-700 rounded-full hover:bg-green-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                🥗 Go Light
              </button>
              <button
                onClick={() => processQuickAction('indian')}
                className="text-[11px] px-2 py-1.5 bg-orange-100 text-orange-700 rounded-full hover:bg-orange-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                🍛 Indian
              </button>
              <button
                onClick={() => processQuickAction('surprise')}
                className="text-[11px] px-2 py-1.5 bg-pink-100 text-pink-700 rounded-full hover:bg-pink-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                🎲 Surprise
              </button>
              <button
                onClick={() => processQuickAction('addsnack')}
                className="text-[11px] px-2 py-1.5 bg-teal-100 text-teal-700 rounded-full hover:bg-teal-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
                title={isViewerMode ? readOnlyHint : ''}
              >
                ➕ Snack
              </button>
            </div>
          </div>

          {customCandidates.length > 0 && (
            <div className="mb-4 border-t border-gray-200 pt-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">🧠 Frequent custom meals:</p>
              <div className="space-y-2">
                {customCandidates.slice(0, 5).map((candidate) => (
                  <div key={candidate.normalizedKey} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-800">{candidate.displayName}</div>
                      <div className="text-[11px] text-amber-800">
                        {candidate.count}x in 45 days • {getCandidateTargetLabel(candidate.suggestedMealType)}
                      </div>
                    </div>
                    <button
                      onClick={() => approveCustomCandidate(candidate)}
                      className="shrink-0 rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isViewerMode}
                      title={isViewerMode ? readOnlyHint : ''}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Day Total Protein:</span>
              <span className="text-2xl font-bold">{getTotalProtein()}g</span>
            </div>
            <button onClick={() => setExpandedMeals((prev) => ({ ...prev, totals: !prev.totals }))} className="text-xs mt-2 opacity-80 hover:opacity-100">
              {expandedMeals.totals ? '▲' : '▼'} Tap for total calories
            </button>
            {expandedMeals.totals && <div className="mt-2 text-sm opacity-90">Total: {getTotalCalories()} kcal</div>}
          </div>
        </div>

        <button
          onClick={regenerateRestOfWeek}
          className="w-full bg-green-500 text-white py-3 rounded-lg font-semibold mb-4 hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300"
          disabled={isViewerMode}
          title={isViewerMode ? readOnlyHint : ''}
        >
          ♻️ Regen Rest Of Week
        </button>

        <div className="bg-white rounded-lg shadow-md p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              onClick={() => setSelectedDateKey((prev) => shiftDateKey(prev, -1))}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200"
            >
              ◀ Prev
            </button>
            <button
              onClick={() => setSelectedDateKey(todayKey)}
              className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200"
            >
              Today
            </button>
            <button
              onClick={() => setSelectedDateKey((prev) => shiftDateKey(prev, 1))}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200"
            >
              Next ▶
            </button>
            <input
              type="date"
              value={selectedDateKey}
              onChange={(e) => setSelectedDateKey(e.target.value)}
              className="ml-auto text-xs px-2 py-1.5 border border-gray-300 rounded"
            />
          </div>

          <div className="grid grid-cols-7 gap-1">
            {weekDateKeys.map((dateKey) => {
              const completion = getDayCompletion(dateKey);
              const isSelected = dateKey === selectedDateKey;
              const isToday = dateKey === todayKey;
              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDateKey(dateKey)}
                  className={`rounded p-2 text-center border ${
                    isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-[10px] font-semibold">
                    {parseDateKey(dateKey).toLocaleDateString('en-US', { weekday: 'short', timeZone: IST_TIME_ZONE })}
                  </div>
                  <div className="text-xs">{parseDateKey(dateKey).getUTCDate()}</div>
                  <div className={`text-[10px] ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                    {completion.confirmedCount}/{completion.totalSlots}
                  </div>
                  {isToday && <div className="text-[9px]">Today</div>}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => setShowProgress(!showProgress)}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold mb-4 hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
        >
          <TrendingUp size={20} />
          {showProgress ? '▲ Hide' : '▼ Show'} Progress Tracker
        </button>

        {showProgress && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">📊 Your Progress</h2>
            {Object.keys(mealHistory).length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-blue-50 p-4 rounded text-center">
                    <div className="text-2xl font-bold text-blue-600">{getWeeklyStats().days}</div>
                    <div className="text-xs text-gray-600">Days Tracked</div>
                  </div>
                  <div className="bg-green-50 p-4 rounded text-center">
                    <div className="text-2xl font-bold text-green-600">{getWeeklyStats().avgProtein}g</div>
                    <div className="text-xs text-gray-600">Avg Protein/Day</div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded text-center col-span-2">
                    <div className="text-2xl font-bold text-purple-600">{getWeeklyStats().above100}</div>
                    <div className="text-xs text-gray-600">Days ≥100g P</div>
                  </div>
                </div>
                <p className="text-xs text-gray-600 bg-yellow-50 p-3 rounded border-l-4 border-yellow-400">
                  💬 <strong>Weekly Check-In:</strong> Ask me in chat to analyze your week and suggest new meals based on your preferences!
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-600 text-center py-8">Start confirming your meals to see progress tracking! 📈</p>
            )}
          </div>
        )}

        <button
          onClick={() => setShowWeekly(!showWeekly)}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold mb-4 hover:bg-indigo-700 transition-colors"
        >
          {showWeekly ? '▲ Hide' : '▼ Show'} Weekly Calendar
        </button>

        {showWeekly && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Week Snapshot</h2>
            <p className="text-xs text-gray-600 mb-4 bg-blue-50 p-3 rounded border-l-4 border-blue-400">
              Planned and confirmed meals for the selected week.
            </p>
            <div className="space-y-3">
              {weekDateKeys.map((dateKey) => {
                const plan = mealPlans[dateKey] || createDefaultPlan();
                const dayData = mealHistory[dateKey] || {};
                const completion = getDayCompletion(dateKey);
                return (
                  <div key={dateKey} className={`border rounded p-3 ${dateKey === selectedDateKey ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <button onClick={() => setSelectedDateKey(dateKey)} className="font-semibold text-gray-700 hover:text-blue-700">
                        {formatWeekSnapshotDateLabel(dateKey)}
                      </button>
                      <span className="text-xs text-gray-600">
                        {completion.confirmedCount}/{completion.totalSlots} confirmed
                      </span>
                    </div>
                    <div className="text-xs space-y-1">
                      {getMealTypeOrder(plan, dayData).map((mealType) => (
                        <div key={mealType} className="flex justify-between gap-2">
                          <span className="text-gray-700 truncate">
                            {mealTypeLabels[mealType]}:{' '}
                            {formatMealName(plan[mealType] || dayData[mealType]?.meal || dayData[mealType]?.actual || 'Not set')}
                          </span>
                          <span className="text-blue-600 font-semibold">{dayData[mealType]?.protein || plan[mealType]?.protein || 0}g</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t text-xs text-gray-600">Recorded protein: {completion.protein}g</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MealPlannerApp;
