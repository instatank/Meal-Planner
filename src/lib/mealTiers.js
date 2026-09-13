/**
 * How often a dish belongs in your week, and how good it is.
 *
 * ── The rule this changes ──
 *
 * R1 says every dish appears at most once a week, with one hand-picked
 * exception allowed up to three times. It exists because of a real failure: a
 * week once carried four different rajma dinners, every one of them legal,
 * because the cap counted meal *names*. The single-pin escape hatch was an
 * admission that a flat cap is wrong — some dishes genuinely should recur —
 * without a principled way to say which.
 *
 * This is that way. **The weekly cap becomes a property of the dish.** A
 * staple may appear three times, an occasional dish once, a retired dish not
 * at all. `dishCap()` in planOptimizer was already the only place the cap was
 * read, so this slots in behind it rather than spreading a second notion of
 * "how often" through the search.
 *
 * ── Why the default is `occasional` ──
 *
 * `occasional` caps at 1 per week, which is exactly `maxDishRepeatsPerWeek`.
 * So a catalog with no tiers set plans *identically* to before — same
 * discipline as the learning model: no input, no change, provable rather than
 * intended. Nothing here activates until you say something about a dish, or
 * enough behaviour accumulates to propose it.
 *
 * ── Why a cap is not enough ──
 *
 * Permitting a staple three times does not make it appear three times. The
 * scorer pays `distinctMealBonus` for new dishes and `repeatUsePenalty` for
 * repeats, so a week of 21 distinct dishes always outscores one that reuses a
 * staple. A tier therefore carries `repeatPenaltyScale` as well: for a staple
 * the cost of repeating is most of the way discounted, for an occasional dish
 * it is unchanged. The cap says what is allowed; the scale says what is
 * wanted.
 */

/**
 * Frequency tiers, coarsest thing first.
 *
 * `maxPerWeek` feeds the hard cap. `repeatPenaltyScale` multiplies the Tier-3
 * repeat penalty. `minGapDays` is a cooldown read against history, for dishes
 * that should recur but not in consecutive weeks.
 */
export const FREQUENCY_TIER = Object.freeze({
  STAPLE: 'staple',
  REGULAR: 'regular',
  OCCASIONAL: 'occasional',
  RARE: 'rare',
  RETIRED: 'retired'
});

export const TIER_DEFINITIONS = Object.freeze({
  [FREQUENCY_TIER.STAPLE]: {
    id: FREQUENCY_TIER.STAPLE,
    label: 'Staple',
    hint: 'Happy to eat this several times a week',
    maxPerWeek: 3,
    // Heavily discounted: without this the variety bonus wins every time and
    // a staple stays a once-a-week dish that merely *could* repeat.
    repeatPenaltyScale: 0.2,
    minGapDays: 0,
    order: 0
  },
  [FREQUENCY_TIER.REGULAR]: {
    id: FREQUENCY_TIER.REGULAR,
    label: 'Regular',
    hint: 'Once or twice a week',
    maxPerWeek: 2,
    repeatPenaltyScale: 0.6,
    minGapDays: 0,
    order: 1
  },
  [FREQUENCY_TIER.OCCASIONAL]: {
    id: FREQUENCY_TIER.OCCASIONAL,
    label: 'Occasional',
    hint: 'Once a week at most — the default',
    maxPerWeek: 1,
    repeatPenaltyScale: 1,
    minGapDays: 0,
    order: 2
  },
  [FREQUENCY_TIER.RARE]: {
    id: FREQUENCY_TIER.RARE,
    label: 'Rare',
    hint: 'A treat — once a month or so',
    maxPerWeek: 1,
    repeatPenaltyScale: 1,
    // Enforced against history, not within the week: capping at 1 per week
    // cannot express "not two weeks running".
    minGapDays: 21,
    order: 3
  },
  [FREQUENCY_TIER.RETIRED]: {
    id: FREQUENCY_TIER.RETIRED,
    label: 'Retired',
    hint: 'Never plan this again',
    maxPerWeek: 0,
    repeatPenaltyScale: 1,
    minGapDays: 0,
    order: 4
  }
});

/**
 * The tier a dish has when nobody has said otherwise.
 *
 * Deliberately equal to today's `maxDishRepeatsPerWeek` of 1, so an untiered
 * catalog is bit-identical to the pre-tier one. See the header.
 */
export const DEFAULT_TIER = FREQUENCY_TIER.OCCASIONAL;

export const TIER_ORDER = Object.freeze(
  Object.values(TIER_DEFINITIONS)
    .sort((a, b) => a.order - b.order)
    .map((tier) => tier.id)
);

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * How a meal's parts may be recombined.
 *
 * `fixed` is a composite that only works as authored — idli, sambar and
 * chutney are one dish, and pairing the sambar with a grilled salmon is not a
 * meal anyone eats. `modular` is a dish that is really a pattern: a salad
 * base plus a protein, where any base works with any protein.
 *
 * Everything is `fixed` unless declared otherwise, because assuming a dish can
 * be taken apart is the dangerous default — it invents meals nobody would eat.
 */
