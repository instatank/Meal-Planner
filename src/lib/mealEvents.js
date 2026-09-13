import { normalizePreferences } from './plannerGenerator.js';
import { flattenMealDatabase, scoreMealMetadataSimilarity } from './mealDataLayer.js';
import {
  FEEDBACK_SCHEMA_VERSION,
  MAX_RETAINED_EVENTS,
  validateEvent
} from './feedbackSchema.js';

/**
 * Weights for the event types that move preferences.
 *
 * `customAvoid` (1.5), `editAvoid` (0.4) and `editAccept` (0.6) used to sit
 * here and are deliberately gone. All three read `originalMealName` /
 * `updatedMealName`, fields no producer wrote, so `customAvoid` never fired at
 * all and the two `edit` weights had no event type to fire on. Rather than
 * rewire them at the field that did exist — which for a `custom` event would
 * have penalised the meal the user had just chosen to eat — the events are now
 * recorded in full and interpreted by nothing. The weights come back when
 * there is enough captured data to validate what they should mean.
 *
 * See docs/CONSISTENCY_AUDIT.md finding #6.
 */
export const EVENT_WEIGHTS = {
  confirmAccept: 2,
  swapAvoidFirst: 1.2
};

/**
 * Event types that reach the preference derivation below. `custom`, `edit` and
 * `skip` are recorded but deliberately absent: they carry no weight, so
 * including them here would only add a branch that does nothing.
 */
const IMPACTFUL_EVENT_TYPES = new Set(['confirm', 'swap', 'legacy_import']);

const round2 = (value) => Number(Number(value).toFixed(2));

const addDelta = (bucket, key, delta) => {
  if (!key || !delta) return;
  const current = Number(bucket[key] || 0);
  const next = Math.max(0, round2(current + delta));
  if (next === 0) delete bucket[key];
  else bucket[key] = next;
};

/**
 * Build one event, stamped with the schema version it was written under.
 *
 * Validation is advisory and reported, never enforced: an event that fails
 * its definition is still returned and still stored, because losing a signal
 * is strictly worse than storing a misshapen one. `inspectMealEvent` is how a
 * caller sees the problem — `App.jsx` logs it, and `feedbackSchema.test.js`
 * asserts on it, so a producer that drops a field is caught by the suite
 * rather than discovered months later in an empty preference map.
 */
export const createMealEvent = (payload = {}) => ({
  id: payload.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  v: payload.v || FEEDBACK_SCHEMA_VERSION,
  type: payload.type || 'unknown',
  dateKey: payload.dateKey || '',
  mealType: payload.mealType || '',
  timestamp: payload.timestamp || new Date().toISOString(),
  ...payload
});

/** `validateEvent`, minus the universal fields every event has by construction. */
export const inspectMealEvent = (event) => validateEvent(event);

/**
 * Hold the log to `MAX_RETAINED_EVENTS`, keeping the newest.
 *
 * The log lives in a single Firestore document and in localStorage, both of
 * which have hard ceilings, and `saveToStorage` swallows a quota error with a
 * console warning — so an unbounded log does not fail loudly, it just stops
 * recording one day. Trimming here makes the bound explicit and keeps the
 * part the learner actually weights.
 */
export const trimEventLog = (events = [], limit = MAX_RETAINED_EVENTS) => {
  if (!Array.isArray(events) || events.length <= limit) return events;
  return events.slice(events.length - limit);
};

