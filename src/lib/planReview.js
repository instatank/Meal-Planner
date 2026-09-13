/**
 * Week-level review: accept, reject, rate, and say why.
 *
 * What existed before was `rejectWeek`, a `window.prompt` and an append to a
 * `rejected-plans` array that nothing in the app ever read back. Two things
 * were wrong with it beyond the missing accept path:
 *
 * 1. It was write-only. The one piece of genuinely subjective data the user
 *    produced went into a blob whose only reader is a CLI script requiring
 *    Firebase Admin credentials — which, in a browser-only workflow, means it
 *    had no reader at all.
 * 2. A free-text line cannot be learned from without another model call on
 *    every read. "Too much roti this week" and "way too many flatbreads" are
 *    the same complaint and no counter was ever going to notice.
 *
 * So a review now carries three layers, in descending order of how mechanical
 * they are:
 *
 *   verdict + rating  — one number, always comparable, trends over time
 *   reasonIds         — a fixed vocabulary that maps onto the same attribute
 *                       keys the learner extracts from meals, so a stated
 *                       complaint and an observed behaviour land in the same
 *                       bucket and reinforce each other
 *   note              — free text, kept verbatim, never parsed here
 *
 * The note is not decoration. It is the only layer that can say something the
 * vocabulary has no word for, and it is what a later pass (or a human) reads
 * when the numbers say a week was bad but not why.
 */

import {
  PLAN_REVIEW_REASON_BY_ID,
  PLAN_VERDICT,
  RATING_MAX,
  RATING_MIN,
  RATING_NEUTRAL
} from './feedbackSchema.js';
import { normalizeMealEvents, collectUndoneEventIds } from './mealEvents.js';

const CORE_SLOTS = ['breakfast', 'lunch', 'dinner'];

const clampRating = (value) => {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(rating)));
};

/** Every distinct dish in a week's worth of plan days, in slot order. */
export const collectWeekDishes = (mealPlans = {}, dateKeys = []) => {
  const seen = new Set();
  const dishes = [];
  for (const dateKey of [...dateKeys].sort()) {
    const day = mealPlans[dateKey];
    if (!day) continue;
    for (const slot of CORE_SLOTS) {
      const name = day[slot]?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      dishes.push({ name, slot, dateKey });
    }
  }
  return dishes;
};

/**
 * Build the event payload for one review.
 *
 * `dishes` is stored on the event rather than re-derived from `mealPlans` at
 * read time, and that is deliberate: a week gets regenerated, and a review of
 * the week as it stood is not a review of whatever replaced it. Storing the
 * dish list makes the record immutable in the way a verdict needs to be.
 */
export const buildPlanReviewPayload = ({
  weekStartKey,
  dateKeys = [],
  verdict,
  rating,
  reasonIds = [],
  note = '',
  dishes = [],
  dislikedDishes = []
} = {}) => {
  const normalizedVerdict =
    verdict === PLAN_VERDICT.ACCEPTED || verdict === PLAN_VERDICT.REJECTED
      ? verdict
      : PLAN_VERDICT.REJECTED;

  const knownReasonIds = reasonIds.filter((id) => PLAN_REVIEW_REASON_BY_ID[id]);

  return {
    type: 'plan_review',
    weekStartKey: String(weekStartKey || ''),
    dateKeys: [...dateKeys].sort(),
    // `mealType: 'week'` keeps plan events out of the slot-scoped undo lookup,
    // which matches on a real slot name.
    mealType: 'week',
    dateKey: String(weekStartKey || ''),
    verdict: normalizedVerdict,
    rating: clampRating(rating),
    reasonIds: knownReasonIds,
    note: String(note || '').trim(),
    dishes: dishes.map((dish) => (typeof dish === 'string' ? dish : dish?.name)).filter(Boolean),
    dislikedDishes: dislikedDishes.filter(Boolean)
  };
};

/**
 * Every review in the log, oldest first, with retracted ones dropped.
 *
 * Legacy `rejected-plans` entries are folded in when supplied. That history is
 * thin — a timestamp, a plan and one line of text — but it is the only record
 * of what the user disliked before this existed, and discarding it to keep the
 * reader simple would be throwing away the scarcest data in the system.
 */
