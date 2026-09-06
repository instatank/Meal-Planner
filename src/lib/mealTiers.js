/**
 * mealTiers.js — how often a given meal is allowed to come back.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * R1 used to say "every dish at most once a week" and applied it to all 110
 * meals identically. That is a rule about the *catalog*, not about the person
 * eating from it, and it had two measured consequences:
 *
 *   1. A meal the user confirmed every single week could never appear twice.
 *      Measured: with `accepts` set to 2, 4, 8, 20 and 100, the generated week
 *      contained the meal exactly once every time. The preference weight was
 *      not weak — it was structurally incapable of changing frequency.
 *   2. The optimizer's own `pinnedDish` escape hatch (up to 3 uses for one
 *      chosen dish) was never wired to anything. Grep across `src/`, `api/`
 *      and `scripts/` finds no caller that ever sets it, and
 *      `validateAndRepairWeek` does not forward it either, so a pinned dish
 *      would have been rejected by the validator even if something had.
 *
 * So the week came out as 21 distinct dishes, every week, forever — maximum
 * novelty as a hard constraint, which is the opposite of how anyone eats.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT A COLUMN IN mealDatabase.js
 *
 * The obvious implementation is a `tier` field beside `cuisine`. It is the
 * wrong home for two reasons this repo has already paid for once:
 *
 *   - A tier is a fact about a person, not about a food. Two users of the same
 *     catalog have different tier lists. Storing it on the meal makes the
 *     catalog un-shareable and freezes one person's taste into the data.
 *   - Every fact that got a second hand-maintained home in this repo drifted.
 *     `cuisine` was declared inline on 77 meals and again in `handAuthoredTags`,
 *     and 29 of them disagreed (docs/CONSISTENCY_AUDIT.md #5). A hand-typed
 *     tier column would be the same bug with a longer fuse.
 *
 * Instead a tier is *resolved* per user, in one place, from two inputs:
 *
 *   1. An explicit override the user set. Always wins. This is the "I want
 *      this weekly" / "never show me this again" control.
 *   2. Observed behaviour: how often the meal was served, eaten, and rejected.
 *
 * Nothing else may decide how often a meal repeats.
 */

/**
 * The tiers, and what each one buys.
 *
 * `maxPerWeek` replaces the flat `maxDishRepeatsPerWeek: 1`. `scoreBonus` is
 * added once per placement in Tier-3 scoring, so a staple is not merely
 * *allowed* to recur — the search actively prefers it, which is what stops the
 * distinct-meal bonus from crowding favourites out.
 */
export const TIER = {
  STAPLE: 'staple',
  REGULAR: 'regular',
  OCCASIONAL: 'occasional',
  RARE: 'rare',
  EXCLUDED: 'excluded'
};

export const TIER_DEFINITIONS = Object.freeze({
  [TIER.STAPLE]: Object.freeze({
    id: TIER.STAPLE,
    label: 'Staple',
    description: 'A meal you want often. May appear up to three times a week.',
    maxPerWeek: 3,
    scoreBonus: 9,
    // Weeks that must pass before the meal may be used again. 0 = no cooldown.
    cooldownWeeks: 0,
    order: 0
  }),
  [TIER.REGULAR]: Object.freeze({
    id: TIER.REGULAR,
    label: 'Regular',
    description: 'A meal you are happy to see most weeks. Up to twice a week.',
    maxPerWeek: 2,
    scoreBonus: 4,
    cooldownWeeks: 0,
    order: 1
  }),
  [TIER.OCCASIONAL]: Object.freeze({
    id: TIER.OCCASIONAL,
    label: 'Occasional',
    description: 'The default. Once a week at most.',
    maxPerWeek: 1,
    scoreBonus: 0,
    cooldownWeeks: 0,
    order: 2
  }),
  [TIER.RARE]: Object.freeze({
    id: TIER.RARE,
    label: 'Rare',
    description: 'Served before and not eaten. Kept in rotation, but held back.',
    maxPerWeek: 1,
    scoreBonus: -6,
    cooldownWeeks: 3,
    order: 3
  }),
  [TIER.EXCLUDED]: Object.freeze({
    id: TIER.EXCLUDED,
    label: 'Excluded',
    description: 'Never planned.',
    maxPerWeek: 0,
    scoreBonus: 0,
    cooldownWeeks: 0,
    order: 4
  })
});

