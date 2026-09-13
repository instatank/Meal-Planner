/**
 * What your behaviour says a dish's tier should be.
 *
 * Hand-set tiers are a snapshot of what you believed when you set them. This
 * is the other half: the event log already knows how often you actually ate a
 * dish and how often you turned it down, and that is a better estimate of
 * "staple" than a guess made in a settings screen months ago.
 *
 * ── Proposals, never silent application ──
 *
 * Nothing here writes a tier. It returns suggestions with the evidence
 * attached, and a human accepts them one tap at a time. That is not timidity;
 * it is the difference between a system that is legible and one that quietly
 * rearranges your food. A tier changes a *hard cap* in the optimizer — how
 * many times a dish may appear — and a hard rule silently rewritten by a
 * heuristic is exactly the class of thing this codebase has been burned by.
 *
 * The same reasoning appears in `preferenceLearning.js`, which applies its
 * findings automatically — but that is Tier 3, it only re-ranks legal plans,
 * and it cannot make a plan illegal. Tiers can. So tiers ask.
 *
 * ── Cadence is per week of observation, not per appearance ──
 *
 * A dish eaten once, eight weeks ago, has a cadence of 0.125/week, not 1. The
 * denominator is the observation window, not the dish's own history, or every
 * dish ever eaten would look like a staple on the day it was first eaten.
 */

import {
  DEFAULT_TIER,
  FREQUENCY_TIER,
  TIER_DEFINITIONS,
  getMealTier
} from './mealTiers.js';
import { SLOT_OUTCOME, resolveSlotOutcomes } from './feedbackAnalytics.js';
import { collectUndoneEventIds, normalizeMealEvents } from './mealEvents.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this many recorded outcomes, a dish has no proposal at all. */
export const MIN_OUTCOMES_FOR_PROPOSAL = 4;

/**
 * Below this many days of history, no proposals are made for any dish.
 *
 * Cadence over a four-day window is not cadence, it is an accident of which
 * week you happened to start recording. Three weeks is the shortest span over
 * which "several times a week" and "once a week" are distinguishable.
 */
export const MIN_SPAN_DAYS_FOR_PROPOSAL = 21;

/** Weekly cadence at or above which a dish reads as a staple. */
export const STAPLE_CADENCE = 2;
export const REGULAR_CADENCE = 1;
/** At or below this, a dish is something you eat occasionally at most. */
export const RARE_CADENCE = 0.3;

/**
 * Rejection rate at or above which a dish is proposed for retirement.
 *
 * Set high on purpose. Turning down a dish twice out of three is often about
 * the day rather than the dish, and retirement removes it from planning
 * entirely — the most destructive edit available here. It needs to be clearly
 * a pattern.
 */
export const RETIRE_REJECTION_RATE = 0.6;

const round2 = (value) => Number(Number(value).toFixed(2));

/**
 * Per-dish behaviour: how often eaten, how often turned down, over what span.
 *
 * Eaten counts resolved slot outcomes, so a lunch swapped then eaten counts
 * once — the same per-slot discipline `feedbackAnalytics` uses, and for the
 * same reason: counting events would let one meal inflate two totals at once.
 *
 * Rejections are counted from the events directly, because a dish can be
 * rejected in a slot that some *other* dish ultimately occupied. Swapping away
 * from a dish at lunch means the lunch slot resolves to whatever you ate
 * instead; the rejection still belongs to the dish you left behind.
 */
export const summarizeDishBehaviour = (events = [], { lookbackDays = 120, nowMs = Date.now() } = {}) => {
  const resolved = resolveSlotOutcomes(events, { lookbackDays, nowMs });
  const sorted = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sorted);
  const cutoffMs = nowMs - lookbackDays * DAY_MS;

  const byDish = new Map();
  const entryFor = (name) => {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!byDish.has(key)) {
      byDish.set(key, { name: key, eaten: 0, rejected: 0, firstSeenAt: '', lastSeenAt: '' });
    }
    return byDish.get(key);
  };

  const touch = (entry, timestamp) => {
    if (!entry.firstSeenAt || String(timestamp) < entry.firstSeenAt) entry.firstSeenAt = timestamp;
    if (String(timestamp) > entry.lastSeenAt) entry.lastSeenAt = timestamp;
  };

  for (const slot of resolved) {
    if (slot.outcome !== SLOT_OUTCOME.FOLLOWED) continue;
    const entry = entryFor(slot.mealName);
    if (entry) entry.eaten += 1;
  }

  let earliest = '';
  let latest = '';

  for (const event of sorted) {
    if (!event || undoneIds.has(event.id)) continue;
    const eventMs = Date.parse(event.timestamp);
    if (Number.isFinite(eventMs) && eventMs < cutoffMs) continue;

    if (!earliest || String(event.timestamp) < earliest) earliest = event.timestamp;
    if (String(event.timestamp) > latest) latest = event.timestamp;

    const rejectedName =
      event.type === 'swap' ? event.fromMealName
        : event.type === 'skip' ? event.mealName
          : event.type === 'edit' ? event.originalMealName
            : event.type === 'custom' ? event.previousMealName
              : '';

    if (rejectedName) {
      const entry = entryFor(rejectedName);
      if (entry) {
        entry.rejected += 1;
        touch(entry, event.timestamp);
      }
    }

    const eatenName = event.type === 'confirm' ? event.mealName : '';
    if (eatenName) {
      const entry = entryFor(eatenName);
      if (entry) touch(entry, event.timestamp);
    }
  }

  const spanDays = earliest && latest
    ? Math.max(0, (Date.parse(latest) - Date.parse(earliest)) / DAY_MS)
    : 0;
  // The window the cadence denominator uses. Capped at the lookback so a very
  // old log does not dilute a recent habit into nothing.
  const observedWeeks = Math.max(1, Math.min(spanDays, lookbackDays) / 7);

  return {
    spanDays: Math.round(spanDays),
    observedWeeks: round2(observedWeeks),
    dishes: Array.from(byDish.values()).map((entry) => ({
      ...entry,
      outcomes: entry.eaten + entry.rejected,
      cadencePerWeek: round2(entry.eaten / observedWeeks),
      rejectionRate: entry.eaten + entry.rejected > 0
        ? round2(entry.rejected / (entry.eaten + entry.rejected))
        : 0
    }))
  };
};

