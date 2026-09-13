/**
 * The objective half of the review surface.
 *
 * `planReview.js` holds what the user *said*; this holds what they *did*. Both
 * feed the same dashboard, because either one alone misleads: a week rated 4
 * in which five meals were quietly swapped is not a week that worked, and a
 * week with perfect adherence and a rating of 2 says the rules are being
 * followed and are wrong.
 *
 * ── Why outcomes are resolved per slot, not counted per event ──
 *
 * The obvious implementation — count confirms, count skips, divide — is
 * wrong, and wrong in the flattering direction. A single lunch can produce a
 * swap and then a confirm; counting events would file that as both a
 * deviation and a success, inflating the denominator and the numerator at
 * once. So each (date, slot) is resolved to exactly one outcome by what
 * finally happened to it, and "was it adjusted first?" is tracked separately.
 * A slot is one meal, and one meal is one data point.
 */

import { collectUndoneEventIds, normalizeMealEvents } from './mealEvents.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SLOT_OUTCOME = Object.freeze({
  /** Eaten as planned. */
  FOLLOWED: 'followed',
  /** Something else was eaten instead. */
  OVERRIDDEN: 'overridden',
  /** Not eaten at all. */
  SKIPPED: 'skipped'
});

const OUTCOME_BY_EVENT = Object.freeze({
  confirm: SLOT_OUTCOME.FOLLOWED,
  skip: SLOT_OUTCOME.SKIPPED,
  custom: SLOT_OUTCOME.OVERRIDDEN,
  edit: SLOT_OUTCOME.OVERRIDDEN
});

const emptySlotStats = () => ({
  [SLOT_OUTCOME.FOLLOWED]: 0,
  [SLOT_OUTCOME.OVERRIDDEN]: 0,
  [SLOT_OUTCOME.SKIPPED]: 0,
  adjustedFirst: 0,
  total: 0
});

const rate = (numerator, denominator) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(3)) : null;

/**
 * Resolve every touched slot to one outcome.
 *
 * The last outcome-bearing event for a slot wins, because it is what actually
 * happened: a confirm after a skip means it was eaten after all. Swaps never
 * decide an outcome — they are a mid-course correction, recorded as
 * `adjustedFirst` — which matters because "I kept the plan but had to shuffle
 * it three times" and "the plan was right first time" are different facts
 * about the planner and would otherwise be the same number.
 */
export const resolveSlotOutcomes = (events = [], { lookbackDays = 90, nowMs = Date.now() } = {}) => {
  const sorted = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sorted);
  const cutoffMs = nowMs - lookbackDays * DAY_MS;

  const slots = new Map();

  for (const event of sorted) {
    if (!event || undoneIds.has(event.id)) continue;
    if (!event.dateKey || !event.mealType || event.mealType === 'week' || event.mealType === 'day') continue;

    const eventMs = Date.parse(event.timestamp);
    if (Number.isFinite(eventMs) && eventMs < cutoffMs) continue;

    const key = `${event.dateKey}:${event.mealType}`;
    const slot = slots.get(key) || {
      dateKey: event.dateKey,
      mealType: event.mealType,
      outcome: null,
      adjustedFirst: false,
      mealName: '',
      protein: 0
    };

    if (event.type === 'swap') {
      slot.adjustedFirst = true;
    } else {
      const outcome = OUTCOME_BY_EVENT[event.type];
      if (outcome) {
        slot.outcome = outcome;
        slot.mealName = event.mealName || event.updatedMealName || slot.mealName;
        slot.protein = Number(event.protein || 0) || slot.protein;
      }
    }

    slots.set(key, slot);
  }

  return Array.from(slots.values()).filter((slot) => slot.outcome);
};

/**
 * Adherence overall and per slot, plus the protein actually delivered.
 *
 * `proteinDelivered` counts only followed and overridden slots — a skipped
 * meal contributes no protein and pretending otherwise would make a week of
 * skipped lunches look like a week that hit its target.
 */
export const summarizeAdherence = (events = [], options = {}) => {
  const resolved = resolveSlotOutcomes(events, options);

  const overall = emptySlotStats();
  const byMealType = {};

  let proteinDelivered = 0;
  let proteinLostToSkips = 0;

  for (const slot of resolved) {
    const bucket = (byMealType[slot.mealType] ||= emptySlotStats());

    overall[slot.outcome] += 1;
    overall.total += 1;
    bucket[slot.outcome] += 1;
    bucket.total += 1;

    if (slot.adjustedFirst) {
      overall.adjustedFirst += 1;
      bucket.adjustedFirst += 1;
    }

    if (slot.outcome === SLOT_OUTCOME.SKIPPED) proteinLostToSkips += slot.protein;
    else proteinDelivered += slot.protein;
  }

  const withRates = (stats) => ({
    ...stats,
    adherenceRate: rate(stats[SLOT_OUTCOME.FOLLOWED], stats.total),
    overrideRate: rate(stats[SLOT_OUTCOME.OVERRIDDEN], stats.total),
    skipRate: rate(stats[SLOT_OUTCOME.SKIPPED], stats.total),
    adjustedFirstRate: rate(stats.adjustedFirst, stats.total)
  });

  return {
    overall: withRates(overall),
    byMealType: Object.fromEntries(
      Object.entries(byMealType).map(([mealType, stats]) => [mealType, withRates(stats)])
    ),
    proteinDelivered: Math.round(proteinDelivered),
    proteinLostToSkips: Math.round(proteinLostToSkips),
    slotsResolved: resolved.length
  };
};