export const TIER_IDS = Object.freeze(
  Object.values(TIER_DEFINITIONS)
    .sort((a, b) => a.order - b.order)
    .map((definition) => definition.id)
);

export const DEFAULT_TIER = TIER.OCCASIONAL;

export const isTierId = (value) => Object.prototype.hasOwnProperty.call(TIER_DEFINITIONS, String(value));

export const tierDefinition = (tierId) => TIER_DEFINITIONS[tierId] || TIER_DEFINITIONS[DEFAULT_TIER];

// ─── Derivation thresholds ──────────────────────────────────────────────────
//
// Declared here, once, for the same reason every other threshold in this repo
// is declared once. They are deliberately conservative: promotion needs
// repeated evidence, demotion needs repeated evidence, and everything else
// stays at the default.

export const TIER_DERIVATION = Object.freeze({
  // How far back behaviour is read, in days.
  lookbackDays: 90,
  // Promotion to STAPLE.
  stapleMinEaten: 5,
  stapleMinAcceptance: 0.7,
  // Promotion to REGULAR.
  regularMinEaten: 3,
  regularMinAcceptance: 0.5,
  // Demotion to RARE: served this often, never once eaten.
  rareMinServedUneaten: 3,
  // Demotion to EXCLUDED: actively pushed away this often, never eaten.
  excludedMinRejections: 3,
  // How many confirms the user must have made ANYWHERE before "you were served
  // this and never ate it" is allowed to demote anything.
  //
  // This guard is not optional. `App.jsx` auto-confirms every planned meal on
  // every past day (`autoConfirmed: true`), so `mealHistory` cannot tell an
  // eaten meal from an assumed one — only the `confirm` *event* log can, and
  // that log is only written by the Confirm button. A user who has not been
  // pressing it looks, to the counts above, exactly like a user who dislikes
  // the entire catalog. Without this floor their first generation would demote
  // every meal they had ever been served to `rare` at once.
  //
  // Absence of evidence is not evidence of dislike. Rejections (`swap`,
  // `skip`) are deliberate acts and are exempt — they demote regardless.
  minConfirmsBeforeDemotion: 5
});

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeName = (value = '') => String(value).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Per-meal behavioural counts, the input the derivation runs on.
 *
 * The three counts answer three genuinely different questions, which the old
 * code conflated into one:
 *
 *   served   — we put it in front of you on a day that has now passed.
 *   eaten    — you confirmed it.
 *   rejected — you swapped it away or skipped it.
 *
 * `historyMap` used to be the only signal, and it could not tell these apart:
 * it counted a meal you loved and a meal you ignored identically, and applied
 * the same repeat penalty to both. Worse, `handleConfirm` wrote history
 * entries shaped `{ meal: name }` while the optimizer read `.name`, so
 * confirmed days resolved to an empty name and dropped out of the counts
 * entirely — the only days that reached the recency logic were the ones the
 * user had *not* engaged with.
 */
