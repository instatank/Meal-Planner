/**
 * planScorer.js — docs/QUALITY_RUBRIC.md v1, implemented.
 *
 * A week starts at 100 and loses points for R1–R4 violations. Ship at 85+.
 *
 * This is a *scorer*, not a gate. Everything already enforced in `rules.js`
 * (protein band, calorie bounds, carb cap, anchor family caps, no duplicate
 * days) stays pass/fail and is reported separately as `passed_gates`. The
 * rubric only means anything for weeks that already cleared those gates.
 *
 * The `violations` strings are load-bearing: the rubric specifies they are
 * what a retry gets fed, so each one names the dish or the day it is about.
 * Keep them specific enough to act on without re-reading the plan.
 */

import { mealDatabase as defaultMealDatabase } from '../data/mealDatabase.js';
import { resolveWeek, validateWeek } from './planValidator.js';
import { RUBRIC_LIMITS, getRules } from './rules.js';

/**
 * Every number the rubric specifies.
 *
 * The *limits* come from `rules.js` — the optimizer enforces the same ones
 * during generation and the validator gates on them, so a second declaration
 * here is exactly the shape of drift the consistency audit catalogued. The
 * *penalties* are scorer-only and live here, because nothing else has any use
 * for them.
 */
export const RUBRIC = Object.freeze({
  version: 'v1',
  startingScore: 100,
  shipThreshold: 85,

  // R1 — no dish repeats
  repeatPenalty: 15,
  pinnedAllowance: RUBRIC_LIMITS.pinnedDishMaxPerWeek,
  unpinnedAllowance: RUBRIC_LIMITS.maxDishRepeatsPerWeek,

  // R2 — eggs 3–4 breakfasts a week
  eggPenalty: 10,
  minEggBreakfasts: RUBRIC_LIMITS.eggBreakfastsMin,
  maxEggBreakfasts: RUBRIC_LIMITS.eggBreakfastsMax,

  // R3 — Indian lunch, international dinner
  cuisinePenalty: 5,

  // R4 — one flatbread/pasta meal per day
  carbPenalty: 5
});

/**
 * A breakfast counts toward R2 when its *anchor* is an egg — the same
 * highest-protein-contributor notion the anchor-ingredient cap uses, not a
 * name match. `egg_noodles` is deliberately absent: it is a noodle.
 */
const EGG_ANCHOR_INGREDIENTS = new Set(RUBRIC_LIMITS.eggAnchorIngredients);

const CORE_SLOTS = ['breakfast', 'lunch', 'dinner'];

const lower = (value) => String(value ?? '').trim().toLowerCase();

// ─── Input normalisation ────────────────────────────────────────────────────
//
// Plans reach this scorer in more than one shape: the app writes
// `mealPlans[dateKey][slot] = { name, protein, ... }`, `rejectWeek` wraps that
// as `{ timestamp, plan, reason }`, and the optimizer/validator speak
// `[{ dateKey, breakfast, lunch, dinner }]`. All three are accepted; anything
// else is rejected loudly rather than scored on a guess.

/** The dish name out of a slot value, which may be a string or a meal object. */
export const slotName = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  const name = value.canonical_name || value.name || value.display_name;
  return name ? String(name).trim() : null;
};

/**
 * Coerce any accepted plan shape into `[{ dateKey, breakfast, lunch, dinner }]`
 * with string slot values, sorted by date.
 */
export const normalizePlan = (raw) => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Plan must be an object or an array of days.');
  }

  // `{ timestamp, plan, reason }` — a rejection record from rejectWeek().
  const source = !Array.isArray(raw) && raw.plan && typeof raw.plan === 'object' ? raw.plan : raw;

  let entries;
  if (Array.isArray(source)) {
    entries = source;
  } else if (Array.isArray(source.days)) {
    entries = source.days;
  } else {
    // `{ [dateKey]: { breakfast, lunch, dinner } }`
    entries = Object.entries(source)
      .filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === 'object')
      .map(([dateKey, day]) => ({ ...day, dateKey }));
  }

  const days = entries
    .filter((day) => day && typeof day === 'object')
    .map((day) => ({
      dateKey: day.dateKey || day.date || null,
      breakfast: slotName(day.breakfast),
      lunch: slotName(day.lunch),
      dinner: slotName(day.dinner)
    }));

  if (days.length === 0) {
    throw new Error(
      'No days found in plan. Expected { "YYYY-MM-DD": { breakfast, lunch, dinner } }, ' +
        '{ days: [...] }, or a rejection record { timestamp, plan, reason }.'
    );
  }

  return days.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
};