/** The tier this dish's behaviour points at, with a sentence saying why. */
const tierFromBehaviour = (dish) => {
  if (dish.rejectionRate >= RETIRE_REJECTION_RATE && dish.rejected >= 3) {
    return {
      tier: FREQUENCY_TIER.RETIRED,
      why: `turned down ${dish.rejected} of ${dish.outcomes} times`
    };
  }
  if (dish.cadencePerWeek >= STAPLE_CADENCE) {
    return {
      tier: FREQUENCY_TIER.STAPLE,
      why: `eaten ${dish.cadencePerWeek}x a week`
    };
  }
  if (dish.cadencePerWeek >= REGULAR_CADENCE) {
    return {
      tier: FREQUENCY_TIER.REGULAR,
      why: `eaten about ${dish.cadencePerWeek}x a week`
    };
  }
  if (dish.cadencePerWeek <= RARE_CADENCE && dish.eaten > 0) {
    return {
      tier: FREQUENCY_TIER.RARE,
      why: `eaten only ${dish.eaten} time${dish.eaten === 1 ? '' : 's'} in ${Math.round(dish.outcomes && dish.cadencePerWeek ? 1 / dish.cadencePerWeek : 0)} weeks`
    };
  }
  return { tier: DEFAULT_TIER, why: 'about once a week' };
};

/**
 * Tier changes worth showing, strongest evidence first.
 *
 * Only differences are returned — a proposal agreeing with the current tier is
 * not news. `respectManualWithinDays` suppresses a proposal for a dish whose
 * tier you set by hand recently, because being argued with the same week you
 * made a decision is how a system teaches you to ignore it.
 */
export const proposeMealTiers = ({
  events = [],
  tierMap = {},
  mealNames = null,
  lookbackDays = 120,
  nowMs = Date.now(),
  respectManualWithinDays = 14
} = {}) => {
  const behaviour = summarizeDishBehaviour(events, { lookbackDays, nowMs });

  if (behaviour.spanDays < MIN_SPAN_DAYS_FOR_PROPOSAL) {
    return {
      ready: false,
      reason: `Needs about ${MIN_SPAN_DAYS_FOR_PROPOSAL} days of history — ${behaviour.spanDays} so far.`,
      spanDays: behaviour.spanDays,
      proposals: []
    };
  }

  const known = mealNames ? new Set(mealNames) : null;
  const proposals = [];

  for (const dish of behaviour.dishes) {
    if (known && !known.has(dish.name)) continue;
    if (dish.outcomes < MIN_OUTCOMES_FOR_PROPOSAL) continue;

    const currentTier = getMealTier(tierMap, dish.name);
    const suggestion = tierFromBehaviour(dish);
    if (suggestion.tier === currentTier) continue;

    const setAt = tierMap[dish.name]?.updatedAt;
    if (setAt) {
      const ageDays = (nowMs - Date.parse(setAt)) / DAY_MS;
      if (Number.isFinite(ageDays) && ageDays < respectManualWithinDays) continue;
    }

    proposals.push({
      mealName: dish.name,
      currentTier,
      proposedTier: suggestion.tier,
      why: suggestion.why,
      eaten: dish.eaten,
      rejected: dish.rejected,
      outcomes: dish.outcomes,
      cadencePerWeek: dish.cadencePerWeek,
      rejectionRate: dish.rejectionRate,
      // A promotion loosens a cap, a demotion tightens it, and retirement
      // removes the dish. The UI colours them differently because they carry
      // very different risk.
      direction:
        suggestion.tier === FREQUENCY_TIER.RETIRED ? 'retire'
          : TIER_DEFINITIONS[suggestion.tier].order < TIER_DEFINITIONS[currentTier].order ? 'promote'
            : 'demote'
    });
  }

  proposals.sort((a, b) => b.outcomes - a.outcomes || a.mealName.localeCompare(b.mealName));

  return {
    ready: true,
    reason: '',
    spanDays: behaviour.spanDays,
    observedWeeks: behaviour.observedWeeks,
    proposals
  };
};