export const normalizeMealEvents = (rawValue) => {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      return {
        ...entry,
        id: entry.id || `evt_legacy_${Math.random().toString(36).slice(2, 9)}`,
        timestamp: entry.timestamp || new Date().toISOString(),
        undoTargets: Array.isArray(entry.undoTargets) ? entry.undoTargets.filter(Boolean) : undefined
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
};

export const hasPreferenceSignals = (preferences = {}) => {
  const accepts = Object.keys(preferences.accepts || {}).length;
  const avoids = Object.keys(preferences.avoids || {}).length;
  const edits = Object.keys(preferences.edits || {}).length;
  return accepts + avoids + edits > 0;
};

export const collectUndoneEventIds = (events = []) => {
  const undoneIds = new Set();
  for (const event of events) {
    if (event.type !== 'undo') continue;
    const targets = Array.isArray(event.undoTargets) ? event.undoTargets : [];
    for (const targetId of targets) {
      if (targetId) undoneIds.add(targetId);
    }
  }
  return undoneIds;
};

export const derivePreferencesFromEvents = (events = []) => {
  const normalized = normalizePreferences({});
  const sortedEvents = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sortedEvents);
  const firstSwapSeenBySlot = new Set();

  for (const event of sortedEvents) {
    if (!event || undoneIds.has(event.id)) continue;

    if (event.type === 'legacy_import' && event.importedPreferences) {
      const imported = normalizePreferences(event.importedPreferences);
      for (const [name, value] of Object.entries(imported.accepts)) addDelta(normalized.accepts, name, Number(value || 0));
      for (const [name, value] of Object.entries(imported.avoids)) addDelta(normalized.avoids, name, Number(value || 0));
      for (const [name, value] of Object.entries(imported.edits)) addDelta(normalized.edits, name, Number(value || 0));
      continue;
    }

    if (!IMPACTFUL_EVENT_TYPES.has(event.type)) continue;

    switch (event.type) {
      case 'confirm':
        addDelta(normalized.accepts, event.mealName, EVENT_WEIGHTS.confirmAccept);
        break;
      case 'swap': {
        const slotKey = `${event.dateKey}:${event.mealType}`;
        if (firstSwapSeenBySlot.has(slotKey)) break;
        firstSwapSeenBySlot.add(slotKey);
        addDelta(normalized.avoids, event.fromMealName, EVENT_WEIGHTS.swapAvoidFirst);
        break;
      }
      default:
        break;
    }
  }

  return normalized;
};

export const getUndoTargetsForSlots = (events = [], dateKey, mealTypes = []) => {
  const sortedEvents = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sortedEvents);
  const slotSet = new Set(mealTypes.filter(Boolean));

  return sortedEvents
    .filter((event) => {
      if (!event || undoneIds.has(event.id)) return false;
      if (!['confirm', 'swap', 'edit', 'custom'].includes(event.type)) return false;
      if (event.dateKey !== dateKey) return false;
      return slotSet.has(event.mealType);
    })
    .map((event) => event.id);
};

export const normalizeCustomMealKey = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const getCustomMealOccurrenceCount = (events = [], customMealText = '', lookbackDays = 45) => {
  const normalizedKey = normalizeCustomMealKey(customMealText);
  if (!normalizedKey) return 0;

  const sortedEvents = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sortedEvents);
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  return sortedEvents.filter((event) => {
    if (!event || undoneIds.has(event.id)) return false;
    if (event.type !== 'custom') return false;
    const eventTime = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventTime) || eventTime < cutoffMs) return false;
    return normalizeCustomMealKey(event.customMealText) === normalizedKey;
  }).length;
};

/**
 * The macros a repeatedly-logged custom meal actually had.
 *
 * Median, not mean: one mis-logged portion ("2000 cal") would drag a mean far
 * enough to push the promoted meal outside the calorie bounds, and a custom
 * log is exactly the kind of entry that gets fat-fingered.
 *
 * Returns `null` when no instance carried usable numbers, which is the signal
 * for the caller to refuse rather than to guess. That distinction is the whole
 * point: promoting a meal with invented macros puts fiction into a catalog the
 * optimizer trusts completely.
 */
export const summarizeObservedMacros = (observations = []) => {
  const usable = observations.filter((o) => o && (o.protein > 0 || o.cal > 0));
  if (!usable.length) return null;

  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  return {
    sampleSize: usable.length,
    protein: Math.round(median(usable.map((o) => o.protein))),
    cal: Math.round(median(usable.map((o) => o.cal))),
    carbs: Math.round(median(usable.map((o) => o.carbs))),
    fat: Math.round(median(usable.map((o) => o.fat)))
  };
};

