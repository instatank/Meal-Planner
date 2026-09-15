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
  inspectMealEvent,
  trimEventLog,
  normalizeMealEvents,
  derivePreferencesFromEvents,
  getUndoTargetsForSlots,
  hasPreferenceSignals,
  getCustomMealOccurrenceCount,
  getCustomMealCandidates
} from './lib/mealEvents';
import {
  buildAttributeIndex,
  learnPreferences,
  toLearnedPreferences
} from './lib/preferenceLearning';
import {
  buildPlanReviewPayload,
  collectWeekDishes,
  toLegacyRejectionRecord
} from './lib/planReview';
import { PLAN_VERDICT } from './lib/feedbackSchema';
import PlanReviewModal from './components/PlanReviewModal';
import InsightsPanel from './components/InsightsPanel';
import MealTieringPanel from './components/MealTieringPanel';
import AddMealPanel from './components/AddMealPanel';
import { normalizeMealTierMap, normalizeMealTier } from './lib/mealTiers';
import {
  buildIngestionPayload,
  buildUserCatalogMeal,
  createMealDraft,
  describeDraftImpact,
  findDuplicateName,
  normalizeMealDraft,
  normalizeMealDraftList
} from './lib/userMeals';
import { estimateMealIngredients } from './lib/mealIngestService';
import { getRulesForProfile as resolveRulesForProfile } from './lib/rules';
import { proposeMealTiers } from './lib/tierProposals';
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

import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './lib/firebase';
import AdminTools from './components/AdminTools';

