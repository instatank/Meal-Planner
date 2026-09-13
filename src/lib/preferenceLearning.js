/**
 * What the system learns from what you did.
 *
 * ── Why this is not just a counter per dish ──
 *
 * The preference model that existed before this counted two event types
 * against a dish *name*: a confirm added 2 to `accepts[name]`, a swap added
 * 1.2 to `avoids[name]`. That model cannot generalise. With 110 meals in the
 * catalog and a weekly plan touching 21 of them, a dish is seen a handful of
 * times a year, so the counters stay near zero forever and the planner never
 * learns anything you did not tell it about a specific dish. Worse, it cannot
 * represent the things people actually have opinions about: nobody dislikes
 * "Rajma chawal + raita", they dislike heavy legume lunches, or flatbread
 * twice a day, or Thursday's cooking effort.
 *
 * So every observation is credited twice: once to the dish, and once to each
 * of the ten *attributes* the dish has — cuisine, anchor ingredient, protein
 * family, carb form, carb level, weight class, format, effort, fat-heaviness,
 * fibre. Three swaps away from three different paneer dishes are three
 * separate near-zero dish signals, but one clear `primary:paneer` signal. That
 * is the whole point: attributes are how a handful of events becomes usable
 * knowledge about a catalog an order of magnitude larger.
 *
 * ── Why nothing here can wreck a plan ──
 *
 * Three independent guards, because a learning system that can make plans
 * worse is worse than none:
 *
 * 1. **Tier 3 only.** Learned preference ranks legal plans, it never gates
 *    one. It cannot break the protein floor, the repeat caps or the egg-
 *    breakfast rule, because it is not consulted where those are decided.
 * 2. **Shrinkage.** The score is a *shrunk* mean — `net / (evidence + PRIOR)`
 *    — so one strong event moves a bucket by at most 1/(1+PRIOR), and a
 *    bucket with no evidence is exactly 0, not "unknown treated as 0.5". With
 *    no data the whole structure is empty and the optimizer's score is
 *    unchanged bit for bit.
 * 3. **An evidence floor.** Below `MIN_EVIDENCE_TO_APPLY` a bucket is
 *    reported to the dashboard but withheld from the optimizer. You can see
 *    what it is starting to think before it acts on it.
 *
 * ── What this deliberately does not do ──
 *
 * It does not correct for **exposure bias**, and that is the honest limit of
 * the design. The planner shows you what it already believes you like, so
 * disliked attributes stop appearing, stop accumulating evidence, and freeze
 * at whatever score they had. A cuisine you have seen twice cannot be
 * distinguished from one you have no opinion about. Rather than pretend
 * otherwise, every bucket reports its `exposure` so the dashboard can say
 * "seen twice" out loud, and `getUnderexploredAttributes` names the buckets
 * the planner is starving. Fixing it properly means deliberate exploration —
 * occasionally planning against current belief — which is a product decision
 * about whose week gets spent on it, not a decision this file should make.
 */

import {
  deriveCarbType,
  deriveHasFibre,
  deriveIsFatHeavy,
  derivePrimaryIngredient,
  flattenMealDatabase,
  inferCarbLevel,
  inferEffort,
  inferFormat,
  inferMealWeightClass,
  inferProteinFamily
} from './mealDataLayer.js';
import {
  EVENT_DEFINITIONS,
  PLAN_REVIEW_REASON_BY_ID,
  RATING_NEUTRAL,
  RATING_MAX
} from './feedbackSchema.js';
import { collectUndoneEventIds, normalizeMealEvents } from './mealEvents.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shrinkage strength, in units of weighted observations.
 *
 * A bucket needs roughly this much evidence before its score reaches half of
 * its raw mean. 6 is chosen so that a week's worth of consistent behaviour
 * (three or four observations of the same attribute) registers as a real but
 * modest signal, while a single event is visibly tentative.
 */
export const PRIOR_STRENGTH = 6;

/**
 * Evidence below which a bucket is shown but not acted on.
 *
 * The intent is "three observations, not one bad Tuesday" — but evidence is
 * recency-weighted, so three real observations never sum to exactly 3. Three
 * spread across a normal week come to ~2.88, across a month ~2.60. A floor of
 * 3 would therefore reject the very pattern it was written to admit, so the
 * threshold is set just under it.
 *
 * The decay still does its job at the far end: three observations spread over
 * three months sum to ~2.04 and stay below the floor, which is correct —
 * that genuinely is weaker evidence than three in a week.
 */
