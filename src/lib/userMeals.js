/**
 * Meals the user adds from the app.
 *
 * ── The problem this solves, and the one it must not create ──
 *
 * The tiering screen lets you say how often a dish should appear. The obvious
 * next thing to want is to say *that a dish exists at all* — you ate something
 * good on Sunday and it should be in the rotation. Today that requires editing
 * `mealDatabase.js`, which is not a thing the person eating the food is going
 * to do.
 *
 * The hazard is specific and already documented in CLAUDE.md, learned from
 * `buildPromotedCustomMeal`: **the optimizer trusts catalog macros
 * completely.** A meal claiming 30g of protein is planned to satisfy a 20g
 * per-meal floor and counted toward a 714g weekly floor. An invented number is
 * not an approximation, it is a week that says it hit your target and did not.
 *
 * So a meal added from the app is *not* a catalog meal. It is a **draft**, and
 * a draft is inert: it is stored, it is listed, and the planner cannot see it.
 * It becomes a catalog meal only by being resolved into real `parts[]` —
 * ingredient ids from `ingredients.js`, with quantities — at which point its
 * macros are computed by the same `buildCatalogMeal` every shipped dish goes
 * through. There is no path from "I typed a name" to "the planner counted its
 * protein" that does not pass through an ingredient rollup.
 *
 * ── The three ways a draft gets its parts ──
 *
 * 1. **Estimated** — `mealIngestService.js` asks Claude to express the dish in
 *    the existing ingredient catalog. The tool schema's `ingredientId` is an
 *    `enum` of real ids, so an invented ingredient is structurally impossible,
 *    the same guarantee the weekly plan tool gets from per-slot enums.
 * 2. **Corrected** — the estimate is shown with editable quantities, because
 *    portion size is the thing an estimate most often gets wrong and the thing
 *    the person who ate it most reliably knows.
 * 3. **Authored** — a draft that nothing can map (an unusual regional dish, a
 *    new ingredient) stays pending and is exported for a proper pass in the
 *    repo, where the ingredient can be added with a real source. That is not a
 *    failure mode, it is the intended slow path; `docs/USER_MEALS.md` §4.
 *
 * ── Why drafts are stored apart from the catalog they feed ──
 *
 * Approved meals go into `meal-user-catalog`, the store
 * `buildPromotedCustomMeal` already writes to and `mergedMealDatabase` already
 * merges. Reusing it means the planner, the tiering screen, the learner and
 * the validator all see an approved meal with no new plumbing — and, more to
 * the point, no second definition of "a meal the planner may use".
 *
 * Drafts live in `meal-drafts` instead, because a draft is not a worse meal,
 * it is a different kind of object: it has a status, it may have no macros,
 * and it is a queue with a lifecycle. Putting it in the catalog store behind a
 * flag would mean every consumer of that store has to remember the flag, and
 * exactly one of them forgetting is how a fictional 24g of protein reaches a
 * week.
 */

import { ingredients as defaultIngredients } from '../data/ingredients.js';
import { buildCatalogMeal } from './mealDataLayer.js';
import { FREQUENCY_TIER, isKnownTier } from './mealTiers.js';

/**
 * Slots a user-added meal can target.
 *
 * These are the `mealDatabase` keys, not the `meal_type` tags — the catalog
 * store is keyed by them and so is `getMealsForType`. `normalizeMealTypeTag`
 * translates when the data layer needs the tag form.
 */
export const MEAL_SLOT = Object.freeze({
  BREAKFAST: 'breakfast',
  LUNCH_DINNER: 'lunchDinner',
  SNACK: 'snack'
});

export const MEAL_SLOT_ORDER = Object.freeze([
  MEAL_SLOT.LUNCH_DINNER,
  MEAL_SLOT.BREAKFAST,
  MEAL_SLOT.SNACK
]);

export const MEAL_SLOT_LABELS = Object.freeze({
  [MEAL_SLOT.BREAKFAST]: 'Breakfast',
  [MEAL_SLOT.LUNCH_DINNER]: 'Lunch / dinner',
  [MEAL_SLOT.SNACK]: 'Snack'
});

/**
 * Lunch/dinner is the default because it is 85 of the 120 dishes in the
 * catalog and the only slot with two openings a day.
 */
export const DEFAULT_MEAL_SLOT = MEAL_SLOT.LUNCH_DINNER;

/**
 * Draft lifecycle.
 *
 * `pending` and `unresolved` are both "the planner cannot see this"; they
 * differ only in whether we have already tried. Keeping them apart is what
 * lets the screen say "not tried yet" rather than "failed", and what lets the
 * export single out the ones that genuinely need hand-authoring.
 */