export const PAIRING_MODE = Object.freeze({
  FIXED: 'fixed',
  MODULAR: 'modular'
});

export const DEFAULT_PAIRING_MODE = PAIRING_MODE.FIXED;

const clampRating = (value) => {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(rating)));
};

export const isKnownTier = (tier) => Object.prototype.hasOwnProperty.call(TIER_DEFINITIONS, tier);

export const getTierDefinition = (tier) =>
  TIER_DEFINITIONS[isKnownTier(tier) ? tier : DEFAULT_TIER];

/**
 * One meal's tiering record, normalised.
 *
 * An unknown tier falls back to the default rather than being rejected: a
 * record written by a newer build, or hand-edited, should degrade to "no
 * opinion" instead of throwing inside the planner.
 */
export const normalizeMealTier = (entry = {}) => ({
  tier: isKnownTier(entry.tier) ? entry.tier : DEFAULT_TIER,
  rating: clampRating(entry.rating),
  pairing: entry.pairing === PAIRING_MODE.MODULAR ? PAIRING_MODE.MODULAR : DEFAULT_PAIRING_MODE,
  // Free-text, never parsed — the same role the review note plays. "Only when
  // it's cold", "mum's recipe", "too much washing up".
  note: String(entry.note || '').trim(),
  // When the user last said something about this dish, so a proposal can tell
  // "you set this months ago and behaviour has moved" from "you just set it".
  updatedAt: entry.updatedAt || ''
});

/**
 * The whole tier map, keyed by meal name.
 *
 * Keyed by name rather than `meal_id` because that is what the event log, the
 * optimizer's repeat counters and the preference buckets all key on. A second
 * identifier here would need reconciling with those on every read, and a
 * mismatch would fail silently — the exact shape of audit finding #6.
 */
export const normalizeMealTierMap = (raw = {}) => {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [mealName, entry] of Object.entries(raw)) {
    const name = String(mealName || '').trim();
    if (!name || !entry || typeof entry !== 'object') continue;
    out[name] = normalizeMealTier(entry);
  }
  return out;
};

export const getMealTier = (tierMap = {}, mealName = '') =>
  tierMap[String(mealName || '').trim()]?.tier || DEFAULT_TIER;

export const getMealRating = (tierMap = {}, mealName = '') =>
  tierMap[String(mealName || '').trim()]?.rating ?? null;

/** How many times this dish may appear in one week. */
export const getMealWeeklyCap = (tierMap = {}, mealName = '') =>
  getTierDefinition(getMealTier(tierMap, mealName)).maxPerWeek;

export const isRetired = (tierMap = {}, mealName = '') =>
  getMealTier(tierMap, mealName) === FREQUENCY_TIER.RETIRED;

/**
 * True when nothing in the map would change how a week is planned.
 *
 * The optimizer uses this to skip tier handling entirely, which is what makes
 * "an untiered catalog plans identically" a property of the code rather than a
 * hope about arithmetic. A map full of default-tier entries with only ratings
 * set still counts as inert for capping purposes but not for scoring, so the
 * two are asked separately.
 */
export const hasTierEffects = (tierMap = {}) =>
  Object.values(tierMap).some((entry) => entry.tier !== DEFAULT_TIER);

export const hasRatingEffects = (tierMap = {}) =>
  Object.values(tierMap).some((entry) => Number.isFinite(entry.rating));

/**
 * Count how much of the catalog each tier holds.
 *
 * Retiring dishes is the one edit here that can make the catalog unable to
 * satisfy the rules — R1 needs 21 distinct dishes a week, R2 needs egg
 * breakfasts, R3 needs Indian lunches and non-Indian dinners. The UI shows
 * this so retiring a dish is an informed choice rather than a surprise three
 * weeks later when generation starts failing.
 */
export const summarizeTierCoverage = (tierMap = {}, mealNames = []) => {
  const counts = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0]));
  let rated = 0;
  let ratingTotal = 0;

  for (const name of mealNames) {
    const entry = tierMap[name];
    counts[entry?.tier || DEFAULT_TIER] += 1;
    if (Number.isFinite(entry?.rating)) {
      rated += 1;
      ratingTotal += entry.rating;
    }
  }

  const total = mealNames.length;
  const retired = counts[FREQUENCY_TIER.RETIRED];

  return {
    total,
    counts,
    retired,
    available: total - retired,
    rated,
    averageRating: rated ? Number((ratingTotal / rated).toFixed(2)) : null,
    // Weekly supply: what the tiers permit in one week, against the 21 slots a
    // week needs. Below 21 the catalog cannot fill a week at all.
    weeklyCapacity: mealNames.reduce((sum, name) => sum + getMealWeeklyCap(tierMap, name), 0)
  };
};
