import { normalizePreferences } from './plannerGenerator.js';

export const EVENT_WEIGHTS = {
  confirmAccept: 2,
  swapAvoidFirst: 1.2,
  editAvoid: 0.4,
  editAccept: 0.6,
  customAvoid: 1.5
};

const IMPACTFUL_EVENT_TYPES = new Set(['confirm', 'swap', 'edit', 'custom', 'legacy_import']);

const round2 = (value) => Number(Number(value).toFixed(2));

const addDelta = (bucket, key, delta) => {
  if (!key || !delta) return;
  const current = Number(bucket[key] || 0);
  const next = Math.max(0, round2(current + delta));
  if (next === 0) delete bucket[key];
  else bucket[key] = next;
};

export const createMealEvent = (payload = {}) => ({
  id: payload.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  type: payload.type || 'unknown',
  dateKey: payload.dateKey || '',
  mealType: payload.mealType || '',
  timestamp: payload.timestamp || new Date().toISOString(),
  ...payload
});

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
      case 'edit':
        addDelta(normalized.avoids, event.originalMealName, EVENT_WEIGHTS.editAvoid);
        addDelta(normalized.accepts, event.updatedMealName, EVENT_WEIGHTS.editAccept);
        break;
      case 'custom':
        addDelta(normalized.avoids, event.originalMealName, EVENT_WEIGHTS.customAvoid);
        break;
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

const resolveCandidateTargetType = (mealTypeCounts = {}) => {
  const sorted = Object.entries(mealTypeCounts).sort((a, b) => b[1] - a[1]);
  const topMealType = sorted[0]?.[0];
  if (topMealType === 'breakfast') return 'breakfast';
  if (topMealType === 'snack') return 'snack';
  return 'lunchDinner';
};

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
      mealTypeCounts: {}
    };

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
      suggestedMealType: resolveCandidateTargetType(item.mealTypeCounts)
    }))
    .sort((a, b) => b.count - a.count || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
};