/**
 * The dishes the plan keeps getting wrong, most-rejected first.
 *
 * Ranked by count rather than by rate on purpose. A dish overridden 2 times
 * out of 2 has a 100% rejection rate and tells you almost nothing; one
 * overridden 6 times out of 9 is a real problem. The rate is reported beside
 * the count so both are visible, but the ordering reflects how much evidence
 * there is.
 */
export const getMostRejectedDishes = (events = [], { limit = 8, ...options } = {}) => {
  const resolved = resolveSlotOutcomes(events, options);
  const byDish = new Map();

  const sorted = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sorted);

  // Overrides and skips name the dish that was rejected; a swap names it in
  // `fromMealName`, which is the only field on that event that identifies a
  // dish the user turned down.
  for (const event of sorted) {
    if (!event || undoneIds.has(event.id)) continue;
    const rejectedName =
      event.type === 'swap' ? event.fromMealName
        : event.type === 'edit' ? event.originalMealName
          : event.type === 'custom' ? event.previousMealName
            : event.type === 'skip' ? event.mealName
              : '';
    if (!rejectedName) continue;
    const entry = byDish.get(rejectedName) || { name: rejectedName, rejected: 0, followed: 0 };
    entry.rejected += 1;
    byDish.set(rejectedName, entry);
  }

  for (const slot of resolved) {
    if (slot.outcome !== SLOT_OUTCOME.FOLLOWED || !slot.mealName) continue;
    const entry = byDish.get(slot.mealName) || { name: slot.mealName, rejected: 0, followed: 0 };
    entry.followed += 1;
    byDish.set(slot.mealName, entry);
  }

  return Array.from(byDish.values())
    .filter((entry) => entry.rejected > 0)
    .map((entry) => ({
      ...entry,
      seen: entry.rejected + entry.followed,
      rejectionRate: rate(entry.rejected, entry.rejected + entry.followed)
    }))
    .sort((a, b) => b.rejected - a.rejected || a.name.localeCompare(b.name))
    .slice(0, limit);
};

// ─── Plain English ──────────────────────────────────────────────────────────

const DIMENSION_LABELS = Object.freeze({
  cuisine: 'Cuisine',
  primary: 'Main ingredient',
  family: 'Protein type',
  carb: 'Carb base',
  carbLevel: 'Carb level',
  weight: 'Meal size',
  format: 'Format',
  effort: 'Cooking effort',
  fatHeavy: 'High fat',
  fibre: 'High fibre'
});

const VALUE_OVERRIDES = Object.freeze({
  flatbread_pasta: 'flatbread or pasta',
  none: 'no starch',
  yes: 'yes',
  no: 'no'
});

const humanizeValue = (value) =>
  VALUE_OVERRIDES[value] || String(value).replace(/_/g, ' ');

/**
 * Turn an attribute key into something a person can read.
 *
 * The dashboard is for someone deciding whether to trust this system, and
 * `primary:chicken_breast` is not a sentence. Kept here rather than in the
 * component so the same phrasing is available anywhere the model is explained.
 */
export const describeAttributeKey = (key = '') => {
  const [dimension, ...rest] = String(key).split(':');
  const value = rest.join(':');
  const label = DIMENSION_LABELS[dimension] || dimension;
  return `${label}: ${humanizeValue(value)}`;
};

/**
 * How much of the model to believe yet, in one word.
 *
 * Deliberately coarse. A precise-looking confidence percentage invites the
 * reader to over-trust a number that is itself an estimate from very little
 * data; "still learning" is both vaguer and more accurate.
 */
export const describeReadiness = (learned = {}, reviewSummary = {}) => {
  const applied = Object.values(learned.attributes || {}).filter((b) => b.applied).length;
  const observations = learned.totals?.observations || 0;
  const reviews = reviewSummary.total || 0;

  if (observations === 0) return { level: 'empty', headline: 'Nothing learned yet', detail: 'Confirm, swap or skip a few meals and this fills in.' };
  if (applied === 0) return { level: 'watching', headline: 'Watching, not acting', detail: `${observations} observation${observations === 1 ? '' : 's'} recorded — none has crossed the evidence floor, so plans are unchanged.` };
  if (applied < 5 || reviews < 2) return { level: 'learning', headline: 'Starting to steer', detail: `${applied} pattern${applied === 1 ? '' : 's'} now influence planning. Early — expect it to shift.` };
  return { level: 'established', headline: 'Actively steering', detail: `${applied} patterns influence planning, across ${observations} observations and ${reviews} week reviews.` };
};