const resolveCandidateTargetType = (mealTypeCounts = {}) => {
  const sorted = Object.entries(mealTypeCounts).sort((a, b) => b[1] - a[1]);
  const topMealType = sorted[0]?.[0];
  if (topMealType === 'breakfast') return 'breakfast';
  if (topMealType === 'snack') return 'snack';
  return 'lunchDinner';
};

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeMealNameKey = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const getCustomMealCandidates = (events = [], existingMealNames = [], options = {}) => {
  const lookbackDays = Number(options.lookbackDays || 45);
  const minCount = Number(options.minCount || 3);
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const normalizedExisting = new Set(existingMealNames.map((name) => normalizeCustomMealKey(name)).filter(Boolean));
  const sortedEvents = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sortedEvents);
  const grouped = new Map();

  for (const event of sortedEvents) {
    if (!event || undoneIds.has(event.id) || event.type !== 'custom') continue;

    const eventTime = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventTime) || eventTime < cutoffMs) continue;

    const normalizedKey = normalizeCustomMealKey(event.customMealText);
    if (!normalizedKey || normalizedExisting.has(normalizedKey)) continue;

    const current = grouped.get(normalizedKey) || {
      normalizedKey,
      displayName: String(event.customMealText || '').trim(),
      count: 0,
      lastSeenAt: event.timestamp,
      mealTypeCounts: {},
      // Every logged instance's macros, so promotion can use what was actually
      // eaten instead of inventing a number. See `summarizeObservedMacros`.
      observations: []
    };

    current.observations.push({
      protein: Number(event.protein || 0),
      cal: Number(event.cal || 0),
      carbs: Number(event.macros?.c || 0),
      fat: Number(event.macros?.f || 0)
    });
    current.count += 1;
    current.mealTypeCounts[event.mealType] = (current.mealTypeCounts[event.mealType] || 0) + 1;
    if (String(event.timestamp) > String(current.lastSeenAt)) {
      current.lastSeenAt = event.timestamp;
      current.displayName = String(event.customMealText || '').trim() || current.displayName;
    }

    grouped.set(normalizedKey, current);
  }

  return Array.from(grouped.values())
    .filter((item) => item.count >= minCount)
    .map((item) => ({
      normalizedKey: item.normalizedKey,
      displayName: item.displayName,
      count: item.count,
      lastSeenAt: item.lastSeenAt,
      mealTypeCounts: item.mealTypeCounts,
      suggestedMealType: resolveCandidateTargetType(item.mealTypeCounts),
      observedMacros: summarizeObservedMacros(item.observations)
    }))
    .sort((a, b) => b.count - a.count || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
};

export const getFrequentConfirmedMeals = (events = [], options = {}) => {
  const lookbackDays = Number(options.lookbackDays || 7);
  const minCount = Number(options.minCount || 3);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const cutoffMs = nowMs - lookbackDays * DAY_MS;

  const sortedEvents = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sortedEvents);
  const grouped = new Map();

  for (const event of sortedEvents) {
    if (!event || undoneIds.has(event.id) || event.type !== 'confirm') continue;

    const eventTime = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventTime) || eventTime < cutoffMs) continue;

    const mealName = String(event.mealName || '').trim();
    const normalizedName = normalizeMealNameKey(mealName);
    if (!normalizedName) continue;

    const current = grouped.get(normalizedName) || {
      mealName,
      normalizedName,
      count: 0,
      lastConfirmedAt: event.timestamp
    };

    current.count += 1;
    if (String(event.timestamp) > String(current.lastConfirmedAt)) {
      current.lastConfirmedAt = event.timestamp;
      current.mealName = mealName || current.mealName;
    }

    grouped.set(normalizedName, current);
  }

  return Array.from(grouped.values())
    .filter((item) => item.count >= minCount)
    .sort((a, b) => b.count - a.count || String(b.lastConfirmedAt).localeCompare(String(a.lastConfirmedAt)));
};

export const getSimilarMealSuggestions = ({ events = [], mealDatabase = {}, options = {} } = {}) => {
  const lookbackDays = Number(options.lookbackDays || 7);
  const minCount = Number(options.minCount || 3);
  const maxSuggestions = Number(options.maxSuggestions || 5);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();

  const triggered = getFrequentConfirmedMeals(events, {
    lookbackDays,
    minCount,
    nowMs
  });
  if (!triggered.length) return [];

  const allMeals = flattenMealDatabase(mealDatabase);
  const byName = new Map(allMeals.map((meal) => [normalizeMealNameKey(meal.name), meal]));
  const suggestions = [];

  for (const trigger of triggered) {
    const baseMeal = byName.get(trigger.normalizedName);
    if (!baseMeal) continue;

    const candidateSuggestions = [];

    for (const candidate of allMeals) {
      if (!candidate?.name || candidate.name === baseMeal.name) continue;
      const similarity = scoreMealMetadataSimilarity(baseMeal, candidate);
      if (similarity.score <= 0) continue;

      candidateSuggestions.push({
        meal_id: candidate.meal_id || '',
        meal_name: candidate.name,
        score: similarity.score,
        matched_fields: similarity.matched_fields,
        tags: candidate.tags
      });
    }

    candidateSuggestions.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matched_fields.length !== a.matched_fields.length) {
        return b.matched_fields.length - a.matched_fields.length;
      }
      return String(a.meal_name).localeCompare(String(b.meal_name));
    });

    suggestions.push({
      trigger_meal_name: baseMeal.name,
      confirm_count_7d: trigger.count,
      suggested_meals: candidateSuggestions.slice(0, maxSuggestions)
    });
  }

  return suggestions;
};