export const MIN_EVIDENCE_TO_APPLY = 2.5;

/**
 * Half-life for recency weighting, in days.
 *
 * Tastes move. An observation from ten weeks ago counts half as much as one
 * from today. This is a half-life rather than a hard cutoff so that old
 * evidence fades instead of falling off a cliff and flipping a score on a
 * date boundary.
 */
export const RECENCY_HALF_LIFE_DAYS = 70;

/** How much a whole-week rating is worth per dish in that week. */
const PLAN_RATING_WEIGHT_PER_DISH = 0.25;

/** How much a structured reason tag is worth as evidence about its attribute. */
const REASON_WEIGHT = 1.5;

/** A dish named explicitly as disliked in a review. */
const DISLIKED_DISH_WEIGHT = 1.5;

const round3 = (value) => Number(Number(value).toFixed(3));

/**
 * The attribute keys a meal belongs to.
 *
 * Ten dimensions, each a single string key, sharing one namespace so the
 * review vocabulary in `feedbackSchema.js` can name the same buckets a meal
 * lands in — `cuisine:indian` from a complaint and `cuisine:indian` from a
 * swap are the same evidence about the same thing.
 */
export const extractMealAttributes = (meal) => {
  if (!meal || typeof meal !== 'object') return [];

  const keys = [];
  const push = (dimension, value) => {
    if (value === undefined || value === null || value === '') return;
    keys.push(`${dimension}:${String(value).toLowerCase()}`);
  };

  push('cuisine', meal.cuisine);
  push('primary', meal.primary_ingredient || derivePrimaryIngredient(meal));
  push('family', inferProteinFamily(meal));
  push('carb', deriveCarbType(meal));
  push('carbLevel', inferCarbLevel(meal));
  push('weight', inferMealWeightClass(meal));
  push('format', inferFormat(meal));
  push('effort', inferEffort(meal));
  push('fatHeavy', deriveIsFatHeavy(meal) ? 'yes' : 'no');
  push('fibre', deriveHasFibre(meal) ? 'yes' : 'no');

  return keys;
};

/**
 * Name -> attribute-key lookup for a catalog.
 *
 * Attributes are resolved from the catalog at read time rather than snapshot
 * onto each event at write time. That keeps the catalog the single source of
 * truth for what a dish *is* (a recomputed macro or a fixed cuisine tag
 * propagates to every past event), and it means the learner works
 * retroactively on the events already logged, which carry no attributes at
 * all. The cost is that a dish deleted from the catalog loses its attribute
 * credit — it keeps its dish-level score.
 */
export const buildAttributeIndex = (mealDatabase = {}) => {
  const byMeal = new Map();
  const documentFrequency = new Map();

  for (const meal of flattenMealDatabase(mealDatabase)) {
    const name = String(meal?.name || '').trim().toLowerCase();
    if (!name) continue;
    const keys = extractMealAttributes(meal);
    byMeal.set(name, keys);
    for (const key of keys) documentFrequency.set(key, (documentFrequency.get(key) || 0) + 1);
  }

  const mealCount = byMeal.size;

  /**
   * How much knowing this attribute narrows the catalog down, in (0, 1].
   *
   * Inverse document frequency, normalised by `log(N)` so a key unique to one
   * meal scores 1.0. A key on every meal scores 0 and cannot steer anything,
   * which is the correct treatment: it distinguishes no two plans.
   */
  const specificityOf = (key) => {
    const df = documentFrequency.get(key) || 0;
    if (!mealCount || df <= 0) return 0;
    if (mealCount === 1) return 1;
    return Math.min(1, Math.log(mealCount / df) / Math.log(mealCount));
  };

  return {
    mealCount,
    documentFrequency,
    specificityOf,
    coverageOf: (key) => (mealCount ? (documentFrequency.get(key) || 0) / mealCount : 0),
    get: (name) => byMeal.get(name) || [],
    keys: () => Array.from(documentFrequency.keys())
  };
};

const recencyWeight = (timestamp, nowMs) => {
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) return 1;
  const ageDays = Math.max(0, (nowMs - eventMs) / DAY_MS);
  return 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS);
};