export const buildMealStats = ({ events = [], servedMap = {}, nowMs = Date.now(), lookbackDays } = {}) => {
  const windowDays = Number(lookbackDays ?? TIER_DERIVATION.lookbackDays);
  const cutoffMs = nowMs - windowDays * DAY_MS;
  const stats = new Map();

  const bucket = (name) => {
    const key = normalizeName(name);
    if (!key) return null;
    if (!stats.has(key)) {
      stats.set(key, { mealName: String(name).trim(), served: 0, eaten: 0, rejected: 0, lastEatenAt: null, lastServedAt: null });
    }
    return stats.get(key);
  };

  // `servedMap` is date -> slot -> meal-name: what the plan actually offered.
  for (const [dateKey, slots] of Object.entries(servedMap || {})) {
    const dayMs = Date.parse(`${dateKey}T00:00:00Z`);
    if (Number.isFinite(dayMs) && (dayMs < cutoffMs || dayMs > nowMs)) continue;
    for (const name of Object.values(slots || {})) {
      const entry = bucket(name);
      if (!entry) continue;
      entry.served += 1;
      if (!entry.lastServedAt || dateKey > entry.lastServedAt) entry.lastServedAt = dateKey;
    }
  }

  for (const event of events) {
    if (!event) continue;
    const eventMs = Date.parse(event.timestamp);
    if (Number.isFinite(eventMs) && eventMs < cutoffMs) continue;

    if (event.type === 'confirm') {
      const entry = bucket(event.mealName);
      if (!entry) continue;
      entry.eaten += 1;
      if (!entry.lastEatenAt || String(event.timestamp) > String(entry.lastEatenAt)) {
        entry.lastEatenAt = event.timestamp;
      }
    } else if (event.type === 'swap') {
      const entry = bucket(event.fromMealName);
      if (entry) entry.rejected += 1;
    } else if (event.type === 'skip') {
      const entry = bucket(event.mealName || event.previousMealName);
      if (entry) entry.rejected += 1;
    }
  }

  return stats;
};

/** Acceptance rate, with `served` floored at `eaten` so it can never exceed 1. */
export const acceptanceRate = (stat) => {
  const served = Math.max(Number(stat?.served || 0), Number(stat?.eaten || 0));
  if (served === 0) return null;
  return Number(stat?.eaten || 0) / served;
};

/**
 * The tier a meal has earned from behaviour alone, or `null` for "no opinion"
 * (which resolves to the default). Explicit overrides are applied by
 * `resolveMealTiers`, never here — this function only reads evidence.
 */
export const deriveTier = (stat, thresholds = TIER_DERIVATION, { demotionEnabled = true } = {}) => {
  if (!stat) return null;
  const eaten = Number(stat.eaten || 0);
  const served = Number(stat.served || 0);
  const rejected = Number(stat.rejected || 0);
  const rate = acceptanceRate(stat);

  // A rejection is a deliberate act, so it counts even when the user is not
  // using the Confirm button. "Served and not eaten" is not.
  if (eaten === 0 && rejected >= thresholds.excludedMinRejections) return TIER.EXCLUDED;
  if (eaten >= thresholds.stapleMinEaten && rate !== null && rate >= thresholds.stapleMinAcceptance) return TIER.STAPLE;
  if (eaten >= thresholds.regularMinEaten && rate !== null && rate >= thresholds.regularMinAcceptance) return TIER.REGULAR;
  if (demotionEnabled && eaten === 0 && served >= thresholds.rareMinServedUneaten) return TIER.RARE;
  return null;
};

/**
 * Total confirms in the window — the evidence the RARE demotion is gated on.
 * Exported so the UI can tell the user why nothing has been demoted yet.
 */
export const totalConfirms = (stats) => {
  let total = 0;
  const values = stats instanceof Map ? stats.values() : Object.values(stats || {});
  for (const stat of values) total += Number(stat?.eaten || 0);
  return total;
};

/**
 * The full per-meal tier table for one user.
 *
 * Resolution order, highest authority first:
 *   1. an explicit override the user set,
 *   2. the tier their behaviour has earned,
 *   3. the default.
 *
 * Returns a plain object keyed by the *exact* meal name, because that is what
 * the optimizer and validator index by, plus a `bySource` map so the UI can
 * show why a meal sits where it does without re-deriving anything.
 */