export const collectPlanReviews = (events = [], legacyRejections = []) => {
  const sorted = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sorted);

  const reviews = sorted
    .filter((event) => event.type === 'plan_review' && !undoneIds.has(event.id))
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      weekStartKey: event.weekStartKey || event.dateKey || '',
      dateKeys: Array.isArray(event.dateKeys) ? event.dateKeys : [],
      verdict: event.verdict,
      rating: clampRating(event.rating),
      reasonIds: Array.isArray(event.reasonIds) ? event.reasonIds : [],
      note: event.note || '',
      dishes: Array.isArray(event.dishes) ? event.dishes : [],
      dislikedDishes: Array.isArray(event.dislikedDishes) ? event.dislikedDishes : [],
      legacy: false
    }));

  for (const entry of Array.isArray(legacyRejections) ? legacyRejections : []) {
    if (!entry || typeof entry !== 'object') continue;
    const dateKeys = Object.keys(entry.plan || {}).sort();
    reviews.push({
      id: `legacy_${entry.timestamp}`,
      timestamp: entry.timestamp || '',
      weekStartKey: dateKeys[0] || '',
      dateKeys,
      verdict: PLAN_VERDICT.REJECTED,
      // A legacy rejection carries no rating. Inventing one — say, a 1 because
      // it was rejected — would put a fabricated number into the average the
      // dashboard shows. It stays null and is excluded from that average.
      rating: null,
      reasonIds: [],
      note: entry.reason || '',
      dishes: collectWeekDishes(entry.plan || {}, dateKeys).map((dish) => dish.name),
      dislikedDishes: [],
      legacy: true
    });
  }

  return reviews.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
};

/**
 * Roll reviews up into the numbers the dashboard shows.
 *
 * `averageRating` is over rated reviews only. `acceptanceRate` is over every
 * review including the unrated legacy ones, because a rejection is a verdict
 * whether or not it came with a score.
 */
export const summarizePlanReviews = (reviews = []) => {
  const total = reviews.length;
  const accepted = reviews.filter((r) => r.verdict === PLAN_VERDICT.ACCEPTED).length;
  const rated = reviews.filter((r) => Number.isFinite(r.rating));

  const reasonCounts = {};
  for (const review of reviews) {
    for (const id of review.reasonIds) {
      reasonCounts[id] = (reasonCounts[id] || 0) + 1;
    }
  }

  const topReasons = Object.entries(reasonCounts)
    .map(([id, count]) => ({
      id,
      count,
      label: PLAN_REVIEW_REASON_BY_ID[id]?.label || id,
      polarity: PLAN_REVIEW_REASON_BY_ID[id]?.polarity || 'neutral'
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  const averageRating = rated.length
    ? Number((rated.reduce((sum, r) => sum + r.rating, 0) / rated.length).toFixed(2))
    : null;

  // Direction of travel over the last five rated weeks against everything
  // before them. Fewer than four rated weeks is not a trend, it is noise, so
  // it reports `null` rather than a number that will swing on the next entry.
  let ratingTrend = null;
  if (rated.length >= 4) {
    const recent = rated.slice(-5);
    const earlier = rated.slice(0, -5);
    if (earlier.length > 0) {
      const mean = (list) => list.reduce((sum, r) => sum + r.rating, 0) / list.length;
      ratingTrend = Number((mean(recent) - mean(earlier)).toFixed(2));
    }
  }

  return {
    total,
    accepted,
    rejected: total - accepted,
    acceptanceRate: total ? Number((accepted / total).toFixed(3)) : null,
    ratedCount: rated.length,
    averageRating,
    ratingTrend,
    neutralRating: RATING_NEUTRAL,
    topReasons,
    notes: reviews
      .filter((r) => r.note)
      .slice(-20)
      .map((r) => ({
        timestamp: r.timestamp,
        weekStartKey: r.weekStartKey,
        verdict: r.verdict,
        rating: r.rating,
        note: r.note
      }))
      .reverse()
  };
};

/**
 * The legacy shape, so `rejected-plans` and `scripts/scorePlan.mjs` keep
 * working while the event log becomes the real home.
 *
 * Written for rejections only — an accepted week has never had a place in
 * that array and adding one would change what the file means to its existing
 * reader.
 */
export const toLegacyRejectionRecord = ({ plan = {}, review }) => ({
  timestamp: new Date().toISOString(),
  plan,
  reason: [
    ...review.reasonIds.map((id) => PLAN_REVIEW_REASON_BY_ID[id]?.label || id),
    review.note
  ]
    .filter(Boolean)
    .join(' — '),
  rating: review.rating,
  reasonIds: review.reasonIds
});