export const DRAFT_STATUS = Object.freeze({
  /** Just typed. No parts yet. */
  PENDING: 'pending',
  /** Has parts that resolve against `ingredients.js`. Macros computable. */
  ESTIMATED: 'estimated',
  /** Estimation ran and could not express the dish in known ingredients. */
  UNRESOLVED: 'unresolved'
});

export const ESTIMATE_SOURCE = Object.freeze({
  NONE: '',
  AI: 'ai',
  MANUAL: 'manual'
});

/**
 * Cuisines the catalog actually uses.
 *
 * Taken from the shipped values rather than invented, because `cuisine` is the
 * one hand-authored tag left (finding #5) and it is read by the "Indian" quick
 * action, by R3's Indian-lunch rule and by the learner's `cuisine:` attribute
 * keys. A user meal tagged `Continental` instead of `continental` would be
 * invisible to all three — which is precisely the bug finding #5 was.
 */
export const CUISINE_OPTIONS = Object.freeze([
  'indian',
  'continental',
  'asian',
  'international',
  'general'
]);

export const DEFAULT_CUISINE = 'general';

/** Units `computeMacros` understands. Anything else silently weighs grams. */
export const PART_UNITS = Object.freeze(['g', 'piece', 'slice']);

/** Drafts are a queue a person works through, not a log. Bounded accordingly. */
export const MAX_DRAFTS = 200;

const trimmed = (value) => String(value ?? '').trim();

const lower = (value) => trimmed(value).toLowerCase();

const nowIso = () => new Date().toISOString();

/**
 * The key two meal names are considered "the same" under.
 *
 * Matches `normalizeCandidateKey` in App.jsx deliberately: both answer "have I
 * already got this dish?", and two different answers to that question is how
 * you end up with `Rajma chawal` and `rajma chawal!` as separate dishes, each
 * holding its own weekly cap.
 */