export const resolveMealTiers = ({
  events = [],
  servedMap = {},
  overrides = {},
  mealNames = [],
  nowMs = Date.now(),
  thresholds = TIER_DERIVATION
} = {}) => {
  const stats = buildMealStats({ events, servedMap, nowMs, lookbackDays: thresholds.lookbackDays });
  const confirms = totalConfirms(stats);
  const demotionEnabled = confirms >= Number(thresholds.minConfirmsBeforeDemotion ?? 0);
  const overrideByKey = new Map();
  for (const [name, tier] of Object.entries(overrides || {})) {
    if (isTierId(tier)) overrideByKey.set(normalizeName(name), tier);
  }

  const tiers = {};
  const sources = {};
  const names = new Set([
    ...mealNames.map((n) => String(n)),
    ...Array.from(stats.values()).map((s) => s.mealName)
  ]);

  for (const name of names) {
    if (!name) continue;
    const key = normalizeName(name);
    const override = overrideByKey.get(key);
    if (override) {
      tiers[name] = override;
      sources[name] = 'override';
      continue;
    }
    const derived = deriveTier(stats.get(key), thresholds, { demotionEnabled });
    if (derived) {
      // A tier's cooldown is applied here rather than inside the optimizer, so
      // the search never has to know about dates. A `rare` meal inside its
      // cooldown resolves to `excluded` for this generation only — it is held
      // back, not deleted, and returns on its own once the window passes.
      if (derived !== TIER.EXCLUDED && isInCooldown(name, { tiers: { [name]: derived }, stats, nowMs })) {
        tiers[name] = TIER.EXCLUDED;
        sources[name] = 'cooldown';
        continue;
      }
      tiers[name] = derived;
      sources[name] = 'derived';
      continue;
    }
    tiers[name] = DEFAULT_TIER;
    sources[name] = 'default';
  }

  return { tiers, sources, stats, confirms, demotionEnabled };
};

/** The tier assigned to `mealName`, defaulting when the table says nothing. */
export const tierOf = (mealName, tiers = {}) => {
  const direct = tiers?.[mealName];
  if (isTierId(direct)) return direct;
  return DEFAULT_TIER;
};

/** How many times `mealName` may appear in one week. */
export const maxPerWeek = (mealName, tiers = {}) => tierDefinition(tierOf(mealName, tiers)).maxPerWeek;

/** The Tier-3 bonus (or penalty) for placing `mealName`. */
export const tierScoreBonus = (mealName, tiers = {}) => tierDefinition(tierOf(mealName, tiers)).scoreBonus;

/**
 * Is this meal inside its cooldown — served recently and held back by its tier?
 *
 * Only RARE currently carries a cooldown. Expressed in whole weeks against the
 * meal's last *served* date, so a meal we keep offering and the user keeps not
 * eating stops being offered every single week without being deleted.
 */
export const isInCooldown = (mealName, { tiers = {}, stats = new Map(), nowMs = Date.now() } = {}) => {
  const definition = tierDefinition(tierOf(mealName, tiers));
  if (!definition.cooldownWeeks) return false;
  const stat = stats instanceof Map ? stats.get(normalizeName(mealName)) : stats?.[normalizeName(mealName)];
  if (!stat?.lastServedAt) return false;
  const lastMs = Date.parse(`${stat.lastServedAt}T00:00:00Z`);
  if (!Number.isFinite(lastMs)) return false;
  return nowMs - lastMs < definition.cooldownWeeks * 7 * DAY_MS;
};

/**
 * The same tier table with every repeat allowance stepped down one level.
 *
 * Returns `null` once nothing is left to soften — every tier is already at one
 * use a week or fewer — which is the signal to stop retrying.
 *
 * The week search uses this as a degradation ladder. A tier is a *preference*,
 * and a preference must never be the reason a week comes back invalid.
 * Measured: marking a breakfast a `staple` exhausted the beam on the last day,
 * because breakfast is the binding slot (18 legal options, of which R2 and the
 * `egg` family cap spend several) and three of the seven were being spent on
 * one dish. Rather than fail, the search asks for the favourite twice, then
 * once, then plans without the pull at all.
 */
export const softenTiers = (tiers) => {
  const STEP_DOWN = {
    [TIER.STAPLE]: TIER.REGULAR,
    [TIER.REGULAR]: TIER.OCCASIONAL
  };
  let changed = false;
  const next = {};
  for (const [name, tier] of Object.entries(tiers || {})) {
    const softened = STEP_DOWN[tier];
    if (softened) {
      next[name] = softened;
      changed = true;
    } else {
      next[name] = tier;
    }
  }
  return changed ? next : null;
};

/** Normalize a user-supplied override map, dropping anything unrecognised. */
export const normalizeTierOverrides = (raw = {}) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, tier] of Object.entries(raw)) {
    const key = String(name || '').trim();
    if (!key) continue;
    if (isTierId(tier)) out[key] = String(tier);
  }
  return out;
};