const emptyBucket = () => ({
  positive: 0,
  negative: 0,
  evidence: 0,
  net: 0,
  exposure: 0,
  lastSeenAt: ''
});

const credit = (bucketMap, key, valence, weight, timestamp) => {
  if (!key || !weight) return;
  const bucket = bucketMap.get(key) || emptyBucket();
  const signed = valence * weight;

  if (signed >= 0) bucket.positive += signed;
  else bucket.negative += -signed;

  bucket.net += signed;
  bucket.evidence += Math.abs(weight);
  bucket.exposure += 1;
  if (String(timestamp) > String(bucket.lastSeenAt)) bucket.lastSeenAt = timestamp;

  bucketMap.set(key, bucket);
};

const finalizeBucket = (bucket) => ({
  score: round3(bucket.net / (bucket.evidence + PRIOR_STRENGTH)),
  rawMean: bucket.evidence > 0 ? round3(bucket.net / bucket.evidence) : 0,
  confidence: round3(bucket.evidence / (bucket.evidence + PRIOR_STRENGTH)),
  evidence: round3(bucket.evidence),
  exposure: bucket.exposure,
  positive: round3(bucket.positive),
  negative: round3(bucket.negative),
  lastSeenAt: bucket.lastSeenAt,
  applied: bucket.evidence >= MIN_EVIDENCE_TO_APPLY
});

const finalizeMap = (bucketMap, index = null) => {
  const out = {};
  for (const [key, bucket] of bucketMap) {
    const finalized = finalizeBucket(bucket);
    if (index) {
      finalized.coverage = round3(index.coverageOf(key));
      finalized.specificity = round3(index.specificityOf(key));
      // What the optimizer will actually feel. Kept beside `score` rather
      // than replacing it so the dashboard can show both: "you dislike this
      // strongly, but it describes most of the catalog, so it barely steers".
      finalized.effect = round3(finalized.score * finalized.specificity);
    } else {
      finalized.coverage = null;
      finalized.specificity = 1;
      finalized.effect = finalized.score;
    }
    out[key] = finalized;
  }
  return out;
};

/**
 * Turn the event log into dish-level and attribute-level preference.
 *
 * Every meal-scoped event contributes through the `signals` declared beside it
 * in `feedbackSchema.js`, so the mapping from "what happened" to "what it
 * means" lives in one place and is testable there, rather than being
 * re-invented by a switch statement here. Plan reviews are handled separately
 * because they are not about one meal.
 */
export const learnPreferences = ({
  events = [],
  mealDatabase = {},
  nowMs = Date.now(),
  attributeIndex
} = {}) => {
  const index = attributeIndex || buildAttributeIndex(mealDatabase);
  const sorted = normalizeMealEvents(events);
  const undoneIds = collectUndoneEventIds(sorted);

  const dishes = new Map();
  const attributes = new Map();
  const structure = new Map();
  const macros = new Map();

  let observations = 0;
  let firstAt = '';
  let lastAt = '';

  /** Credit one meal name, and through it every attribute it carries. */
  const creditMeal = (mealName, valence, weight, timestamp) => {
    const name = String(mealName || '').trim();
    if (!name || !weight) return;

    credit(dishes, name, valence, weight, timestamp);
    observations += 1;

    for (const key of index.get(name.toLowerCase())) {
      credit(attributes, key, valence, weight, timestamp);
    }
  };

  for (const event of sorted) {
    if (!event || undoneIds.has(event.id)) continue;

    const timestamp = event.timestamp;
    if (!firstAt || String(timestamp) < firstAt) firstAt = timestamp;
    if (String(timestamp) > lastAt) lastAt = timestamp;

    const decay = recencyWeight(timestamp, nowMs);

    if (event.type === 'plan_review') {
      // A rating is diffuse evidence about every dish in the week: real, but
      // much weaker per dish than someone swapping one out by hand. 3 is the
      // neutral point, so a middling week contributes exactly nothing.
      const rating = Number(event.rating);
      if (Number.isFinite(rating)) {
        const valence = (rating - RATING_NEUTRAL) / (RATING_MAX - RATING_NEUTRAL);
        if (valence !== 0) {
          for (const dish of event.dishes || []) {
            creditMeal(dish, valence, PLAN_RATING_WEIGHT_PER_DISH * decay, timestamp);
          }
        }
      }

      // Dishes named explicitly beat anything inferred from the week's rating:
      // the user pointed at them.
      for (const dish of event.dislikedDishes || []) {
        creditMeal(dish, -1, DISLIKED_DISH_WEIGHT * decay, timestamp);
      }

      for (const reasonId of event.reasonIds || []) {
        const reason = PLAN_REVIEW_REASON_BY_ID[reasonId];
        if (!reason) continue;
        const { kind, key, direction } = reason.signal;
        if (kind === 'none' || kind === 'dish') continue;

        const valence = direction === 'less' ? -1 : 1;
        const target = kind === 'attribute' ? attributes : kind === 'structure' ? structure : macros;
        credit(target, key, valence, REASON_WEIGHT * decay, timestamp);
        observations += 1;
      }

      continue;
    }

    const definition = EVENT_DEFINITIONS[event.type];
    for (const signal of definition?.signals || []) {
      creditMeal(event[signal.field], Math.sign(signal.valence), Math.abs(signal.valence) * decay, timestamp);
    }
  }

  const spanDays = firstAt && lastAt
    ? Math.max(0, Math.round((Date.parse(lastAt) - Date.parse(firstAt)) / DAY_MS))
    : 0;

  return {
    dishes: finalizeMap(dishes),
    attributes: finalizeMap(attributes, index),
    structure: finalizeMap(structure),
    macros: finalizeMap(macros),
    totals: {
      events: sorted.length - undoneIds.size,
      observations,
      spanDays,
      firstAt,
      lastAt
    }
  };
};