/** Index the catalog by every name a plan might refer to a meal by. */
const buildCatalogIndex = (mealDatabase) => {
  const index = new Map();
  const all = [
    ...(mealDatabase?.breakfast || []),
    ...(mealDatabase?.lunchDinner || []),
    ...(mealDatabase?.snack || [])
  ];
  for (const meal of all) {
    for (const key of [meal.canonical_name, meal.name, meal.display_name]) {
      if (key) index.set(lower(key), meal);
    }
  }
  return index;
};

/**
 * Attach the catalog meal to each slot where the name resolves.
 *
 * Unresolved names are kept, not dropped: a dish the catalog no longer holds
 * still occupies a slot and still repeats, so R1 must see it. Only the rules
 * needing catalog fields (R2's anchor, R3's cuisine, R4's carb_type) skip it.
 */
export const resolvePlan = (days, mealDatabase = defaultMealDatabase) => {
  const index = buildCatalogIndex(mealDatabase);
  const unresolved = [];

  const resolved = days.map((day) => {
    const entry = { dateKey: day.dateKey };
    for (const slot of CORE_SLOTS) {
      const name = day[slot];
      const meal = name ? index.get(lower(name)) || null : null;
      if (name && !meal) unresolved.push({ dateKey: day.dateKey, slot, name });
      entry[slot] = { name, meal };
    }
    return entry;
  });

  return { days: resolved, unresolved };
};

// ─── R1 — No dish repeats · −15 each ────────────────────────────────────────
//
//   violations = Σ over dishes:
//       pinned dish:      max(0, count - 3)
//       everything else:  max(0, count - 1)
//   penalty = 15 × violations