const MealPlannerMain = ({ user, handleSignOut }) => {
  const IST_TIME_ZONE = 'Asia/Kolkata';
  const ONBOARDING_PROFILE_STORAGE_KEY = 'meal-onboarding-profile';
  const DEFAULT_USER_CATALOG = { breakfast: [], lunchDinner: [], snack: [] };

  const [systemConfig, setSystemConfig] = useState(null);

  useEffect(() => {
    const fetchSystemConfig = async () => {
      try {
        const promptsSnap = await getDoc(doc(db, 'system_config', 'prompts'));
        const ingredientsSnap = await getDoc(doc(db, 'system_config', 'ingredients'));
        const mealsSnap = await getDoc(doc(db, 'system_config', 'meals'));
        
        let config = {};
        if (promptsSnap.exists()) config.prompts = promptsSnap.data().system_instructions;
        if (ingredientsSnap.exists()) config.ingredients = ingredientsSnap.data().data;
        if (mealsSnap.exists()) config.meals = mealsSnap.data().data;
        
        if (Object.keys(config).length > 0) {
          setSystemConfig(config);
        }
      } catch (err) {
        console.warn('Silent fail: using local immutable AI configuration.', err);
      }
    };
    if (user) fetchSystemConfig();
  }, [user]);

  const [expandedMeals, setExpandedMeals] = useState({});
  const [showWeekly, setShowWeekly] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [notification, setNotification] = useState('');
  const [showDiningOutModal, setShowDiningOutModal] = useState(false);
  const [showOmniboxSlotModal, setShowOmniboxSlotModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAutoGeneration, setPendingAutoGeneration] = useState(false);
  const [userMealCatalog, setUserMealCatalog] = useState(DEFAULT_USER_CATALOG);
  const omniboxRef = React.useRef(null);
  // Week-start keys this session has already attempted to auto-generate.
  // Guards against an unbounded retry loop when generation fails — see the
  // auto-generation detector below.
  const autoGenAttemptedRef = React.useRef(new Set());
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

  const activeMealDatabase = systemConfig?.meals || mealDatabase;

  const mergedMealDatabase = useMemo(
    () => ({
      breakfast: mergeMealsUniqueByCanonicalName(activeMealDatabase.breakfast || [], userMealCatalog.breakfast || []),
      lunchDinner: mergeMealsUniqueByCanonicalName(activeMealDatabase.lunchDinner || [], userMealCatalog.lunchDinner || []),
      snack: mergeMealsUniqueByCanonicalName(activeMealDatabase.snack || [], userMealCatalog.snack || [])
    }),
    [userMealCatalog, activeMealDatabase]
  );

  /**
   * Every meal the planner can actually place, for the tiering screen.
   *
   * Breakfast and lunch/dinner only: snacks are not slots the week search
   * fills, so tiering one would be a control that does nothing. Sorted by name
   * because the screen is browsed, not ranked.
   */
  const allPlannableMeals = useMemo(
    () =>
      [...(mergedMealDatabase.breakfast || []), ...(mergedMealDatabase.lunchDinner || [])]
        .filter((meal) => meal?.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mergedMealDatabase]
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

  // We longer use the deterministic fallback generator

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

  /**
   * Days in the currently selected week that are NOT being regenerated. The
   * weekly repetition ceilings and the red-meat cap are counted against the
   * whole week, so a locked day still consumes its share of both.
   */
  const buildLockedWeekDays = (targetDateKeys) => {
    const targets = new Set(targetDateKeys);
    const locked = {};
    for (const key of getWeekDateKeys(selectedDateKey)) {
      if (targets.has(key)) continue;
      const plan = mealPlans[key];
      if (plan?.breakfast || plan?.lunch || plan?.dinner) locked[key] = plan;
    }
    return locked;
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
      // Forwarded, not dropped: without this every day resolves to
      // `getRulesForProfile(undefined)` — i.e. high_protein — so a standard
      // user's days were judged by a 20g per-meal floor and a 130g carb cap
      // while carrying the standard protein target.
      goal: goalOverride,
      dailyProteinTarget: adaptedInput.dailyProteinTarget,
      mealDatabase: mergedMealDatabase
    });
  };

  const normalizePreferences = (prefs = {}) => plannerNormalizePreferences(prefs);

  const todayKey = getDateKey();
  const [selectedDateKey, setSelectedDateKey] = useState(getDateKey());
  const [mealPlans, setMealPlans] = useState({});
  const [mealHistory, setMealHistory] = useState({});
  const [preferences, setPreferences] = useState(() => normalizePreferences({}));
  const [mealEvents, setMealEvents] = useState([]);
  const [onboardingProfile, setOnboardingProfile] = useState(null);
  const [showOnboardingEditor, setShowOnboardingEditor] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showPlanReviewModal, setShowPlanReviewModal] = useState(false);
  const [legacyRejections, setLegacyRejections] = useState([]);
  const [mealTiers, setMealTiers] = useState({});
  const [dismissedTierProposals, setDismissedTierProposals] = useState({});
  // Meals the user typed in but that have no ingredient rollup yet. Held apart
  // from `userMealCatalog` on purpose — see the header of `lib/userMeals.js`:
  // a draft is inert, and the planner must not be able to reach one.
  const [mealDrafts, setMealDrafts] = useState([]);

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



  // A timestamp more than this far in the future is treated as corrupt
  // (legacy poison from an old paste helper that stamped __ts one year
  // ahead). When a source's timestamp is corrupt, its *value* is also
  // considered untrustworthy (it was written at the time of corruption),
  // so we discard that source entirely and heal from the other side.
  const FUTURE_TS_SLACK_MS = 6 * 60 * 60 * 1000; // 6 hours

  const isCorruptTs = (ts) => {
    if (!ts) return false;
    const tsMs = Date.parse(ts);
    return Number.isFinite(tsMs) && tsMs > Date.now() + FUTURE_TS_SLACK_MS;
  };

  const storageGet = async (key) => {
    if (typeof window === 'undefined') return null;

    const nowIso = new Date().toISOString();
    const localValue = safeParseJson(window.localStorage.getItem(key), null);
    const rawLocalTs = window.localStorage.getItem(`${key}__ts`) || null;
    const localCorrupt = isCorruptTs(rawLocalTs);

    if (user) {
      try {
        const docRef = doc(db, 'users', user.uid, 'metrics', key);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const payload = docSnap.data();
          if (payload?.value != null) {
            const rawFirebaseTs = payload.updatedAt || null;
            const firebaseCorrupt = isCorruptTs(rawFirebaseTs);

            // Case A: Firestore timestamp is corrupt. Do NOT trust its value
            // either — it was written at the time of corruption and predates
            // any subsequent legitimate write. Prefer local (if any), push it
            // back with a fresh timestamp to heal Firestore.
            if (firebaseCorrupt && !localCorrupt) {
              console.warn(`[storageGet] Firestore ${key} updatedAt is corrupt (${rawFirebaseTs}) — discarding and healing with local`);
              if (localValue != null) {
                const safeLocal = JSON.parse(JSON.stringify(localValue));
                setDoc(docRef, { value: safeLocal, updatedAt: nowIso }, { merge: true }).catch((e) =>
                  console.warn('[storageGet] heal-with-local push failed:', e)
                );
                return localValue;
              }
              // No local value; reluctantly use Firestore's value but fix the
              // timestamp so we don't re-trip this path forever.
              setDoc(docRef, { updatedAt: nowIso }, { merge: true }).catch((e) =>
                console.warn('[storageGet] Firestore timestamp-only heal failed:', e)
              );
              window.localStorage.setItem(key, JSON.stringify(payload.value));
              window.localStorage.setItem(`${key}__ts`, nowIso);
              return payload.value;
            }

            // Case B: Local timestamp is corrupt. Trust Firestore.
            if (localCorrupt && !firebaseCorrupt) {
              console.warn(`[storageGet] Local ${key} __ts is corrupt (${rawLocalTs}) — accepting Firestore`);
              window.localStorage.setItem(key, JSON.stringify(payload.value));
              window.localStorage.setItem(`${key}__ts`, rawFirebaseTs || nowIso);
              return payload.value;
            }

            // Case C: Both corrupt. Prefer whatever's in local memory (the
            // user's last interaction), normalize both sides.
            if (localCorrupt && firebaseCorrupt) {
              console.warn(`[storageGet] Both local and Firestore ${key} are corrupt — normalizing`);
              const canonical = localValue != null ? localValue : payload.value;
              const safeCanonical = JSON.parse(JSON.stringify(canonical));
              setDoc(docRef, { value: safeCanonical, updatedAt: nowIso }, { merge: true }).catch((e) =>
                console.warn('[storageGet] dual-corrupt heal failed:', e)
              );
              window.localStorage.setItem(key, JSON.stringify(canonical));
              window.localStorage.setItem(`${key}__ts`, nowIso);
              return canonical;
            }

            // Case D: Both timestamps are sane. Use whichever is newer;
            // local wins ties because it's what the user just interacted with.
            const localIsNewer = rawLocalTs && rawFirebaseTs && rawLocalTs >= rawFirebaseTs;
            const localExists = localValue != null;

            if (localIsNewer && localExists) {
              console.info(`[storageGet] Local ${key} is newer (${rawLocalTs} vs ${rawFirebaseTs}) — using local, syncing to Firestore`);
              const safeLocal = JSON.parse(JSON.stringify(localValue));
              setDoc(docRef, { value: safeLocal, updatedAt: rawLocalTs }, { merge: true }).catch((e) =>
                console.warn('[storageGet] Background Firestore re-sync failed:', e)
              );
              return localValue;
            }
            window.localStorage.setItem(key, JSON.stringify(payload.value));
            if (rawFirebaseTs) window.localStorage.setItem(`${key}__ts`, rawFirebaseTs);
            return payload.value;
          }
        } else if (localValue != null) {
          const safeLocalValue = JSON.parse(JSON.stringify(localValue));
          await setDoc(docRef, {
            value: safeLocalValue,
            updatedAt: localCorrupt ? nowIso : (rawLocalTs || nowIso)
          });
          if (localCorrupt) window.localStorage.setItem(`${key}__ts`, nowIso);
        }
      } catch (error) {
        console.warn('Firebase storage read failed; using local fallback for', key, error);
      }
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

    let payloadToSave = data;
    if (key === 'meal-plans' && data && typeof data === 'object') {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 14);
      const cutoffKey = cutoff.toISOString().split('T')[0];
      payloadToSave = {};
      for (const [k, v] of Object.entries(data)) {
        if (k >= cutoffKey) payloadToSave[k] = v;
      }
    } else if (key === 'meal-history' && data && typeof data === 'object') {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 60);
      const cutoffKey = cutoff.toISOString().split('T')[0];
      payloadToSave = {};
      for (const [k, v] of Object.entries(data)) {
        if (k >= cutoffKey) payloadToSave[k] = v;
      }
    }

    const nowIso = new Date().toISOString();

    // Always write to localStorage first with a timestamp for conflict resolution
    try {
      window.localStorage.setItem(key, JSON.stringify(payloadToSave));
      window.localStorage.setItem(`${key}__ts`, nowIso);
    } catch (e) {
      console.warn('LocalStorage limit reached', e);
    }

    if (user) {
      try {
        // Deeply strip any implicit undefined values which instantly crash Firebase setDoc
        const safePayload = JSON.parse(JSON.stringify(payloadToSave));
        const docRef = doc(db, 'users', user.uid, 'metrics', key);
        await setDoc(docRef, {
          value: safePayload,
          updatedAt: nowIso
        }, { merge: true });
        return;
      } catch (err) {
        console.error('Failed pushing to Firebase — local copy preserved:', err);
        // Don't rethrow — local copy is safe, Firebase can sync later
      }
    }

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
        // Read in parallel, not in sequence.
        //
        // Every one of these is a Firestore round trip, and awaiting them one
        // after another made boot latency the sum of ten of them — on a phone,
        // seconds of staring at the spinner. They are wholly independent: each
        // reads a different document under `users/{uid}/metrics/`, and
        // `storageGet`'s heal-on-read writes back only to the key it was given.
        //
        // This was seven sequential reads before the feedback and tier work
        // added three more, so parallelising is also paying back the boot cost
        // those features introduced rather than leaving it on the user.
        //
        // `rejected-plans` is read so the insights panel can show rejections
        // logged before the event log existed. Thin data, but it is the only
        // record of what was disliked back then, and it is never written here.
        const [
          historyResult,
          prefsResult,
          plansResult,
          eventsResult,
          userCatalogResult,
          onboardingResult,
          autoGenResult,
          legacyRejectionsResult,
          tiersResult,
          dismissedResult,
          draftsResult
        ] = await Promise.all([
          storageGet('meal-history'),
          storageGet('meal-preferences'),
          storageGet('meal-plans'),
          storageGet('meal-events'),
          storageGet('meal-user-catalog'),
          storageGet(ONBOARDING_PROFILE_STORAGE_KEY),
          storageGet('last-auto-gen-week'),
          storageGet('rejected-plans'),
          storageGet('meal-tiers'),
          storageGet('meal-tier-dismissals'),
          storageGet('meal-drafts')
        ]);

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
        // Trimmed on the way in as well as on append. `appendMealEvent`
        // enforces the bound for logs that grow here, but a log can also
        // arrive already over it — synced from a device that ran an older
        // build, or grown before the bound existed. Without this the
        // persistence effect below would faithfully write the oversized log
        // straight back out again.
        setMealEvents(trimEventLog(parsedEvents));
        setLegacyRejections(Array.isArray(legacyRejectionsResult) ? legacyRejectionsResult : []);
        setMealTiers(normalizeMealTierMap(safeParseJson(tiersResult, tiersResult) || {}));
        setDismissedTierProposals(safeParseJson(dismissedResult, dismissedResult) || {});
        setMealDrafts(normalizeMealDraftList(safeParseJson(draftsResult, draftsResult) || []));
        setUserMealCatalog(parsedUserCatalog);
        setOnboardingProfile(parsedOnboarding);

        // Do NOT re-save meal-plans on boot: storageGet already mirrors the
        // authoritative source into localStorage. Re-saving here would stamp a
        // fresh `updatedAt` and can eclipse a later CLI push under timestamp
        // conflict resolution (see CLAUDE.md Priority 1).
        void saveToStorage('meal-history', parsedHistory);
        void saveToStorage('meal-preferences', derivedPreferences);
        void saveToStorage('meal-events', parsedEvents);
        void saveToStorage('meal-user-catalog', parsedUserCatalog);
        if (parsedOnboarding) {
          void saveToStorage(ONBOARDING_PROFILE_STORAGE_KEY, parsedOnboarding);
        }

        // Dynamic week tracking replaces local storage boot triggers
      } catch (error) {
        console.log('No stored data', error);
      }
      setLoading(false);
    };

    loadStoredData();
  }, []);

  // Implicit Auto-Confirmation for Past Days
  useEffect(() => {
    if (loading || isViewerMode) return;

    setMealHistory(prevHistory => {
      let historyChanged = false;
      const nextHistory = { ...prevHistory };

      Object.keys(mealPlans).forEach(dateKey => {
        if (dateKey < todayKey) {
          const plan = mealPlans[dateKey];
          if (!plan) return;

          let dayHistoryChanged = false;
          const dayHistory = { ...(nextHistory[dateKey] || {}) };

          ['breakfast', 'lunch', 'dinner', 'snack'].forEach(mealType => {
            if (plan[mealType]) {
              if (!dayHistory[mealType] || (!dayHistory[mealType].confirmed && !dayHistory[mealType].skipped)) {
                dayHistory[mealType] = {
                  meal: plan[mealType].name,
                  protein: plan[mealType].protein,
                  cal: plan[mealType].cal,
                  confirmed: true,
                  autoConfirmed: true
                };
                dayHistoryChanged = true;
              }
            }
          });

          if (dayHistoryChanged) {
            nextHistory[dateKey] = dayHistory;
            historyChanged = true;
          }
        }
      });

      if (historyChanged) {
        saveToStorage('meal-history', nextHistory);
        return nextHistory;
      }
      return prevHistory;
    });
  }, [loading, todayKey, mealPlans, isViewerMode]);

  useEffect(() => {
    if (loading) return;

    const keysToEnsure = Array.from(new Set([selectedDateKey, ...getWeekDateKeys(selectedDateKey)])).sort();
    const nextPlans = { ...mealPlans };
    let changed = false;

    for (const key of keysToEnsure) {
      // Never fabricate fallback plans for today or future dates — those are
      // source-of-truth pushed via the CLI script (see CLAUDE.md Priority 1).
      // Even if the Firebase read lags or returns partial data, the local
      // generator must not overwrite or pre-populate those days.
      if (key >= todayKey) continue;
      const existing = nextPlans[key];
      const hasAnyMeal = existing && (existing.breakfast || existing.lunch || existing.dinner || existing.snack);
      if (!hasAnyMeal) {
        nextPlans[key] = generatePlanForDate(key, nextPlans, preferences);
        changed = true;
      }
    }

    if (changed) {
      setMealPlans(nextPlans);
      saveToStorage('meal-plans', nextPlans);
    }
  }, [selectedDateKey, mealPlans, loading, preferences, mealHistory, mergedMealDatabase, onboardingProfile]);

  /**
   * The attribute index is a pure function of the catalog, so it is built once
   * per catalog rather than on every event append — the effect below would
   * otherwise re-derive ten attributes for all 110 meals on every confirm.
   */
  const attributeIndex = useMemo(() => buildAttributeIndex(mergedMealDatabase), [mergedMealDatabase]);

  const learnedModel = useMemo(
    () => learnPreferences({ events: mealEvents, mealDatabase: mergedMealDatabase, attributeIndex }),
    [mealEvents, mergedMealDatabase, attributeIndex]
  );

  useEffect(() => {
    if (loading) return;

    // Two models, deliberately kept apart. `derivePreferencesFromEvents` is
    // the audited dish-name counter and keeps exactly the behaviour it has;
    // `learned` is the new attribute-level model. Additive rather than
    // replacing, so a regression in one cannot be hidden by the other.
    const legacyPreferences = derivePreferencesFromEvents(mealEvents);
    setPreferences({
      ...legacyPreferences,
      learned: toLearnedPreferences(learnedModel),
      tiers: mealTiers
    });

    void saveToStorage('meal-events', mealEvents);
    // Only the legacy buckets are persisted. The learned model is derived
    // from the event log on every boot, and storing a derived value beside
    // the thing it derives from is how the two drift — the failure mode this
    // codebase has already paid for with hand-typed meal tags and a protein
    // target that lived in seven places.
    void saveToStorage('meal-preferences', legacyPreferences);
  }, [mealEvents, learnedModel, mealTiers, loading]);

  /**
   * Auto-generation detector.
   *
   * Fires only when the viewed week is *entirely* empty and still has days
   * left to plan. That emptiness check is what keeps this compatible with the
   * "plan pushed externally" contract in CLAUDE.md — a week that already has
   * meals in it, from any source, is never touched.
   *
   * `autoGenAttemptedRef` is the important part. Without it a failed
   * generation leaves the week empty, which re-triggers this effect, which
   * runs the generator again — an unbounded retry loop against a paid API.
   * One attempt per week per session; the manual "Regen Week" button remains
   * the way to retry deliberately.
   */
  useEffect(() => {
    if (loading || isViewerMode || !mergedMealDatabase) return;
    if (isRegenerating) return;
    const today = getDateKey(new Date());
    const weekKeys = getWeekDateKeys(selectedDateKey).sort();
    if (weekKeys[6] < today) return;
    if (autoGenAttemptedRef.current.has(weekKeys[0])) return;
    const hasAnyPlan = weekKeys.some(k => mealPlans[k] && Object.keys(mealPlans[k]).length > 0);
    if (!hasAnyPlan) { setPendingAutoGeneration(true); }
  }, [loading, isViewerMode, mergedMealDatabase, selectedDateKey, mealPlans, isRegenerating]);

  // Auto-generation runner. Mirrors the manual "Regen Week" path exactly —
  // same optimizer, same shortlists, same AI call, same protein target — so
  // the two cannot drift apart in what they produce.
  useEffect(() => {
    if (!loading && pendingAutoGeneration && mergedMealDatabase && !isViewerMode) {
      setPendingAutoGeneration(false);

      const today = getDateKey(new Date());
      const selectedWeekKeys = getWeekDateKeys(selectedDateKey).sort();

      // Mark before running, not after: if the generation below throws, this
      // week must not be retried automatically on the next render.
      autoGenAttemptedRef.current.add(selectedWeekKeys[0]);

      const runAutoGeneration = async () => {
        // Target all days in the currently viewed week that are >= today
        const targetDateKeys = selectedWeekKeys
          .filter(k => k >= today)
          .filter(k => !hasLockedHistoryForDate(k, mealHistory));

        if (targetDateKeys.length === 0) return;

        // Use the existing manual regeneration state flag so the UI shows the spinner!
        setIsRegenerating(true);
        showNotification('✨ Generating intelligent meal plan for this week...');

        try {
          const historyMap = {};
          for (let i = 0; i < 7; i++) {
            const d = shiftDateKey(today, -i);
            if (mealHistory[d]) historyMap[d] = mealHistory[d];
            else if (mealPlans[d]) historyMap[d] = mealPlans[d];
          }

          const { preferences: adjustedPrefs, dailyProteinTarget: adjustedProtein } = buildGoalAdjustedPlannerInput({
            goal: onboardingProfile?.goal,
            preferences: normalizePreferences(preferences),
            mealDatabase: mergedMealDatabase
          });

          const { generateWeeklyPlan } = await import('./lib/planService.js');
          const { buildWeekPlan } = await import('./lib/planOptimizer.js');
          const { getRulesForProfile } = await import('./lib/rules.js');

          // Phase 1: deterministic optimizer — enumerate legal days, beam-search
          // a week that respects the Tier-2 budgets, and derive the shortlists
          // the AI picks from.
          const rules = getRulesForProfile(onboardingProfile?.goal, { dailyProteinTarget: adjustedProtein });
          const filterStart = performance.now();
          const reference = buildWeekPlan({
            mealDatabase: mergedMealDatabase,
            rules,
            targetDateKeys,
            historyMap,
            preferences: adjustedPrefs
          });
          const { shortlists, stats } = reference;
          console.info(`[Hybrid] Optimizer completed in ${(performance.now() - filterStart).toFixed(1)}ms`, stats, reference.summary);

          // Phase 2: AI selects from shortlists (cheap, fast)
          const generatedDays = await generateWeeklyPlan({
            targetDateKeys,
            preferences: adjustedPrefs,
            historyMap,
            dailyProteinTarget: adjustedProtein,
            cloudConfig: systemConfig,
            goal: onboardingProfile?.goal,
            rules,
            shortlists
          });

          // Phase 3: validate and deterministically repair, exactly as the
          // manual regen does. This path used to write the AI's answer
          // straight to storage with no validation at all — every week-level
          // rule (repeat caps, red meat, duplicate days) was advisory here,
          // which is why bad weeks kept reaching the user.
          const { validateAndRepairWeek, formatViolations } = await import('./lib/planValidator.js');
          const checked = validateAndRepairWeek({
            days: generatedDays,
            mealDatabase: mergedMealDatabase,
            rules,
            preferences: adjustedPrefs,
            historyMap,
            lockedDays: buildLockedWeekDays(targetDateKeys)
          });

          if (checked.resolutionViolations.length > 0) {
            console.warn('[AutoGen] AI returned meal names outside the shortlist:', checked.resolutionViolations);
          }
          if (checked.repaired) {
            console.warn(`[AutoGen] Repaired the generated week (${checked.strategy}):\n${formatViolations(checked.validation.violations)}`);
          }
          console.info('[AutoGen] Week summary:', checked.validation.summary);

          const nextPlans = { ...mealPlans };
          for (const day of checked.days) {
            if (!day.dateKey) continue;
            nextPlans[day.dateKey] = {
              ...nextPlans[day.dateKey],
              breakfast: day.breakfast || nextPlans[day.dateKey]?.breakfast,
              lunch: day.lunch || nextPlans[day.dateKey]?.lunch,
              dinner: day.dinner || nextPlans[day.dateKey]?.dinner
            };
          }

          setMealPlans(nextPlans);
          // Awaited deliberately — CLAUDE.md sync invariant 3. Showing success
          // before the Firestore write lands lets a fast refresh beat it.
          await saveToStorage('meal-plans', nextPlans);
          showNotification(`✓ Successfully auto-generated plan for the week!`);
        } catch (error) {
          console.error("Auto-generation failed", error);
          showNotification('❌ Auto-generation failed. Please try "Regen Week" manually.');
        } finally {
          setIsRegenerating(false);
        }
      };

      runAutoGeneration();
    }
  }, [loading, pendingAutoGeneration, mergedMealDatabase, isViewerMode, mealHistory, mealPlans, preferences, onboardingProfile, selectedDateKey]);

  const selectedDayPlan = mealPlans[selectedDateKey] || {};
  const selectedDayHistory = mealHistory[selectedDateKey] || {};
  const customCandidates = useMemo(
    () => getCustomMealCandidates(mealEvents, allExistingMealNames, { lookbackDays: 45, minCount: 3 }),
    [mealEvents, allExistingMealNames]
  );

  const updateSelectedPlan = (updater) => {
    setMealPlans((prev) => {
      const currentPlan = prev[selectedDateKey] || {};
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

    // Advisory, never blocking: a misshapen event is still recorded, because
    // losing a signal is worse than storing one oddly. But it is no longer
    // silent — a producer that drops a field now says so in the console
    // instead of being discovered months later as an empty preference map.
    const inspection = inspectMealEvent(event);
    if (!inspection.valid) {
      console.warn(`[mealEvents] "${event.type}" event does not match its schema:`, inspection.issues, event);
    }

    setMealEvents((prev) => trimEventLog([...prev, event]));
    return event;
  };


  // ─── Meal tiers ───────────────────────────────────────────────────────────
  //
  // Persisted separately from `meal-preferences` because a tier is something
  // the user *said*, not something derived from the log. The learned model is
  // rebuilt from events on every boot and never stored; this is the opposite
  // and must survive.

  const updateMealTier = async (mealName, patch) => {
    if (!requireWriteAccess('Tiering meals')) return;
    const existing = mealTiers[mealName] || {};
    const next = {
      ...mealTiers,
      [mealName]: normalizeMealTier({
        ...existing,
        ...patch,
        // Stamped on every edit so `proposeMealTiers` can tell a decision you
        // just made from one you made months ago, and stop arguing with the
        // former.
        updatedAt: new Date().toISOString()
      })
    };
    setMealTiers(next);
    await saveToStorage('meal-tiers', next);
  };

  const handleSetTier = (mealName, tier) => updateMealTier(mealName, { tier });
  const handleSetRating = (mealName, rating) => updateMealTier(mealName, { rating });

  const handleAcceptTierProposal = async (proposal) => {
    await updateMealTier(proposal.mealName, { tier: proposal.proposedTier });
    showNotification(`\u2713 ${proposal.mealName} is now ${proposal.proposedTier}`);
  };

  const handleDismissTierProposal = async (proposal) => {
    // Dismissal is recorded against the *proposed* tier, not the dish. If
    // behaviour later points somewhere else, that is a new suggestion and
    // deserves to be asked again.
    const key = `${proposal.mealName}::${proposal.proposedTier}`;
    const next = { ...dismissedTierProposals, [key]: new Date().toISOString() };
    setDismissedTierProposals(next);
    await saveToStorage('meal-tier-dismissals', next);
  };

  /**
   * The daily protein target, for the tiering screen's "is this staple big
   * enough?" hint.
   *
   * Wrapped because `getRulesForProfile` throws `UnsupportedGoalError` for
   * goals onboarding declares but nobody built. That is correct behaviour in
   * the planner — better than silently planning a vegetarian a week of chicken
   * — but a display hint is not worth taking the whole screen down for.
   */
  const plannerDailyProteinTarget = useMemo(() => {
    try {
      return resolveRulesForProfile(onboardingProfile?.goal).dailyProteinTarget;
    } catch {
      return 120;
    }
  }, [onboardingProfile]);

  const tierProposals = useMemo(() => {
    const result = proposeMealTiers({
      events: mealEvents,
      tierMap: mealTiers,
      mealNames: allExistingMealNames,
      nowMs: Date.now()
    });
    return {
      ...result,
      proposals: result.proposals.filter(
        (p) => !dismissedTierProposals[`${p.mealName}::${p.proposedTier}`]
      )
    };
  }, [mealEvents, mealTiers, allExistingMealNames, dismissedTierProposals]);

  // ─── Meals the user adds ──────────────────────────────────────────────────
  //
  // Two stores, on purpose. A draft goes to `meal-drafts` and is invisible to
  // the planner; an approved meal goes to `meal-user-catalog`, which
  // `mergedMealDatabase` already merges and which `buildPromotedCustomMeal`
  // already writes to. Approval is the only door between them, and it is shut
  // unless the dish has `parts[]` that roll up to real macros — because the
  // optimizer enforces a 20g per-meal floor and a 714g weekly floor against
  // exactly these numbers, and a meal that reports protein it does not have
  // produces a week that says it hit the target and did not.

  const persistMealDrafts = async (next) => {
    setMealDrafts(next);
    await saveToStorage('meal-drafts', next);
  };

  /**
   * What a draft would become if approved — the meal, why not, and what is
   * worth knowing before saying yes.
   *
   * Computed for display rather than stored, so it cannot go stale against an
   * edited quantity. Cheap enough to run per render: it is one `computeMacros`
   * over a handful of parts.
   */
  const previewMealDraft = (draft) => {
    const { meal, reason, dropped } = buildUserCatalogMeal(draft);
    let rules = null;
    try {
      rules = resolveRulesForProfile(onboardingProfile?.goal);
    } catch {
      // An unimplemented goal throws by design. The preview degrades to "no
      // rule-based warnings" rather than taking the screen down — the same
      // call this file already wraps for the tiering hint.
      rules = null;
    }
    return {
      meal,
      reason,
      dropped,
      warnings: describeDraftImpact(meal, draft.slot, rules)
    };
  };

  const handleAddMealDraft = async (input) => {
    if (!requireWriteAccess('Adding meals')) return { error: 'Viewer mode.' };

    const duplicate = findDuplicateName(input.name, {
      existingNames: allExistingMealNames,
      drafts: mealDrafts
    });
    if (duplicate) {
      return {
        error: duplicate.kind === 'catalog'
          ? `You already have "${duplicate.name}" in your meals.`
          : `"${duplicate.name}" is already waiting in the queue.`
      };
    }

    const draft = createMealDraft(input);
    await persistMealDrafts([draft, ...mealDrafts]);
    showNotification(`✓ Added "${draft.name}" to the queue`);
    return { draft };
  };

  const handleUpdateMealDraft = async (draftId, patch) => {
    if (!requireWriteAccess('Editing meals')) return;
    const next = mealDrafts.map((draft) =>
      draft.id === draftId
        ? normalizeMealDraft({ ...draft, ...patch, updatedAt: new Date().toISOString() })
        : draft
    );
    await persistMealDrafts(next);
  };

  /**
   * Ask the estimator to express the dish in known ingredients.
   *
   * An empty `parts` result is not an error and is not treated as one: it is
   * the model declining to guess at a dish it does not know, which is the
   * behaviour the prompt asks for. It lands as `unresolved`, which is a real
   * state with its own copy on screen and its own place in the export.
   */
  const handleEstimateMealDraft = async (draft) => {
    if (!requireWriteAccess('Adding meals')) return { error: 'Viewer mode.' };

    try {
      const result = await estimateMealIngredients({
        name: draft.name,
        slot: draft.slot,
        note: draft.note
      });

      await handleUpdateMealDraft(draft.id, {
        parts: result.parts,
        // A cuisine the user picked outranks the estimator's guess: the
        // estimator is inferring from a name, the user knows what they ate.
        cuisine: draft.cuisine && draft.cuisine !== 'general' ? draft.cuisine : (result.cuisine || draft.cuisine),
        unmatched: result.unmatched,
        estimateNote: result.notes,
        confidence: result.confidence,
        estimateSource: 'ai'
      });

      if (!result.parts.length) {
        showNotification('⚠️ Could not build that from known ingredients');
      }
      return { ok: true };
    } catch (error) {
      console.error('[App] meal estimate failed:', error);
      return { error: error?.message || 'Could not work out the ingredients.' };
    }
  };

  const handleApproveMealDraft = async (draft) => {
    if (!requireWriteAccess('Adding meals')) return;

    const { meal, reason } = buildUserCatalogMeal(draft);
    if (!meal) {
      showNotification(`⚠️ ${reason}`);
      return;
    }

    // Re-checked at approval, not only at add: the catalog can have grown
    // (another device, a promoted custom meal) while this draft sat in the
    // queue, and two records for one dish means two independent weekly caps.
    const duplicate = findDuplicateName(meal.name, { existingNames: allExistingMealNames });
    if (duplicate) {
      showNotification(`⚠️ "${duplicate.name}" is already in your meals`);
      await persistMealDrafts(mealDrafts.filter((d) => d.id !== draft.id));
      return;
    }

    const nextCatalog = normalizeUserMealCatalog({
      ...userMealCatalog,
      [draft.slot]: [...(userMealCatalog[draft.slot] || []), meal]
    });

    setUserMealCatalog(nextCatalog);
    await saveToStorage('meal-user-catalog', nextCatalog);
    await persistMealDrafts(mealDrafts.filter((d) => d.id !== draft.id));

    // The frequency the user chose when adding, applied now that the dish
    // exists to apply it to. Skipped when they said nothing — an untouched
    // tier map is what keeps the planner bit-identical for anyone who has no
    // opinion, and writing a default `occasional` entry for every added meal
    // would quietly end that guarantee.
    if (draft.tier) {
      await updateMealTier(meal.name, { tier: draft.tier });
    }

    appendMealEvent({
      type: 'meal_added',
      dateKey: selectedDateKey,
      mealType: draft.slot,
      mealName: meal.name,
      cuisine: meal.cuisine,
      source: draft.estimateSource || 'manual'
    });

    showNotification(`✓ ${meal.name} is now in your rotation`);
  };

  const handleDiscardMealDraft = async (draftId) => {
    if (!requireWriteAccess('Editing meals')) return;
    await persistMealDrafts(mealDrafts.filter((d) => d.id !== draftId));
  };

  /**
   * Remove a meal the user added.
   *
   * Only ever removes `isUserAdded` entries. A name collision with a shipped
   * dish would otherwise delete the shipped one from the merged view, which
   * the user cannot undo from this screen.
   */
  const handleRemoveUserMeal = async (mealName) => {
    if (!requireWriteAccess('Editing meals')) return;
    const nextCatalog = normalizeUserMealCatalog(
      Object.fromEntries(
        Object.entries(userMealCatalog).map(([slot, meals]) => [
          slot,
          (meals || []).filter((meal) => !(meal?.isUserAdded && meal.name === mealName))
        ])
      )
    );
    setUserMealCatalog(nextCatalog);
    await saveToStorage('meal-user-catalog', nextCatalog);
    showNotification(`✓ Removed ${mealName}`);
  };

  const userAddedMeals = useMemo(
    () =>
      Object.values(userMealCatalog)
        .flat()
        .filter((meal) => meal?.isUserAdded)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [userMealCatalog]
  );

  /**
   * Hand the whole lot over to the repo.
   *
   * Clipboard rather than a file download, and JSON rather than a script,
   * because the founder works entirely in the browser and in chat sessions —
   * the same constraint that made `generateConsolePaste.mjs` the preferred
   * push path over the admin SDK. `scripts/ingestUserMeals.mjs` reads exactly
   * what this writes.
   */
  const handleExportUserMeals = async () => {
    const payload = buildIngestionPayload({
      drafts: mealDrafts,
      userCatalog: userMealCatalog,
      tierMap: mealTiers
    });
    const json = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(json);
      showNotification(`📋 Copied ${payload.approved.length + payload.drafts.length} meals`);
    } catch {
      // Clipboard access is denied on insecure origins and in some in-app
      // browsers. Falling back to the console beats a button that silently
      // does nothing.
      console.log('[userMeals] export payload:\n', json);
      showNotification('⚠️ Clipboard blocked — payload logged to the console');
    }
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

    // The meal this action displaces, read before updateSelectedPlan replaces
    // it. Recorded on the event only — nothing consumes it yet. The preference
    // rule that wanted this ("avoid what the custom meal replaced") asked for
    // `originalMealName`, which no producer ever wrote, so the signal was dead
    // and pointing it at `mealName` would have penalised the meal the user just
    // chose to eat. See docs/CONSISTENCY_AUDIT.md finding #6.
    const previousMealName = selectedDayPlan[targetSlot]?.name || '';

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
          mealName: mealData.name,
          previousMealName,
          // The user's own words, not the model's normalized label. This is
          // the field `getCustomMealCandidates` groups on, and no producer
          // wrote it until now — which is the whole mechanical reason the
          // promotion path has always found zero candidates
          // (docs/CONSISTENCY_AUDIT.md finding #6).
          customMealText: payload.rawText || '',
          source: 'db_match',
          protein: mealData.protein ?? 0,
          cal: mealData.cal ?? 0,
          macros: mealData.macros || null
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
          mealName: payload.data.name,
          previousMealName,
          // The user's own words, not the model's normalized label. This is
          // the field `getCustomMealCandidates` groups on, and no producer
          // wrote it until now — which is the whole mechanical reason the
          // promotion path has always found zero candidates
          // (docs/CONSISTENCY_AUDIT.md finding #6).
          customMealText: payload.rawText || '',
          source: 'custom_parts',
          protein: computed.protein ?? 0,
          cal: computed.cal ?? 0,
          macros: computed.macros || null
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
          mealName: payload.data.name,
          previousMealName,
          // The user's own words, not the model's normalized label. This is
          // the field `getCustomMealCandidates` groups on, and no producer
          // wrote it until now — which is the whole mechanical reason the
          // promotion path has always found zero candidates
          // (docs/CONSISTENCY_AUDIT.md finding #6).
          customMealText: payload.rawText || '',
          source: 'ai_estimate',
          protein: payload.data.estimatedProtein || 0,
          cal: payload.data.estimatedCalories || 0,
          macros: {
            p: payload.data.estimatedProtein || 0,
            c: payload.data.estimatedCarbs || 0,
            f: payload.data.estimatedFats || 0
          }
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
          mealName: payload.data.name,
          previousMealName,
          // The user's own words, not the model's normalized label. This is
          // the field `getCustomMealCandidates` groups on, and no producer
          // wrote it until now — which is the whole mechanical reason the
          // promotion path has always found zero candidates
          // (docs/CONSISTENCY_AUDIT.md finding #6).
          customMealText: payload.rawText || '',
          source: 'dining_out',
          protein: payload.data.estimatedProtein || 0,
          cal: payload.data.estimatedCalories || 0,
          macros: {
            p: payload.data.estimatedProtein || 0,
            c: payload.data.estimatedCarbs || 0,
            f: payload.data.estimatedFats || 0
          }
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

  /**
   * Turn a repeatedly-logged custom meal into a catalog entry — using the
   * macros it actually had.
   *
   * This function used to assign every promoted lunch/dinner a flat
   * `{p: 24, c: 42, f: 14}` regardless of what the dish was. That was safe
   * only because it was unreachable: `getCustomMealCandidates` groups on
   * `customMealText`, no producer wrote that field, so the candidate list was
   * always empty and the button that calls this never rendered. CLAUDE.md
   * records the hazard and the order to fix it in: "Fix the macros before
   * switching it on."
   *
   * Closing the capture gap switched it on. So the macros are fixed here, in
   * the same change: a candidate now carries the median protein, calories,
   * carbs and fat across every time it was logged, and this uses them.
   *
   * When there are no usable numbers it returns `null` and the caller
   * refuses. Declining to promote is strictly better than promoting a
   * fiction — the optimizer trusts catalog macros completely, so an invented
   * 24g of protein is not a harmless placeholder, it is a meal that can be
   * planned to satisfy a protein floor it does not meet.
   */
  const buildPromotedCustomMeal = (candidate, targetMealType) => {
    const canonicalName = String(candidate?.displayName || '').trim();
    if (!canonicalName) return null;

    const observed = candidate?.observedMacros;
    if (!observed || !(observed.protein > 0 || observed.cal > 0)) return null;

    const label = canonicalName.length > 44 ? `${canonicalName.slice(0, 43)}…` : canonicalName;
    const idSuffix = slugifyMealId(canonicalName);

    return {
      meal_id: `user_${targetMealType}_${idSuffix}`,
      canonical_name: canonicalName,
      display_name: label,
      nutrition_source: `Median of ${observed.sampleSize} logged instances`,
      assumption_version: 'user_promoted_v2_observed',
      name: canonicalName,
      protein: observed.protein,
      cal: observed.cal,
      macros: { p: observed.protein, c: observed.carbs, f: observed.fat },
      cuisine: 'custom',
      isUserAdded: true,
      // Flagged so a later pass can tell a measured catalog meal from one
      // derived by observation. The numbers are real, but they are a median of
      // what the user logged, not an ingredient rollup.
      macrosFromObservation: true
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

    const promotedMeal = buildPromotedCustomMeal(candidate, targetMealType);
    if (!promotedMeal) {
      showNotification('⚠️ Not enough macro data logged for this meal yet');
      return;
    }

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

    // Read the plan before writing history. A skip is the user telling us they
    // will not eat a specific dish, and until now we recorded only the date
    // and the slot — the single largest hole in the capture surface. The name
    // is what makes a skip learnable at all.
    const skippedMeal = selectedDayPlan[mealType] || null;

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
      mealType,
      mealName: skippedMeal?.name || '',
      protein: skippedMeal?.protein ?? 0,
      cal: skippedMeal?.cal ?? 0
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

    // Read before the update, so the event records what the order-out replaced.
    const replacedMealName = selectedDayPlan[currentModalMealType]?.name || '';

    updateSelectedPlan((prev) => ({ ...prev, [currentModalMealType]: newMeal }));

    // The `edit` event type has had consumer weights since the event log was
    // written and no producer at all, so `preferences.edits` was permanently
    // empty. This is the flow it describes: the user names a specific
    // replacement for a specific planned meal. Recorded as data only — the
    // weights that read it have been removed pending enough data to validate
    // an interpretation. See docs/CONSISTENCY_AUDIT.md finding #6.
    appendMealEvent({
      type: 'edit',
      dateKey: selectedDateKey,
      mealType: currentModalMealType,
      originalMealName: replacedMealName,
      updatedMealName: newMeal.name
    });

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

  const handleConfirm = (mealType) => {
    if (isViewerMode) return;
    const plan = mealPlans[selectedDateKey]?.[mealType] || {};
    const newEntry = {
      meal: plan.name,
      protein: plan.protein,
      cal: plan.cal,
      confirmed: true
    };

    const updatedHistory = {
      ...mealHistory,
      [selectedDateKey]: {
        ...(mealHistory[selectedDateKey] || {}),
        [mealType]: newEntry
      }
    };
    setMealHistory(updatedHistory);
    saveToStorage('meal-history', updatedHistory);

    appendMealEvent({
      type: 'confirm',
      dateKey: selectedDateKey,
      mealType,
      mealName: plan.name,
      protein: plan.protein
    });

    showNotification(`✅ Confirmed ${mealTypeLabels[mealType]}`);
  };

  const getTotalProtein = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return Math.round(mealTypes.reduce((sum, mealType) => {
      if (selectedDayHistory[mealType]?.skipped) return sum;
      if (selectedDateKey <= todayKey && !selectedDayHistory[mealType]?.confirmed) return sum;
      return sum + (selectedDayHistory[mealType]?.protein || selectedDayPlan[mealType]?.protein || 0);
    }, 0));
  };

  const getTotalCalories = () => {
    const mealTypes = getMealTypeOrder(selectedDayPlan, selectedDayHistory);
    return Math.round(mealTypes.reduce((sum, mealType) => {
      if (selectedDayHistory[mealType]?.skipped) return sum;
      if (selectedDateKey <= todayKey && !selectedDayHistory[mealType]?.confirmed) return sum;
      return sum + (selectedDayHistory[mealType]?.cal || selectedDayPlan[mealType]?.cal || 0);
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
        if (day <= todayKey && !dayData[mealType]?.confirmed) return sum;
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

    const confirmedCount = mealTypesForDay.filter((m) => dayData[m]?.confirmed).length;

    const protein = Math.round(mealTypesForDay.reduce((sum, mealType) => {
      if (dayData[mealType]?.skipped) return sum;
      if (dateKey <= todayKey && !dayData[mealType]?.confirmed) return sum;
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
      const historyMap = {};
      for (let i = 0; i < 7; i++) {
        const d = shiftDateKey(selectedDateKey, -i);
        if (mealHistory[d]) historyMap[d] = mealHistory[d];
        else if (mealPlans[d]) historyMap[d] = mealPlans[d];
      }

      const { preferences: adjustedPrefs, dailyProteinTarget: adjustedProtein } = buildGoalAdjustedPlannerInput({
        goal: onboardingProfile?.goal,
        preferences: normalizePreferences(preferences),
        mealDatabase: mergedMealDatabase
      });

      const { generateWeeklyPlan } = await import('./lib/planService.js');
      const { buildWeekPlan } = await import('./lib/planOptimizer.js');
      const { getRulesForProfile } = await import('./lib/rules.js');

      // Phase 1: deterministic optimizer — enumerate legal days, beam-search a
      // week that respects the Tier-2 budgets, and derive the shortlists the AI
      // picks from. The reference week is also the repair target if the AI's
      // selection fails validation.
      const rules = getRulesForProfile(onboardingProfile?.goal, { dailyProteinTarget: adjustedProtein });
      const filterStart = performance.now();
      const reference = buildWeekPlan({
        mealDatabase: mergedMealDatabase,
        rules,
        targetDateKeys,
        historyMap,
        preferences: adjustedPrefs
      });
      const { shortlists, stats } = reference;
      console.info(`[Hybrid] Optimizer completed in ${(performance.now() - filterStart).toFixed(1)}ms`, stats, reference.summary);

      // Phase 2: AI selects from shortlists (cheap, fast)
      const generatedDays = await generateWeeklyPlan({
        targetDateKeys,
        preferences: adjustedPrefs,
        historyMap,
        dailyProteinTarget: adjustedProtein,
        cloudConfig: systemConfig,
        goal: onboardingProfile?.goal,
        rules,
        shortlists
      });

      // Phase 3: validate what came back, and repair it deterministically if
      // it breaks the rules. Nothing invalid is written silently.
      const { validateAndRepairWeek, formatViolations } = await import('./lib/planValidator.js');
      const checked = validateAndRepairWeek({
        days: generatedDays,
        mealDatabase: mergedMealDatabase,
        rules,
        preferences: adjustedPrefs,
        historyMap,
        lockedDays: buildLockedWeekDays(targetDateKeys)
      });

      if (checked.resolutionViolations.length > 0) {
        console.warn('[Hybrid] AI returned meal names outside the shortlist:', checked.resolutionViolations);
      }
      if (checked.repaired) {
        console.warn(`[Hybrid] Repaired the generated week (${checked.strategy}):\n${formatViolations(checked.validation.violations)}`);
      }
      console.info('[Hybrid] Week summary:', checked.validation.summary);

      const nextPlans = { ...mealPlans };
      for (const day of checked.days) {
        if (!day.dateKey) continue;
        nextPlans[day.dateKey] = {
          ...nextPlans[day.dateKey],
          breakfast: day.breakfast || nextPlans[day.dateKey]?.breakfast,
          lunch: day.lunch || nextPlans[day.dateKey]?.lunch,
          dinner: day.dinner || nextPlans[day.dateKey]?.dinner
        };
      }

      setMealPlans(nextPlans);
      // Await the Firestore write so we don't tell the user "success" until
      // the data is actually persisted. Without this, a fast refresh could
      // race the setDoc and the regen would disappear.
      await saveToStorage('meal-plans', nextPlans);
      appendMealEvent({
        type: 'regen',
        dateKey: selectedDateKey,
        mealType: 'week',
        regeneratedDays: checked.days.length,
        keptLockedDays,
        repaired: checked.repaired,
        violationCodes: checked.validation.violations.map((v) => v.code),
        contextMeals: Array.from(new Set(chosenMealNames))
      });

      const weekSummary = checked.validation.summary;
      if (!checked.validation.valid) {
        // Surfaced, not swallowed: the catalog could not satisfy the rules.
        console.error('[Hybrid] Week still violates the rules after repair:', checked.validation.violations);
        showNotification(`\u26a0\ufe0f Regenerated ${checked.days.length} day(s) \u2014 ${checked.validation.violations.length} rule issue(s) remain, see console`);
      } else {
        showNotification(
          `\u2713 Regenerated ${checked.days.length} day(s) \u2014 ${weekSummary.totalProtein}g protein `
          + `(${weekSummary.proteinPctOfNominal}% of target), ${weekSummary.daysProteinInBand}/${weekSummary.dayCount} days in band`
          + `${keptLockedDays > 0 ? `, kept ${keptLockedDays} locked` : ''}`
        );
      }
    } catch (err) {
      console.error(err);
      showNotification('❌ AI Generation failed. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };
  /**
   * Week review — accept, reject, rate, and say why.
   *
   * This replaced a `window.prompt` that captured one line of free text and
   * appended it to `rejected-plans`, an array whose only reader is a CLI
   * script needing Firebase Admin credentials. In a browser-only workflow
   * that is not a reader, so the single most valuable subjective signal in
   * the app was write-only.
   *
   * The review now lands in the event log alongside every other signal, which
   * is what lets the learner read a stated complaint ("too much roti") and an
   * observed behaviour (three roti lunches swapped away) as evidence about the
   * same thing. `rejected-plans` is still written on a rejection so
   * `scripts/scorePlan.mjs` and the export path keep working unchanged.
   */
  const openWeekReview = () => {
    if (!requireWriteAccess('Reviewing plans')) return;
    setShowPlanReviewModal(true);
  };

  const submitWeekReview = async (draft) => {
    setShowPlanReviewModal(false);

    const payload = buildPlanReviewPayload(draft);
    appendMealEvent(payload);

    if (payload.verdict === PLAN_VERDICT.REJECTED) {
      const plan = {};
      for (const key of payload.dateKeys) {
        if (mealPlans[key]) plan[key] = mealPlans[key];
      }

      const existingRejections = await storageGet('rejected-plans');
      const nextRejections = [
        ...(Array.isArray(existingRejections) ? existingRejections : []),
        toLegacyRejectionRecord({ plan, review: payload })
      ];
      await saveToStorage('rejected-plans', nextRejections);
    }

    const stars = payload.rating ? ` · rated ${payload.rating}/5` : '';
    showNotification(
      payload.verdict === PLAN_VERDICT.ACCEPTED
        ? `\u2705 Week accepted${stars}`
        : `\ud83d\udeab Week rejected${stars}`
    );
  };

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
        {showPlanReviewModal && (
          <PlanReviewModal
            weekStartKey={getWeekDateKeys(selectedDateKey).sort()[0]}
            dateKeys={getWeekDateKeys(selectedDateKey).sort()}
            dishes={collectWeekDishes(mealPlans, getWeekDateKeys(selectedDateKey))}
            onSubmit={submitWeekReview}
            onClose={() => setShowPlanReviewModal(false)}
          />
        )}

        {showCalendarModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowCalendarModal(false)}>
            <div className="bg-white rounded-xl p-5 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">Select Date</h3>
                <button onClick={() => setShowCalendarModal(false)} className="text-gray-500 hover:text-gray-700 bg-gray-100 p-1 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4 bg-gray-50 p-2 rounded-lg justify-between">
                <button
                  onClick={() => setSelectedDateKey((prev) => shiftDateKey(prev, -1))}
                  className="text-xs px-2.5 py-1.5 bg-white shadow-sm border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
                >
                  ◀ Prev
                </button>
                <button
                  onClick={() => { setSelectedDateKey(todayKey); setShowCalendarModal(false); }}
                  className="text-xs px-4 py-1.5 bg-blue-100 text-blue-700 rounded-full font-bold hover:bg-blue-200"
                >
                  Today
                </button>
                <button
                  onClick={() => setSelectedDateKey((prev) => shiftDateKey(prev, 1))}
                  className="text-xs px-2.5 py-1.5 bg-white shadow-sm border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
                >
                  Next ▶
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {weekDateKeys.map((dateKey) => {
                  const isSelected = dateKey === selectedDateKey;
                  const isToday = dateKey === todayKey;
                  return (
                    <button
                      key={dateKey}
                      onClick={() => {
                        setSelectedDateKey(dateKey);
                        setShowCalendarModal(false);
                      }}
                      className={`rounded p-1.5 sm:p-2 text-center border transition-all ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-white border-gray-200 hover:bg-indigo-50 hover:border-indigo-200'
                        }`}
                    >
                      <div className={`text-[9px] font-bold uppercase ${isSelected ? 'text-indigo-100' : 'text-gray-500'}`}>
                        {parseDateKey(dateKey).toLocaleDateString('en-US', { weekday: 'short', timeZone: IST_TIME_ZONE })}
                      </div>
                      <div className={`text-sm sm:text-base font-semibold ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                        {parseDateKey(dateKey).getUTCDate()}
                      </div>
                      {isToday && <div className={`text-[8px] font-bold mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-indigo-600'}`}>TODAY</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}



        <div className="bg-white rounded-lg shadow-md px-5 pt-3 pb-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
            <h1 className="text-2xl font-bold text-gray-800 shrink-0">🍽️ My MealMap</h1>
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold whitespace-nowrap">
                Goal: {getOnboardingGoalLabel(onboardingProfile?.goal)?.split('/')?.[0]?.trim() || getOnboardingGoalLabel(onboardingProfile?.goal)}
              </span>
              <button onClick={handleSignOut} className="hidden sm:inline-flex text-[11px] px-2 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100 font-semibold border border-red-200 transition-colors whitespace-nowrap">
                Sign Out
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-1 sm:gap-3 mb-0 whitespace-nowrap overflow-hidden">
            <button
              onClick={() => setShowCalendarModal(true)}
              className="flex items-center gap-1 text-[11px] sm:text-sm font-semibold text-gray-800 bg-gray-100 hover:bg-gray-200 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-colors border border-gray-200 min-w-0 flex-shrink"
            >
              <span className="truncate">📅 {formatWeekSnapshotDateLabel(selectedDateKey)}</span>
              <ChevronDown size={14} className="text-gray-500 shrink-0" />
            </button>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button onClick={copyTodaysPlan} className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 font-semibold flex items-center gap-1 transition-colors">
                📋 Share
              </button>
              <button
                onClick={undoSkippedForSelectedDay}
                className="text-[9px] sm:text-[11px] px-1.5 sm:px-2 py-1 bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isViewerMode}
              >
                Undo
              </button>
              <button onClick={handleSignOut} className="sm:hidden text-[9px] px-1.5 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100 font-semibold border border-red-200 transition-colors">
                Sign Out
              </button>
            </div>
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
          systemConfig={systemConfig}
        />

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
              <div key={mealType} className={`pb-2 ${index === selectedMealTypeOrder.length - 1 ? 'mb-1' : 'mb-2 border-b border-gray-200'} ${isSkipped ? 'opacity-70 bg-gray-50 rounded-lg p-2 border-transparent' : ''}`}>
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
                  {!isConfirmed && !isSkipped && (
                    <div className="flex gap-4 ml-auto items-center">
                      <button
                        onClick={() => handleConfirm(mealType)}
                        className="text-sm px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center"
                        disabled={isViewerMode}
                        title="Confirm Meal"
                      >
                        ✅
                      </button>
                      <button
                        onClick={() => handleSkip(mealType)}
                        className="text-[10px] px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center justify-center opacity-80"
                        disabled={isViewerMode}
                        title="Skip Meal"
                      >
                        ❌
                      </button>
                    </div>
                  )}
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
          onClick={() => setShowWeekly(!showWeekly)}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold mb-4 hover:bg-indigo-700 transition-colors"
        >
          {showWeekly ? '▲ Hide' : '▼ Show'} This Week's Plan
        </button>

        {showWeekly && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Week Snapshot</h2>
            <p className="text-xs text-gray-600 mb-4 bg-blue-50 p-3 rounded border-l-4 border-blue-400">
              Planned and confirmed meals for the selected week.
            </p>
            <div className="space-y-3">
              {weekDateKeys.map((dateKey) => {
                const plan = mealPlans[dateKey] || {};
                const dayData = mealHistory[dateKey] || {};
                const completion = getDayCompletion(dateKey);
                return (
                  <div key={dateKey} className={`border rounded p - 3 ${dateKey === selectedDateKey ? 'border-blue-300 bg-blue-50' : 'border-gray-200'} `}>
                    <div className="flex justify-between items-center mb-2">
                      <button onClick={() => setSelectedDateKey(dateKey)} className="font-semibold text-blue-600 underline hover:text-blue-800 transition-colors">
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

        <InsightsPanel
          events={mealEvents}
          learned={learnedModel}
          mealDatabase={mergedMealDatabase}
          legacyRejections={legacyRejections}
        />

        <AddMealPanel
          drafts={mealDrafts}
          userMeals={userAddedMeals}
          onAddDraft={handleAddMealDraft}
          onEstimateDraft={handleEstimateMealDraft}
          onUpdateDraft={handleUpdateMealDraft}
          onApproveDraft={handleApproveMealDraft}
          onDiscardDraft={handleDiscardMealDraft}
          onRemoveUserMeal={handleRemoveUserMeal}
          onExport={handleExportUserMeals}
          previewDraft={previewMealDraft}
          disabled={isViewerMode}
        />

        <MealTieringPanel
          meals={allPlannableMeals}
          tierMap={mealTiers}
          proposals={tierProposals}
          dailyProteinTarget={plannerDailyProteinTarget}
          onSetTier={handleSetTier}
          onSetRating={handleSetRating}
          onAcceptProposal={handleAcceptTierProposal}
          onDismissProposal={handleDismissTierProposal}
          disabled={isViewerMode}
        />

        <div className="flex gap-2 mb-4">
          <button
            onClick={regenerateRestOfWeek}
            className="w-[60%] bg-orange-100 text-orange-700 py-3 rounded-lg font-semibold hover:bg-orange-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            disabled={isViewerMode || isRegenerating}
          >
            {isRegenerating ? <Loader2 className="animate-spin" size={18} /> : '♻️'}
            {isRegenerating ? 'Planning Week...' : 'Regen Rest Of Week'}
          </button>
          <button
            onClick={() => setShowOnboardingEditor(true)}
            className="w-[40%] bg-yellow-100 text-yellow-700 py-3 rounded-lg font-semibold hover:bg-yellow-200 transition-colors"
          >
            ⚙️ Edit Prefs
          </button>
        </div>

        <button
          onClick={openWeekReview}
          className="w-full bg-indigo-100 text-indigo-700 py-3 rounded-lg font-semibold mb-4 hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          disabled={isViewerMode}
        >
          📝 Review This Week
        </button>

        <AdminTools user={user} systemConfig={systemConfig} />
      </div>
    </div >
  );
};

// ─── MAINTENANCE MODE ───────────────────────────────────────────────────────
// Production is intentionally offline pending security cleanup (most notably
// the Gemini key bundled into the client for Omnibox intent parsing — see
// CLAUDE.md Priorities).
//
// To re-enable: set MAINTENANCE_MODE to false (or revert the commit that
// introduced this block). Nothing below this point runs while it's true —
// no Firebase, no AI calls, no Firestore reads/writes.
const MAINTENANCE_MODE = false;

const MaintenancePage = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
      <h1 className="text-2xl font-bold text-gray-800 mb-3">Meal Planner</h1>
      <p className="text-gray-600 mb-2">Temporarily offline while we work on the app.</p>
      <p className="text-gray-400 text-sm">Back soon.</p>
    </div>
  </div>
);

export default function AppRoot() {
  if (MAINTENANCE_MODE) return <MaintenancePage />;

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch(err) {
      console.error('Sign-in failed', err);
      alert('Sign-in failed. Check console.');
    }
  };

  const handleSignOut = () => {
    signOut(auth);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4 text-center">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full mx-auto">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Meal Planner</h1>
          <p className="text-gray-500 mb-8">Sign in with Google to cross-sync your meal history and AI profiles.</p>
          <button
            onClick={handleSignIn}
            className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return <MealPlannerMain user={user} handleSignOut={handleSignOut} />;
}
