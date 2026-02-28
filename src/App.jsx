import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Check, TrendingUp, X, Edit3, Loader2 } from 'lucide-react';
import { mealDatabase } from './data/mealDatabase';
import OnboardingFlow from './components/OnboardingFlow';
import Omnibox from './components/Omnibox';
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
  ONBOARDING_MODE,
  buildOnboardingProfile,
  getDefaultOnboardingDraft,
  getOnboardingGoalLabel,
  getOnboardingModeLabel,
  normalizeOnboardingProfile
} from './lib/onboardingProfile';
import { buildGoalAdjustedPlannerInput, getMealTypeOrderForGoal } from './lib/onboardingPlannerAdapter';
import { computeMacros } from './lib/mealDataLayer';

const MealPlannerApp = () => {
  const IST_TIME_ZONE = 'Asia/Kolkata';
  const STORAGE_API_BASE = '/api/storage';
  const ONBOARDING_PROFILE_STORAGE_KEY = 'meal-onboarding-profile';
  const DEFAULT_USER_CATALOG = { breakfast: [], lunchDinner: [], snack: [] };

  const [expandedMeals, setExpandedMeals] = useState({});
  const [showWeekly, setShowWeekly] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [notification, setNotification] = useState('');
  const [showDiningOutModal, setShowDiningOutModal] = useState(false);
  const [showOmniboxSlotModal, setShowOmniboxSlotModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAutoGeneration, setPendingAutoGeneration] = useState(false);
  const [userMealCatalog, setUserMealCatalog] = useState(DEFAULT_USER_CATALOG);
  const omniboxRef = React.useRef(null);
  const [activeOmniboxContext, setActiveOmniboxContext] = useState(null);
  const [omniboxPrefill, setOmniboxPrefill] = useState('');
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
    getMealTypeOrderForGoal({
      goal: onboardingProfile?.goal,
      plan,
      history
    });


  const hasLockedHistoryForDate = (dateKey, historyState) => {
    const day = historyState?.[dateKey] || {};
    return CORE_MEAL_TYPES.some((mealType) => day[mealType]?.confirmed || day[mealType]?.skipped);
  };

  const isSamePlanByName = (a, b) => {
    if (!a || !b) return false;
    return CORE_MEAL_TYPES.every((mealType) => a[mealType]?.name && b[mealType]?.name && a[mealType].name === b[mealType].name);
  };

  const generatePlanForDate = (dateKey, plans, preferences, goalOverride = onboardingProfile?.goal) => {
    const adaptedInput = buildGoalAdjustedPlannerInput({
      goal: goalOverride,
      preferences,
      mealDatabase: mergedMealDatabase
    });

    return plannerGeneratePlanForDate({
      dateKey,
      plans,
      preferences: adaptedInput.preferences,
      dailyProteinTarget: adaptedInput.dailyProteinTarget,
      mealDatabase: mergedMealDatabase
    });
  };

  const normalizePreferences = (prefs = {}) => plannerNormalizePreferences(prefs);

  const [selectedDateKey, setSelectedDateKey] = useState(getDateKey());
  const [mealPlans, setMealPlans] = useState({});
  const [mealHistory, setMealHistory] = useState({});
  const [preferences, setPreferences] = useState(() => normalizePreferences({}));
  const [mealEvents, setMealEvents] = useState([]);
  const [onboardingProfile, setOnboardingProfile] = useState(null);
  const [showOnboardingEditor, setShowOnboardingEditor] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const isViewerMode = onboardingProfile?.mode === ONBOARDING_MODE.VIEWER;
  const onboardingDraft = onboardingProfile
    ? { mode: onboardingProfile.mode, goal: onboardingProfile.goal }
    : getDefaultOnboardingDraft();

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
        const onboardingResult = await storageGet(ONBOARDING_PROFILE_STORAGE_KEY);
        const autoGenResult = await storageGet('last-auto-gen-week');

        const parsedHistory = normalizeDateMap(safeParseJson(historyResult, historyResult) || {});
        const parsedPrefs = normalizePreferences(safeParseJson(prefsResult, prefsResult) || {});
        const parsedPlans = normalizeDateMap(safeParseJson(plansResult, plansResult) || {});
        const parsedEventsRaw = safeParseJson(eventsResult, eventsResult);
        const parsedUserCatalog = normalizeUserMealCatalog(safeParseJson(userCatalogResult, userCatalogResult) || {});
        const parsedOnboarding = normalizeOnboardingProfile(safeParseJson(onboardingResult, onboardingResult));
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
        setOnboardingProfile(parsedOnboarding);

        void saveToStorage('meal-history', parsedHistory);
        void saveToStorage('meal-preferences', derivedPreferences);
        void saveToStorage('meal-plans', parsedPlans);
        void saveToStorage('meal-events', parsedEvents);
        void saveToStorage('meal-user-catalog', parsedUserCatalog);
        if (parsedOnboarding) {
          void saveToStorage(ONBOARDING_PROFILE_STORAGE_KEY, parsedOnboarding);
        }

        const currentWeekMonday = getWeekDateKeys(getDateKey(new Date()))[0];
        if (autoGenResult !== currentWeekMonday && parsedOnboarding?.mode !== ONBOARDING_MODE.VIEWER) {
          setPendingAutoGeneration(true);
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
  }, [selectedDateKey, mealPlans, loading, preferences, mealHistory, mergedMealDatabase, onboardingProfile]);

  useEffect(() => {
    if (loading) return;
    const nextPreferences = derivePreferencesFromEvents(mealEvents);
    setPreferences(nextPreferences);
    void saveToStorage('meal-events', mealEvents);
    void saveToStorage('meal-preferences', nextPreferences);
  }, [mealEvents, loading]);

  useEffect(() => {
    if (!loading && pendingAutoGeneration && mergedMealDatabase && !isViewerMode) {
      setPendingAutoGeneration(false);

      const today = getDateKey(new Date());
      const currentWeekKeys = getWeekDateKeys(today).sort();
      const currentWeekMonday = currentWeekKeys[0];

      void saveToStorage('last-auto-gen-week', currentWeekMonday);

      const runAutoGeneration = async () => {
        // Target all days in this week that are >= today and not locked
        const targetDateKeys = currentWeekKeys
          .filter(k => k >= today)
          .filter(k => !hasLockedHistoryForDate(k, mealHistory));

        if (targetDateKeys.length === 0) return;

        showNotification('✨ New week detected! Auto-generating your meal plan...');

        try {
          const historyMap = {};
          for (let i = 0; i < 7; i++) {
            const d = shiftDateKey(today, -i);
            if (mealHistory[d]) historyMap[d] = mealHistory[d];
            else if (mealPlans[d]) historyMap[d] = mealPlans[d];
          }

          const { generateWeeklyPlan } = await import('./lib/geminiService.js');
          const generatedDays = await generateWeeklyPlan({
            targetDateKeys,
            mealDatabase: mergedMealDatabase,
            preferences: normalizePreferences(preferences),
            historyMap,
            dailyProteinTarget: onboardingProfile?.goal?.dailyProteinTarget || 120
          });

          const nextPlans = { ...mealPlans };
          const catalog = [
            ...(mergedMealDatabase.breakfast || []),
            ...(mergedMealDatabase.lunch || []),
            ...(mergedMealDatabase.dinner || []),
            ...(mergedMealDatabase.snack || [])
          ];
          const findMeal = (name) => catalog.find(m => m.canonical_name === name) || null;

          generatedDays.forEach(day => {
            const newPlan = { ...nextPlans[day.dateKey] };
            if (day.breakfast) newPlan.breakfast = findMeal(day.breakfast) || { name: day.breakfast, protein: 0, cal: 0, macros: { p: 0, c: 0, f: 0 } };
            if (day.lunch) newPlan.lunch = findMeal(day.lunch) || { name: day.lunch, protein: 0, cal: 0, macros: { p: 0, c: 0, f: 0 } };
            if (day.dinner) newPlan.dinner = findMeal(day.dinner) || { name: day.dinner, protein: 0, cal: 0, macros: { p: 0, c: 0, f: 0 } };
            if (day.snack) newPlan.snack = findMeal(day.snack) || { name: day.snack, protein: 0, cal: 0, macros: { p: 0, c: 0, f: 0 } };
            nextPlans[day.dateKey] = newPlan;
          });

          setMealPlans(nextPlans);
          saveToStorage('meal-plans', nextPlans);
          showNotification(`✓ Successfully auto-generated ${generatedDays.length} days for the new week!`);
        } catch (error) {
          console.error("Auto-generation failed", error);
        }
      };

      runAutoGeneration();
    }
  }, [loading, pendingAutoGeneration, mergedMealDatabase, isViewerMode, mealHistory, mealPlans, preferences, onboardingProfile]);

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

  const requireWriteAccess = (actionLabel) => {
    if (!isViewerMode) return true;
    showNotification(`👀 Viewer mode: ${actionLabel} is disabled`);
    return false;
  };

  const toggleExpand = (meal) => {
    setExpandedMeals((prev) => ({ ...prev, [meal]: !prev[meal] }));
  };

  const appendMealEvent = (payload) => {
    const event = createMealEvent(payload);
    setMealEvents((prev) => [...prev, event]);
    return event;
  };

  const regenerateCurrentWeekForGoal = (goal) => {
    const keysToEnsure = Array.from(new Set([selectedDateKey, ...getWeekDateKeys(selectedDateKey)])).sort();

    setMealPlans((prev) => {
      const nextPlans = { ...prev };
      let changed = false;

      for (const key of keysToEnsure) {
        if (hasLockedHistoryForDate(key, mealHistory)) continue;
        nextPlans[key] = generatePlanForDate(key, nextPlans, preferences, goal);
        changed = true;
      }

      if (!changed) return prev;
      void saveToStorage('meal-plans', nextPlans);
      return nextPlans;
    });
  };

  const handleOnboardingComplete = async ({ mode, goal }) => {
    const nextProfile = buildOnboardingProfile({
      mode,
      goal,
      previousProfile: onboardingProfile
    });

    if (!nextProfile) {
      showNotification('⚠️ Could not save onboarding choices');
      return;
    }

    const wasEditing = showOnboardingEditor;
    setOnboardingProfile(nextProfile);
    setShowOnboardingEditor(false);
    await saveToStorage(ONBOARDING_PROFILE_STORAGE_KEY, nextProfile);
    regenerateCurrentWeekForGoal(nextProfile.goal);
    showNotification(wasEditing ? '✓ Preferences updated' : '✓ Setup complete');
  };

  const handleAIAction = (payload) => {
    if (requireWriteAccess('AI Actions') === false) return;

    // Use active context if present, else fallback to first available unconfirmed/unskipped slot
    const targetSlot = activeOmniboxContext || CORE_MEAL_TYPES.find(type => !selectedDayHistory[type]?.confirmed && !selectedDayHistory[type]?.skipped) || 'dinner';

    // Clear the active context state now that the prompt has returned
    setActiveOmniboxContext(null);

    try {
      if (payload.intent === 'ADD_DB_MEAL') {
        const mealData = payload.data;
        updateSelectedPlan((prev) => ({
          ...prev,
          [targetSlot]: mealData
        }));

        setMealHistory((prev) => ({
          ...prev,
          [selectedDateKey]: {
            ...prev[selectedDateKey],
            [targetSlot]: { meal: mealData.name, confirmed: true, exactMatch: true }
          }
        }));

        appendMealEvent({
          type: 'custom',
          dateKey: selectedDateKey,
          mealType: targetSlot,
          mealName: mealData.name
        });

        showNotification(`✓ Logged ${mealData.name}`);
      }
      else if (payload.intent === 'ADD_CUSTOM') {
        const computed = computeMacros(payload.data.parts || []);

        const mealData = {
          name: payload.data.name,
          parts: payload.data.parts || [],
          cal: computed.cal,
          protein: computed.protein,
          macros: computed.macros,
          custom: true
        };

        updateSelectedPlan((prev) => ({
          ...prev,
          [targetSlot]: mealData
        }));

        setMealHistory((prev) => ({
          ...prev,
          [selectedDateKey]: {
            ...prev[selectedDateKey],
            [targetSlot]: { meal: payload.data.name, confirmed: true, exactMatch: false }
          }
        }));

        appendMealEvent({
          type: 'custom',
          dateKey: selectedDateKey,
          mealType: targetSlot,
          mealName: payload.data.name
        });

        showNotification(`✓ Logged ${payload.data.name}`);
      }
      else if (payload.intent === 'UNVERIFIED_NOVEL_FOOD') {
        const mealData = {
          name: payload.data.name,
          cal: payload.data.estimatedCalories || 0,
          protein: payload.data.estimatedProtein || 0,
          macros: {
            p: payload.data.estimatedProtein || 0,
            c: payload.data.estimatedCarbs || 0,
            f: payload.data.estimatedFats || 0
          },
          custom: true
        };

        // Save to pending novel foods queue here
        storageGet('pending-novel-foods').then(currentQueueStr => {
          const currentQueue = typeof currentQueueStr === 'string' ? JSON.parse(currentQueueStr || '[]') : (currentQueueStr || []);
          currentQueue.push(mealData);
          saveToStorage('pending-novel-foods', currentQueue);
        }).catch(err => console.error('Failed to save novel food', err));

        updateSelectedPlan((prev) => ({
          ...prev,
          [targetSlot]: mealData
        }));

        setMealHistory((prev) => ({
          ...prev,
          [selectedDateKey]: {
            ...prev[selectedDateKey],
            [targetSlot]: { meal: payload.data.name, confirmed: true, exactMatch: false }
          }
        }));

        appendMealEvent({
          type: 'custom',
          dateKey: selectedDateKey,
          mealType: targetSlot,
          mealName: payload.data.name
        });

        showNotification(`🤖 Estimated: ${payload.data.name}`);
      }
      else if (payload.intent === 'DINING_OUT') {
        const mealData = {
          name: payload.data.name,
          cal: payload.data.estimatedCalories || 0,
          protein: payload.data.estimatedProtein || 0,
          macros: {
            p: payload.data.estimatedProtein || 0,
            c: payload.data.estimatedCarbs || 0,
            f: payload.data.estimatedFats || 0
          },
          orderOut: true
        };

        updateSelectedPlan((prev) => ({
          ...prev,
          [targetSlot]: mealData
        }));

        setMealHistory((prev) => ({
          ...prev,
          [selectedDateKey]: {
            ...prev[selectedDateKey],
            [targetSlot]: {
              meal: payload.data.name,
              confirmed: true,
              orderOut: true,
              protein: payload.data.estimatedProtein || 0,
              cal: payload.data.estimatedCalories || 0
            }
          }
        }));

        appendMealEvent({
          type: 'custom',
          dateKey: selectedDateKey,
          mealType: targetSlot,
          mealName: payload.data.name
        });

        showNotification(`🍱 Cheated: ${payload.data.name}`);
      }

      else if (payload.intent === 'GENERAL_SWAP') {
        handleSwap(targetSlot);
        showNotification('✓ Swapped based on AI request');
      }

      else if (payload.intent === 'MODIFY') {
        showNotification('🚧 Component matching coming soon');
      }

    } catch (err) {
      console.error(err);
      showNotification('⚠️ Failed to apply AI changes');
    }
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
    if (!requireWriteAccess('Adding custom meals')) return;
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
    if (!requireWriteAccess('Swapping meals')) return;
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


  const handleEditClick = (mealType) => {
    setActiveOmniboxContext(mealType);
    setTimeout(() => {
      if (omniboxRef.current) {
        omniboxRef.current.focus();

        // Delay the scroll slightly to allow the mobile virtual keyboard to render
        // Then scroll it so the Omnibox is slightly above the exact center of the screen
        setTimeout(() => {
          if (omniboxRef.current) {
            const y = omniboxRef.current.getBoundingClientRect().top + window.scrollY - 100;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }
        }, 300);
      }
    }, 10);
  };

  const handleSkip = async (mealType) => {
    if (!requireWriteAccess('Skipping meals')) return;

    const newHistory = { ...mealHistory };
    if (!newHistory[selectedDateKey]) newHistory[selectedDateKey] = {};

    newHistory[selectedDateKey][mealType] = {
      skipped: true,
      timestamp: new Date().toISOString()
    };

    setMealHistory(newHistory);
    await saveToStorage('meal-history', newHistory);

    appendMealEvent({
      type: 'skip',
      dateKey: selectedDateKey,
      mealType
    });

    showNotification(`⊘ Skipped ${mealTypeLabels[mealType]}`);
  };

  const undoSkippedForSelectedDay = async () => {
    if (!requireWriteAccess('Undoing meals')) return;
    const dayHistory = mealHistory[selectedDateKey];
    if (!dayHistory) {
      showNotification('⚠️ No skipped meals to undo for this day');
      return;
    }

    const nextDayHistory = { ...dayHistory };
    let undoneCount = 0;
    const affectedSlots = [];

    const mealTypesForDay = getMealTypeOrder(selectedDayPlan, dayHistory);
    for (const mealType of mealTypesForDay) {
      const entry = nextDayHistory[mealType];
      if (!entry?.skipped) continue;

      delete nextDayHistory[mealType];
      undoneCount += 1;
      affectedSlots.push(mealType);
    }

    if (!undoneCount) {
      showNotification('⚠️ No skipped meals to undo for this day');
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

    showNotification(`↩️ Undid ${undoneCount} skipped meal${undoneCount > 1 ? 's' : ''}`);
  };

  const selectOrderOutOption = (option) => {
    if (!requireWriteAccess('Order-out selection')) return;
    const newMeal = {
      name: option.name,
      protein: option.protein,
      cal: option.cal,
      macros: { p: option.protein, c: 0, f: 0 },
      orderOut: true
    };

    updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: newMeal }));
    setShowOrderOutModal(false);
    showNotification(`✓ Ordered: ${option.name} `);
  };

  const processQuickAction = (action) => {
    if (!requireWriteAccess('Quick actions')) return;
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
        showNotification(`✓ Snack added: ${snackMeals[0].name} `);
        break;
      default:
        break;
    }
  };

  const handleDiningOut = async (slot) => {
    if (!requireWriteAccess('Dining Out')) return;

    setActiveOmniboxContext(slot);
    setOmniboxPrefill('Dine out ');

    setTimeout(() => {
      if (omniboxRef.current) {
        omniboxRef.current.focus();
        setTimeout(() => {
          if (omniboxRef.current) {
            const y = omniboxRef.current.getBoundingClientRect().top + window.scrollY - 100;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }
        }, 300);
      }
    }, 10);
  };

  const handleOmniboxSlotSelection = (slot) => {
    setActiveOmniboxContext(slot);
    setShowOmniboxSlotModal(false);
    if (omniboxRef.current) {
      setTimeout(() => omniboxRef.current.focus(), 100);
    }
  };

  const getTotalProtein = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return Math.round(mealTypes.reduce((sum, mealType) => {
      if (selectedDayHistory[mealType]?.skipped) return sum;
      return sum + (selectedDayPlan[mealType]?.protein || selectedDayHistory[mealType]?.protein || 0);
    }, 0));
  };

  const getTotalCalories = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return Math.round(mealTypes.reduce((sum, mealType) => {
      if (selectedDayHistory[mealType]?.skipped) return sum;
      return sum + (selectedDayPlan[mealType]?.cal || selectedDayHistory[mealType]?.cal || 0);
    }, 0));
  };

  const getWeeklyStats = () => {
    const sortedDays = Object.keys(mealHistory).sort();
    const last7Days = sortedDays.slice(-7);
    const proteinTotals = last7Days.map((day) => {
      const dayData = mealHistory[day] || {};
      const plan = mealPlans[day] || {};
      const mealTypesForDay = getMealTypeOrder(plan, dayData);
      return mealTypesForDay.reduce((sum, mealType) => {
        if (dayData[mealType]?.skipped) return sum;
        return sum + (dayData[mealType]?.protein || plan[mealType]?.protein || 0);
      }, 0);
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

    // In Zero-Touch UX, a slot is considered 'confirmed' if it exists and wasn't explicitly skipped.
    const confirmedCount = mealTypesForDay.filter((m) => !dayData[m]?.skipped).length;

    const protein = Math.round(mealTypesForDay.reduce((sum, mealType) => {
      if (dayData[mealType]?.skipped) return sum;
      return sum + (dayData[mealType]?.protein || dayPlan[mealType]?.protein || 0);
    }, 0));

    return { confirmedCount, protein, totalSlots: mealTypesForDay.length };
  };

  const copyTodaysPlan = () => {
    const mealHeaderByType = {
      breakfast: '🍳 BREAKFAST',
      lunch: '🍽️ LUNCH',
      snack: '🥜 SNACK',
      dinner: '🌙 DINNER'
    };

    const planLines = selectedMealTypeOrder
      .map((mealType) => {
        const meal = selectedDayPlan[mealType];
        if (!meal) return null;
        const header = mealHeaderByType[mealType] || mealType.toUpperCase();
        return `${header}: ${meal.name} \nProtein: ${meal.protein} g`;
      })
      .filter(Boolean);

    const total = getTotalProtein();
    const text = `📅 MEAL PLAN(${formatDateLabel(selectedDateKey)}) \n\n${planLines.join('\n\n')} \n\n💪 TOTAL PROTEIN: ${total} g`;

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



  const regenerateRestOfWeek = async () => {
    if (!requireWriteAccess('Regenerating plans')) return;
    const weekKeys = getWeekDateKeys(selectedDateKey).sort();
    const remainingWeekKeys = weekKeys.filter((k) => k > selectedDateKey);

    if (remainingWeekKeys.length === 0) {
      showNotification('⚠️ No remaining days in this week to regenerate');
      return;
    }

    const targetDateKeys = remainingWeekKeys.filter(k => !hasLockedHistoryForDate(k, mealHistory));
    const keptLockedDays = remainingWeekKeys.length - targetDateKeys.length;

    if (targetDateKeys.length === 0) {
      showNotification(keptLockedDays > 0 ? '⚠️ All remaining days are locked (confirmed)' : '⚠️ No days to regenerate');
      return;
    }

    const chosenMealNames = getMealTypeOrder(selectedDayPlan, selectedDayHistory)
      .map((mealType) => selectedDayPlan[mealType]?.name)
      .filter(Boolean);

    setIsRegenerating(true);
    showNotification('🧠 AI is drafting your weekly plan...');

    try {
      // Build 7-day lookback for pattern engine
      const historyMap = {};
      for (let i = 0; i < 7; i++) {
        const d = shiftDateKey(selectedDateKey, -i);
        if (mealHistory[d]) historyMap[d] = mealHistory[d];
        else if (mealPlans[d]) historyMap[d] = mealPlans[d];
      }

      const { generateWeeklyPlan } = await import('./lib/geminiService.js');
      const generatedDays = await generateWeeklyPlan({
        targetDateKeys,
        mealDatabase: mergedMealDatabase,
        preferences: normalizePreferences(preferences),
        historyMap,
        dailyProteinTarget: onboardingProfile?.goal?.dailyProteinTarget || 120
      });

      const nextPlans = { ...mealPlans };

      // Re-hydrate the canonical string names from the AI back into full meal objects
      const catalog = [
        ...(mergedMealDatabase.breakfast || []),
        ...(mergedMealDatabase.lunch || []),
        ...(mergedMealDatabase.dinner || []),
        ...(mergedMealDatabase.snack || [])
      ];
      const findMeal = (name) => catalog.find(m => m.canonical_name === name) || null;

      for (const day of generatedDays) {
        if (!day.dateKey) continue;
        nextPlans[day.dateKey] = {
          ...nextPlans[day.dateKey],
          breakfast: findMeal(day.breakfast) || nextPlans[day.dateKey]?.breakfast,
          lunch: findMeal(day.lunch) || nextPlans[day.dateKey]?.lunch,
          dinner: findMeal(day.dinner) || nextPlans[day.dateKey]?.dinner
        };
      }

      setMealPlans(nextPlans);
      saveToStorage('meal-plans', nextPlans);
      appendMealEvent({
        type: 'regen',
        dateKey: selectedDateKey,
        mealType: 'week',
        regeneratedDays: generatedDays.length,
        keptLockedDays,
        contextMeals: Array.from(new Set(chosenMealNames))
      });

      showNotification(`✓ AI Regenerated ${generatedDays.length} day(s)${keptLockedDays > 0 ? `, kept ${keptLockedDays} locked` : ''}`);
    } catch (err) {
      console.error(err);
      showNotification('❌ AI Generation failed. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
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

  if (!onboardingProfile || showOnboardingEditor) {
    return (
      <OnboardingFlow
        initialDraft={onboardingDraft}
        isEditing={Boolean(onboardingProfile && showOnboardingEditor)}
        onCancel={onboardingProfile && showOnboardingEditor ? () => setShowOnboardingEditor(false) : undefined}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        {notification && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-pulse">{notification}</div>
        )}

        {showDiningOutModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowDiningOutModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Select Meal Slot</h3>
                <button onClick={() => setShowDiningOutModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">Which meal are you dining out for?</p>
              <div className="grid gap-3">
                {['breakfast', 'lunch', 'dinner'].map((slot) => (
                  <button
                    key={slot}
                    onClick={() => {
                      handleDiningOut(slot);
                      setShowDiningOutModal(false);
                    }}
                    className="w-full bg-indigo-50 text-indigo-700 py-3 rounded-lg font-semibold hover:bg-indigo-100 transition-colors capitalize"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {showOmniboxSlotModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowOmniboxSlotModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Select Meal Slot</h3>
                <button onClick={() => setShowOmniboxSlotModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">Which meal are you logging?</p>
              <div className="grid gap-3">
                {['breakfast', 'lunch', 'dinner', 'snack'].map((slot) => (
                  <button
                    key={slot}
                    onClick={() => handleOmniboxSlotSelection(slot)}
                    className="w-full bg-emerald-50 text-emerald-700 py-3 rounded-lg font-semibold hover:bg-emerald-100 transition-colors capitalize border border-emerald-200"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}





        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold text-gray-800">🍽️ My MealMap</h1>
            <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold shrink-0">
              Goal: {getOnboardingGoalLabel(onboardingProfile?.goal)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-600 bg-gray-100 px-3 py-1 rounded-full">{formatWeekSnapshotDateLabel(selectedDateKey)}</span>
              {isViewerMode && (
                <span className="text-[11px] px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">Read-only</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={copyTodaysPlan} className="text-xs px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold whitespace-nowrap">
                📋 Share Day
              </button>
              <button
                onClick={undoSkippedForSelectedDay}
                className="text-[11px] px-2 py-1 bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200 font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
              >
                Undo
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          {selectedMealTypeOrder.map((mealType, index) => {
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
              <div key={mealType} className={`pb-3 ${index === selectedMealTypeOrder.length - 1 ? 'mb-2' : 'mb-3 border-b border-gray-200'} ${isSkipped ? 'opacity-70 bg-gray-50 rounded-lg p-3 border-transparent' : ''}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-gray-600">{mealTypeLabels[mealType]}:</span>
                    <span className={`ml-2 text-gray-800 ${isSkipped ? 'line-through text-gray-400' : ''}`}>{formatMealName(meal)}</span>
                    {meal.orderOut && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">D.O.</span>}
                    {isConfirmed && <Check className="inline ml-2 text-green-500" size={16} />}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2 overflow-x-auto hide-scrollbar shrink-0">
                  <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded whitespace-nowrap">P: {meal.protein}g</span>
                  <button onClick={() => toggleExpand(mealType)} className="text-xs text-blue-600 flex items-center gap-0.5 hover:text-blue-800 whitespace-nowrap">
                    Details {expandedMeals[mealType] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    onClick={() => handleSkip(mealType)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors whitespace-nowrap disabled:cursor-not-allowed ${isSkipped
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      }`}
                    disabled={isViewerMode || isSkipped}
                  >
                    {isSkipped ? '⊘ Skipped' : 'Skip Meal'}
                  </button>
                  <button
                    onClick={() => handleEditClick(mealType)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors whitespace-nowrap flex items-center disabled:cursor-not-allowed ${isSkipped
                      ? 'bg-gray-100 text-gray-400'
                      : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      }`}
                    disabled={isViewerMode || isSkipped}
                  >
                    <Edit3 className="inline mr-1" size={12} />
                    Edit
                  </button>
                </div>
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

          <div className="mb-3 border-t-2 border-gray-200 pt-3 mt-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-700">⚡ Quick Actions:</p>
              <div className="flex gap-2">
                <button
                  onClick={() => processQuickAction('addsnack')}
                  className="text-xs px-3 py-2 bg-teal-100 text-teal-700 rounded-full hover:bg-teal-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  disabled={isViewerMode}
                >
                  ➕ Snack
                </button>
                <button
                  onClick={() => setShowDiningOutModal(true)}
                  className="text-xs px-3 py-2 bg-purple-100 text-purple-700 rounded-full hover:bg-purple-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  disabled={isViewerMode}
                >
                  🍽️ Dining Out
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                onClick={() => processQuickAction('light')}
                className="text-[11px] px-2 py-1.5 bg-green-100 text-green-700 rounded-full hover:bg-green-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={true}
              >
                🥗 Go Light
              </button>
              <button
                onClick={() => processQuickAction('indian')}
                className="text-[11px] px-2 py-1.5 bg-orange-100 text-orange-700 rounded-full hover:bg-orange-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={true}
              >
                🍛 Indian
              </button>
              <button
                onClick={() => processQuickAction('surprise')}
                className="text-[11px] px-2 py-1.5 bg-pink-100 text-pink-700 rounded-full hover:bg-pink-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={true}
              >
                🎲 Surprise
              </button>
            </div>
          </div>

          <Omnibox
            onAIAction={handleAIAction}
            disabled={isViewerMode}
            activeContext={activeOmniboxContext}
            onClearContext={() => setActiveOmniboxContext(null)}
            onRequestContext={() => setShowOmniboxSlotModal(true)}
            externalInputRef={omniboxRef}
            prefill={omniboxPrefill}
            onClearPrefill={() => setOmniboxPrefill('')}
          />

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

        <div className="flex gap-2 mb-4">
          <button
            onClick={regenerateRestOfWeek}
            className="w-[60%] bg-green-500 text-white py-3 rounded-lg font-semibold hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            disabled={isViewerMode || isRegenerating}
          >
            {isRegenerating ? <Loader2 className="animate-spin" size={18} /> : '♻️'}
            {isRegenerating ? 'Planning Week...' : 'Regen Rest Of Week'}
          </button>
          <button
            onClick={() => setShowOnboardingEditor(true)}
            className="w-[40%] bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
          >
            ⚙️ Edit Prefs
          </button>
        </div>

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
                  className={`rounded p - 2 text - center border ${isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 hover:bg-gray-50'
                    } `}
                >
                  <div className="text-[10px] font-semibold">
                    {parseDateKey(dateKey).toLocaleDateString('en-US', { weekday: 'short', timeZone: IST_TIME_ZONE })}
                  </div>
                  <div className="text-xs">{parseDateKey(dateKey).getUTCDate()}</div>
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
                  <div key={dateKey} className={`border rounded p - 3 ${dateKey === selectedDateKey ? 'border-blue-300 bg-blue-50' : 'border-gray-200'} `}>
                    <div className="flex justify-between items-center mb-2">
                      <button onClick={() => setSelectedDateKey(dateKey)} className="font-semibold text-gray-700 hover:text-blue-700">
                        {formatWeekSnapshotDateLabel(dateKey)}
                      </button>
                      <span className="text-xs text-gray-600">
                        {completion.confirmedCount}/{completion.totalSlots} confirmed
                      </span>
                    </div>
                    <div className="text-xs space-y-1">
                      {getMealTypeOrder(plan, dayData).map((mealType) => {
                        const isSkipped = dayData[mealType]?.skipped;
                        return (
                          <div key={mealType} className="flex justify-between gap-2">
                            <span className={`text-gray-700 truncate ${isSkipped ? 'line-through text-gray-400 opacity-70' : ''}`}>
                              {mealTypeLabels[mealType]}:{' '}
                              {formatMealName(plan[mealType] || dayData[mealType]?.meal || dayData[mealType]?.actual || 'Not set')}
                              {(dayData[mealType]?.orderOut || plan[mealType]?.orderOut) && ' (Dine Out)'}
                            </span>
                            <span className={`${isSkipped ? 'text-gray-400 opacity-60' : 'text-blue-600'} font-semibold`}>{dayData[mealType]?.protein || plan[mealType]?.protein || 0}g</span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-2 pt-2 border-t text-xs text-gray-600">Recorded protein: {completion.protein}g</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div >
  );
};

export default MealPlannerApp;