export const scoreR1 = (days, pinned = null) => {
  const pinnedKey = pinned ? lower(pinned) : null;
  const counts = new Map();

  for (const day of days) {
    for (const slot of CORE_SLOTS) {
      const name = day[slot]?.name;
      if (!name) continue;
      const key = lower(day[slot].meal?.canonical_name || name);
      const label = day[slot].meal?.canonical_name || name;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }

  const violations = [];
  let excess = 0;

  for (const [key, { label, count }] of counts) {
    const allowance = key === pinnedKey ? RUBRIC.pinnedAllowance : RUBRIC.unpinnedAllowance;
    const over = Math.max(0, count - allowance);
    if (over === 0) continue;
    excess += over;
    const suffix = key === pinnedKey ? ` — pinned, allowance ${RUBRIC.pinnedAllowance}` : '';
    violations.push(
      `R1: ${label} appears ${count}×${suffix} (-${over * RUBRIC.repeatPenalty})`
    );
  }

  return { penalty: excess * RUBRIC.repeatPenalty, violations };
};

// ─── R2 — Eggs 3–4 breakfasts a week · −10 if outside ───────────────────────
//
// A floor as well as a ceiling: one egg breakfast is as wrong as six.

export const scoreR2 = (days) => {
  const eggBreakfasts = days.filter((day) =>
    EGG_ANCHOR_INGREDIENTS.has(day.breakfast?.meal?.primary_ingredient)
  ).length;

  const outside =
    eggBreakfasts < RUBRIC.minEggBreakfasts || eggBreakfasts > RUBRIC.maxEggBreakfasts;

  if (!outside) return { penalty: 0, violations: [], eggBreakfasts };

  const direction = eggBreakfasts < RUBRIC.minEggBreakfasts ? 'below' : 'above';
  return {
    penalty: RUBRIC.eggPenalty,
    eggBreakfasts,
    violations: [
      `R2: ${eggBreakfasts} egg breakfast${eggBreakfasts === 1 ? '' : 's'} this week, ` +
        `${direction} the ${RUBRIC.minEggBreakfasts}–${RUBRIC.maxEggBreakfasts} range (-${RUBRIC.eggPenalty})`
    ]
  };
};

// ─── R3 — Indian lunch, international dinner · −5 per day ───────────────────
//
//   Indian lunch + non-Indian dinner   0
//   non-Indian lunch + Indian dinner  −5
//   both Indian, or both non-Indian   −5
//
// Only the first pattern scores zero, so this is asymmetric by design — it
// replaces the engine's symmetric "exactly one Indian across lunch+dinner".

const isIndian = (meal) => lower(meal?.cuisine) === RUBRIC_LIMITS.lunchCuisine;

export const scoreR3 = (days) => {
  const violations = [];
  let penalty = 0;

  for (const day of days) {
    const lunch = day.lunch?.meal;
    const dinner = day.dinner?.meal;
    if (!lunch || !dinner) continue;

    const lunchIndian = isIndian(lunch);
    const dinnerIndian = isIndian(dinner);
    if (lunchIndian && !dinnerIndian) continue;

    penalty += RUBRIC.cuisinePenalty;
    const pattern =
      lunchIndian && dinnerIndian
        ? 'both Indian'
        : !lunchIndian && !dinnerIndian
          ? 'neither Indian'
          : 'Indian dinner, non-Indian lunch — the wrong way round';

    violations.push(
      `R3: ${day.dateKey} — ${pattern}: lunch ${day.lunch.name}, dinner ${day.dinner.name} ` +
        `(-${RUBRIC.cuisinePenalty})`
    );
  }

  return { penalty, violations };
};

// ─── R4 — One flatbread/pasta meal per day · −5 per day ─────────────────────
//
//   penalty = 5 × days where lunch and dinner are both flatbread_pasta
//
// Soft by design: the founder's own ideal week breaks this once.

export const scoreR4 = (days) => {
  const violations = [];
  let penalty = 0;

  for (const day of days) {
    const lunch = day.lunch?.meal;
    const dinner = day.dinner?.meal;
    if (lunch?.carb_type !== 'flatbread_pasta' || dinner?.carb_type !== 'flatbread_pasta') continue;

    penalty += RUBRIC.carbPenalty;
    violations.push(
      `R4: ${day.dateKey} — flatbread/pasta at both lunch (${day.lunch.name}) and ` +
        `dinner (${day.dinner.name}) (-${RUBRIC.carbPenalty})`
    );
  }

  return { penalty, violations };
};

// ─── Gates ──────────────────────────────────────────────────────────────────

/**
 * Run the existing engine rules over the week. Pass/fail, never scored.
 *
 * A week that cannot even be resolved against the catalog fails the gates —
 * there is nothing to check protein or calories against.
 */
export const evaluateGates = ({ days, goal = 'high_protein', mealDatabase = defaultMealDatabase }) => {
  const rules = getRules(goal);
  const asNames = days.map((day) => ({
    dateKey: day.dateKey,
    breakfast: day.breakfast?.name ?? null,
    lunch: day.lunch?.name ?? null,
    dinner: day.dinner?.name ?? null
  }));

  const resolved = resolveWeek({ days: asNames, mealDatabase, rules });
  if (resolved.violations.length > 0) {
    return { passed: false, violations: resolved.violations, summary: null };
  }

  const result = validateWeek({ days: resolved.days, rules });
  return { passed: result.valid, violations: result.violations, summary: result.summary };
};

// ─── The rubric ─────────────────────────────────────────────────────────────

/**
 * Score one week.
 *
 * @returns {{ total: number, passed_gates: boolean, violations: string[] }}
 *          plus `breakdown` and `meta` for reporting. The three fields the
 *          rubric specifies come first and keep their exact names.
 */
export const scorePlan = (
  rawPlan,
  { goal = 'high_protein', pinned = null, mealDatabase = defaultMealDatabase, checkGates = true } = {}
) => {
  const normalized = normalizePlan(rawPlan);
  const { days, unresolved } = resolvePlan(normalized, mealDatabase);

  const r1 = scoreR1(days, pinned);
  const r2 = scoreR2(days);
  const r3 = scoreR3(days);
  const r4 = scoreR4(days);

  const penalty = r1.penalty + r2.penalty + r3.penalty + r4.penalty;
  const gates = checkGates ? evaluateGates({ days, goal, mealDatabase }) : null;

  return {
    // Not clamped at zero: the rubric says a week starts at 100 and loses
    // points, and how far past zero a week went is information a retry can use.
    total: RUBRIC.startingScore - penalty,
    passed_gates: gates ? gates.passed : null,
    violations: [...r1.violations, ...r2.violations, ...r3.violations, ...r4.violations],
    breakdown: { R1: r1, R2: r2, R3: r3, R4: r4, penalty },
    meta: {
      dayCount: days.length,
      pinned: pinned || null,
      unresolved,
      gateViolations: gates?.violations || [],
      shipped: RUBRIC.startingScore - penalty >= RUBRIC.shipThreshold
    }
  };
};