export const mealNameKey = (value = '') =>
  lower(value)
    .replace(/[^a-z0-9\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const slugifyMealName = (value = '') =>
  lower(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const normalizeSlot = (slot) =>
  MEAL_SLOT_ORDER.includes(slot) ? slot : DEFAULT_MEAL_SLOT;

const normalizeCuisine = (cuisine) => {
  const value = lower(cuisine);
  return CUISINE_OPTIONS.includes(value) ? value : DEFAULT_CUISINE;
};

const finitePositive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Keep only the parts that name a real ingredient with a usable quantity.
 *
 * Returns the survivors *and* what was dropped, because silently discarding a
 * part changes the dish's macros without changing how it is described — a
 * chicken curry quietly losing its chicken still reads as a chicken curry.
 * The caller surfaces `dropped`; it is never merely logged.
 */
export const resolveDraftParts = (parts = [], ingredientIndex = defaultIngredients) => {
  const kept = [];
  const dropped = [];

  for (const part of Array.isArray(parts) ? parts : []) {
    const ingredientId = trimmed(part?.ingredientId);
    const qty = finitePositive(part?.qty);
    const unit = PART_UNITS.includes(part?.unit) ? part.unit : 'g';

    if (!ingredientId || !ingredientIndex[ingredientId]?.per100g) {
      dropped.push({ ingredientId: ingredientId || '(blank)', reason: 'unknown ingredient' });
      continue;
    }
    if (qty === null) {
      dropped.push({ ingredientId, reason: 'missing or non-positive quantity' });
      continue;
    }

    kept.push({ ingredientId, qty, unit });
  }

  return { parts: kept, dropped };
};

/**
 * One draft, normalised.
 *
 * Status is *derived from the parts*, never taken on trust from the stored
 * record. A draft that arrives claiming `estimated` with an empty parts list —
 * written by an older build, hand-edited, or half-synced — would otherwise sit
 * in the queue advertising an Approve button that cannot work.
 */
export const normalizeMealDraft = (entry = {}) => {
  const name = trimmed(entry.name);
  const { parts } = resolveDraftParts(entry.parts);
  const triedEstimating =
    entry.status === DRAFT_STATUS.UNRESOLVED
    || entry.status === DRAFT_STATUS.ESTIMATED
    || Boolean(entry.estimateSource);

  const status = parts.length
    ? DRAFT_STATUS.ESTIMATED
    : triedEstimating
      ? DRAFT_STATUS.UNRESOLVED
      : DRAFT_STATUS.PENDING;

  return {
    id: trimmed(entry.id) || `draft_${slugifyMealName(name) || 'meal'}_${Date.now()}`,
    name,
    slot: normalizeSlot(entry.slot),
    cuisine: normalizeCuisine(entry.cuisine),
    // Free text, never parsed — "the one from the Sunday place", "less oil
    // than they make it". The same role the tier note and the review note
    // play, and it rides along to the backend export where a human reads it.
    note: trimmed(entry.note),
    recipeUrl: trimmed(entry.recipeUrl),
    // What the user said about frequency at the moment of adding, applied to
    // the tier map on approval. Empty means "no opinion", which is not the
    // same as `occasional` — it leaves the tier map untouched.
    tier: isKnownTier(entry.tier) ? entry.tier : '',
    parts,
    status,
    estimateSource: Object.values(ESTIMATE_SOURCE).includes(entry.estimateSource)
      ? entry.estimateSource
      : ESTIMATE_SOURCE.NONE,
    // What the estimator could not express in known ingredients. This is the
    // backend's actual work queue: each entry is a candidate ingredient.
    unmatched: (Array.isArray(entry.unmatched) ? entry.unmatched : [])
      .map(trimmed)
      .filter(Boolean),
    estimateNote: trimmed(entry.estimateNote),
    confidence: ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : '',
    createdAt: trimmed(entry.createdAt) || nowIso(),
    updatedAt: trimmed(entry.updatedAt) || trimmed(entry.createdAt) || nowIso()
  };
};

/**
 * The whole queue, normalised and de-duplicated by name.
 *
 * De-duplication is by `mealNameKey` rather than by id: two devices adding
 * "Chicken chettinad" offline produce two different ids for one dish, and the
 * merge on next boot should leave one draft, not two identical ones each with
 * its own Approve button.
 */
export const normalizeMealDraftList = (raw = []) => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];

  for (const entry of list) {
    const draft = normalizeMealDraft(entry);
    if (!draft.name) continue;
    const key = mealNameKey(draft.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }

  return out.slice(0, MAX_DRAFTS);
};

export const createMealDraft = (input = {}) =>
  normalizeMealDraft({
    ...input,
    id: `draft_${slugifyMealName(input.name) || 'meal'}_${Date.now().toString(36)}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

/**
 * Does this name already exist, as a catalog meal or as another draft?
 *
 * Adding a duplicate is not harmless: R1's weekly cap is per dish name, so two
 * records for one dish are two independent caps and the "once a week" rule
 * quietly becomes twice.
 */
export const findDuplicateName = (name, { existingNames = [], drafts = [], ignoreId = '' } = {}) => {
  const key = mealNameKey(name);
  if (!key) return null;

  for (const existing of existingNames) {
    if (mealNameKey(existing) === key) return { kind: 'catalog', name: existing };
  }
  for (const draft of drafts) {
    if (draft.id === ignoreId) continue;
    if (mealNameKey(draft.name) === key) return { kind: 'draft', name: draft.name };
  }
  return null;
};

/**
 * Turn a resolved draft into a catalog meal, or refuse.
 *
 * Refusal is the important half. `null` is returned whenever the result would
 * be a meal the optimizer trusts and shouldn't: no name, no resolvable parts,
 * or an ingredient rollup that comes out at zero calories. The caller shows
 * the reason rather than writing a placeholder — declining to add a meal costs
 * one dish, adding a fictional one costs the integrity of every week that
 * plans it.
 */
export const buildUserCatalogMeal = (draft = {}, ingredientIndex = defaultIngredients) => {
  const normalized = normalizeMealDraft(draft);
  if (!normalized.name) return { meal: null, reason: 'A meal needs a name.' };

  const { parts, dropped } = resolveDraftParts(normalized.parts, ingredientIndex);
  if (!parts.length) {
    return {
      meal: null,
      reason: 'No ingredients resolved, so its macros cannot be computed.',
      dropped
    };
  }

  const mealType = normalized.slot === MEAL_SLOT.LUNCH_DINNER
    ? 'lunch_dinner'
    : normalized.slot;

  const meal = buildCatalogMeal(
    {
      meal_id: `user_${normalized.slot}_${slugifyMealName(normalized.name)}`,
      canonical_name: normalized.name,
      display_name: normalized.name.length > 44 ? `${normalized.name.slice(0, 43)}…` : normalized.name,
      name: normalized.name,
      // Says outright where the numbers came from. `inferSourceType` reads the
      // word "assumption" out of this and drops the confidence score to 0.58,
      // which flips `needs_review` on — correct: these are portion estimates,
      // not a reference lookup, and the data layer should say so.
      nutrition_source: normalized.estimateSource === ESTIMATE_SOURCE.AI
        ? 'Ingredient rollup from AI-estimated portions (user assumption)'
        : 'Ingredient rollup from user-entered portions (user assumption)',
      assumption_version: 'user_added_v1',
      parts,
      ...(normalized.recipeUrl ? { recipe_url: normalized.recipeUrl } : {})
    },
    mealType,
    // Cuisine is hand-authored for the shipped catalog and hand-authored here
    // too — by the person who ate it. Same field, same lowercase namespace.
    { cuisine: normalized.cuisine }
  );

  if (!(Number(meal.cal) > 0)) {
    return {
      meal: null,
      reason: 'The ingredients roll up to zero calories — check the quantities.',
      dropped
    };
  }

  return {
    meal: {
      ...meal,
      isUserAdded: true,
      // Distinguishes a rollup of estimated portions from a rollup of
      // researched ones. Both are real arithmetic over real ingredients; only
      // the portion sizes are a guess, and a later pass should be able to tell
      // which meals to re-check.
      portionsEstimated: true,
      addedAt: nowIso()
    },
    reason: '',
    dropped
  };
};

/**
 * What a draft, if approved, would mean for the planner — before approving it.
 *
 * The two warnings are the ones that actually bite. A lunch/dinner dish under
 * `minMealProtein` is legal to add and can never be planned, which looks
 * exactly like the feature being broken; the tiering screen learned the same
 * lesson about thin staples. And a breakfast that is not egg-anchored competes
 * for the 3-4 slots R2 does not reserve for eggs.
 */
export const describeDraftImpact = (meal, slot, rules = null) => {
  const warnings = [];
  if (!meal) return warnings;

  const minMealProtein = Number(rules?.hard?.minMealProtein);
  if (
    slot === MEAL_SLOT.LUNCH_DINNER
    && Number.isFinite(minMealProtein)
    && Number(meal.protein) < minMealProtein
  ) {
    warnings.push(
      `${meal.protein}g protein is under the ${minMealProtein}g per-meal floor, so this can never be planned for lunch or dinner.`
    );
  }

  const calorieBounds = rules?.budgeted?.calorieBounds;
  if (Array.isArray(calorieBounds) && Number(meal.cal) > calorieBounds[1]) {
    warnings.push(
      `${meal.cal} kcal is more than a whole day's upper bound (${calorieBounds[1]}), which usually means a portion is too large.`
    );
  }

  if (meal.nutrition_metadata?.validation?.macro_calorie?.is_consistent === false) {
    warnings.push('Calories and macros disagree — worth re-checking the quantities.');
  }

  return warnings;
};

export const summarizeMealDrafts = (drafts = []) => {
  const counts = { pending: 0, estimated: 0, unresolved: 0 };
  for (const draft of drafts) counts[draft.status] = (counts[draft.status] || 0) + 1;
  return {
    total: drafts.length,
    ...counts,
    // Everything the planner still cannot see.
    waiting: counts.pending + counts.unresolved
  };
};

/**
 * The handover payload for the repo.
 *
 * Emitted from the app and read by `scripts/ingestUserMeals.mjs`, because the
 * founder has no local checkout and no admin credentials — the working path
 * between the browser and the repo is a JSON blob he can paste, the same
 * reasoning that made `generateConsolePaste.mjs` the preferred push path over
 * the admin SDK.
 *
 * Both halves travel: approved meals so they can be promoted into
 * `mealDatabase.js` permanently, and unresolved drafts because their
 * `unmatched` lists are the ingredient backlog.
 */
export const buildIngestionPayload = ({ drafts = [], userCatalog = {}, tierMap = {} } = {}) => ({
  kind: 'meal-planner/user-meals',
  version: 1,
  exportedAt: nowIso(),
  approved: MEAL_SLOT_ORDER.flatMap((slot) =>
    (userCatalog[slot] || [])
      .filter((meal) => meal?.isUserAdded)
      .map((meal) => ({
        slot,
        name: meal.name,
        cuisine: meal.cuisine || DEFAULT_CUISINE,
        parts: meal.parts || [],
        cal: meal.cal,
        protein: meal.protein,
        macros: meal.macros,
        portionsEstimated: Boolean(meal.portionsEstimated),
        macrosFromObservation: Boolean(meal.macrosFromObservation),
        recipe_url: meal.recipe_url || '',
        tier: tierMap[meal.name]?.tier || '',
        rating: tierMap[meal.name]?.rating ?? null
      }))
  ),
  drafts: drafts.map((draft) => ({
    name: draft.name,
    slot: draft.slot,
    cuisine: draft.cuisine,
    status: draft.status,
    note: draft.note,
    recipeUrl: draft.recipeUrl,
    tier: draft.tier,
    parts: draft.parts,
    unmatched: draft.unmatched,
    createdAt: draft.createdAt
  })),
  // Named so the ingestion script can fail loudly on a payload from a build
  // whose ingredient ids it does not share.
  knownIngredientCount: Object.keys(defaultIngredients).length
});

export { FREQUENCY_TIER };