/**
 * The buckets the learner is confident enough to act on, strongest first.
 *
 * `applied` is the evidence floor; `limit` keeps the dashboard readable. The
 * sort is by |score| so a strong dislike ranks beside a strong preference —
 * both are equally worth seeing.
 */
export const getAppliedSignals = (learned = {}, { kind = 'attributes', limit = 12 } = {}) =>
  Object.entries(learned[kind] || {})
    .filter(([, bucket]) => bucket.applied && bucket.effect !== 0)
    .map(([key, bucket]) => ({ key, ...bucket }))
    // Ranked by `effect`, not `score`: what belongs at the top of the list is
    // what is actually moving plans, not what has the largest raw mean over a
    // bucket too broad to distinguish anything.
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || a.key.localeCompare(b.key))
    .slice(0, limit);

/**
 * Attribute buckets the planner is starving of evidence.
 *
 * Exposure bias is the blind spot named at the top of this file, and this is
 * the cheapest honest response to it: name the attributes that exist in the
 * catalog but have barely been served, so a human can see what the system has
 * never really given them a chance to have an opinion about.
 */
export const getUnderexploredAttributes = ({
  learned = {},
  mealDatabase = {},
  minExposure = 3,
  limit = 10
} = {}) => {
  const { documentFrequency } = buildAttributeIndex(mealDatabase);

  return Array.from(documentFrequency.entries())
    .map(([key, mealCount]) => ({
      key,
      mealCount,
      exposure: learned.attributes?.[key]?.exposure || 0
    }))
    .filter((entry) => entry.exposure < minExposure)
    // A dimension the catalog barely has is not under-explored, it is just
    // rare. Ranking by how much of the catalog is hidden behind the gap keeps
    // the list pointed at things worth trying.
    .sort((a, b) => b.mealCount - a.mealCount || a.key.localeCompare(b.key))
    .slice(0, limit);
};

/**
 * The learned model in the shape the optimizer consumes.
 *
 * Only `applied` buckets cross this line, and the output is empty when there
 * is no evidence — which is what makes "learning changes nothing until it
 * knows something" checkable rather than merely intended.
 */
export const toLearnedPreferences = (learned = {}) => {
  const pick = (source, field) => {
    const out = {};
    for (const [key, bucket] of Object.entries(source || {})) {
      const value = bucket[field];
      if (!bucket.applied || !value) continue;
      out[key] = value;
    }
    return out;
  };

  return {
    // A dish is its own bucket, so there is nothing to discount it by.
    dishes: pick(learned.dishes, 'score'),
    // Attributes cross into the optimizer already damped by specificity.
    attributes: pick(learned.attributes, 'effect')
  };
};

export const hasLearnedSignal = (learnedPreferences = {}) =>
  Object.keys(learnedPreferences.dishes || {}).length > 0
  || Object.keys(learnedPreferences.attributes || {}).length > 0;
