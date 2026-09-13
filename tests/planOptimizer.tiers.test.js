import test from 'node:test';
import assert from 'node:assert/strict';

import { mealDatabase } from '../src/data/mealDatabase.js';
import { getRules } from '../src/lib/rules.js';
import {
  buildWeekPlan,
  enumerateFeasibleDays,
  isMealAdmissible,
  scoreDayStandalone
} from '../src/lib/planOptimizer.js';
import { normalizePreferences } from '../src/lib/plannerGenerator.js';
import { TIER_DEFINITIONS, normalizeMealTierMap } from '../src/lib/mealTiers.js';

const rules = getRules('high_protein');
const WEEK = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];

const prefs = (tiers) => normalizePreferences(tiers ? { tiers: normalizeMealTierMap(tiers) } : {});
const plan = (preferences) =>
  buildWeekPlan({ mealDatabase, rules, targetDateKeys: WEEK, historyMap: {}, preferences });
const namesOf = (week) => week.days.flatMap((d) => [d.breakfast?.name, d.lunch?.name, d.dinner?.name]).filter(Boolean);

const candidates = enumerateFeasibleDays({ mealDatabase, rules, preferences: prefs() });

// ─── The guarantee ──────────────────────────────────────────────────────────

test('an untiered catalog scores bit-for-bit as it did before tiers existed', () => {
  const bare = prefs();
  const empty = prefs({});
  for (const day of candidates.slice(0, 500)) {
    const a = scoreDayStandalone(day, { rules, preferences: bare });
    const b = scoreDayStandalone(day, { rules, preferences: empty });
    assert.equal(Object.is(a, b), true, `scores diverged: ${a} vs ${b}`);
  }
});

test('a map of nothing-but-defaults changes neither score nor week', () => {
  // A user who opens the tiering screen, looks around and sets everything to
  // the default must get the week they would have got without opening it.
  const allDefault = Object.fromEntries(
    [...mealDatabase.breakfast, ...mealDatabase.lunchDinner].map((m) => [m.name, { tier: 'occasional' }])
  );

  const before = plan(prefs());
  const after = plan(prefs(allDefault));
  assert.deepEqual(namesOf(after), namesOf(before));
  assert.deepEqual(after.summary, before.summary);
});

// ─── Retirement gates ───────────────────────────────────────────────────────

test('a retired dish is inadmissible, not merely unpopular', () => {
  const victim = mealDatabase.lunchDinner[0];
  const retired = prefs({ [victim.name]: { tier: 'retired' } });

  assert.equal(isMealAdmissible(victim, { rules, preferences: prefs() }), true);
  assert.equal(isMealAdmissible(victim, { rules, preferences: retired }), false);
});

test('a retired dish never reaches a generated week', () => {
  const victim = mealDatabase.lunchDinner.find((m) => namesOf(plan(prefs())).includes(m.name));
  assert.ok(victim, 'need a dish the planner actually picks');

  const week = plan(prefs({ [victim.name]: { tier: 'retired' } }));
  assert.ok(!namesOf(week).includes(victim.name), `${victim.name} survived retirement`);
  assert.equal(week.days.length, 7, 'the week must still be complete');
});

test('retiring the whole catalog is reported, not silently fudged', () => {
  // The one edit here that can make the rules unsatisfiable. It has to surface
  // as infeasible rather than as a quietly broken week.
  const everything = Object.fromEntries(
    [...mealDatabase.breakfast, ...mealDatabase.lunchDinner, ...mealDatabase.snack]
      .map((m) => [m.name, { tier: 'retired' }])
  );
  const week = plan(prefs(everything));
  assert.equal(week.feasible, false);
});

// ─── Staples actually recur ─────────────────────────────────────────────────

test('a staple is allowed past the one-a-week cap, and takes it', () => {
  // Both halves matter. The cap alone leaves the variety bonus winning every
  // time, so this asserts the dish is used more than once — not merely that it
  // legally could be.
  const week = plan(prefs());
  const target = mealDatabase.lunchDinner.find((m) => namesOf(week).includes(m.name));
  assert.ok(target);

  const before = namesOf(week).filter((n) => n === target.name).length;
  assert.equal(before, 1, 'R1 should cap an untiered dish at one use');

  const stapled = namesOf(plan(prefs({ [target.name]: { tier: 'staple' } })));
  const after = stapled.filter((n) => n === target.name).length;
  assert.ok(after > 1, `staple used ${after} time(s) — the repeat penalty is still winning`);
  assert.ok(
    after <= TIER_DEFINITIONS.staple.maxPerWeek,
    `staple used ${after} times, over its cap of ${TIER_DEFINITIONS.staple.maxPerWeek}`
  );
});

test('a staple still cannot break the rules it is not exempt from', () => {
  const week = plan(prefs());
  const target = mealDatabase.lunchDinner.find((m) => namesOf(week).includes(m.name));
  const stapled = plan(prefs({ [target.name]: { tier: 'staple' } }));

  assert.equal(stapled.days.length, 7);
  assert.equal(stapled.feasible, true);
  const floor = rules.dailyProteinTarget * WEEK.length * rules.hard.weeklyProteinFloorRatio;
  assert.ok(stapled.summary.totalProtein >= floor, `protein floor breached: ${stapled.summary.totalProtein} < ${floor}`);
  // No day may carry the same dish twice, staple or not.
  for (const day of stapled.days) {
    const slots = [day.breakfast?.name, day.lunch?.name, day.dinner?.name].filter(Boolean);
    assert.equal(new Set(slots).size, slots.length, 'a dish appeared twice in one day');
  }
});

// ─── Ratings rank ───────────────────────────────────────────────────────────

test('a rating moves a day by exactly (rating - 3) x its weight', () => {
  // No hidden multipliers: the number in rules.js is the whole effect.
  const day = candidates.find((d) => d.lunch?.name);
  const base = scoreDayStandalone(day, { rules, preferences: prefs() });

  const loved = scoreDayStandalone(day, { rules, preferences: prefs({ [day.lunch.name]: { rating: 5 } }) });
  const hated = scoreDayStandalone(day, { rules, preferences: prefs({ [day.lunch.name]: { rating: 1 } }) });

  assert.equal(Number((loved - base).toFixed(6)), Number((2 * rules.scored.mealRatingWeight).toFixed(6)));
  assert.equal(Number((base - hated).toFixed(6)), Number((2 * rules.scored.mealRatingWeight).toFixed(6)));
});

test('a neutral rating is the same as no rating at all', () => {
  const day = candidates.find((d) => d.lunch?.name);
  const base = scoreDayStandalone(day, { rules, preferences: prefs() });
  const neutral = scoreDayStandalone(day, { rules, preferences: prefs({ [day.lunch.name]: { rating: 3 } }) });
  assert.equal(Object.is(base, neutral), true);
});

test('a rating outranks an inferred preference of the same size', () => {
  // An explicit statement should beat something guessed from behaviour.
  assert.ok(rules.scored.mealRatingWeight > rules.scored.learnedDishWeight);
});

// ─── The legacy pin ─────────────────────────────────────────────────────────

test('the legacy pinned dish can only loosen a tier, never tighten it', () => {
  // Pinning predates tiers. Pinning a dish the user marked `rare` must not
  // quietly raise it to 3 uses, and pinning one they marked `staple` must not
  // quietly lower it.
  const target = mealDatabase.lunchDinner[0];
  const pinnedRare = buildWeekPlan({
    mealDatabase, rules, targetDateKeys: WEEK, historyMap: {},
    preferences: prefs({ [target.name]: { tier: 'rare' } }),
    pinnedDish: target.name
  });
  const uses = namesOf(pinnedRare).filter((n) => n === target.name).length;
  assert.ok(uses <= rules.hard.pinnedDishMaxPerWeek);
  assert.equal(pinnedRare.days.length, 7);
});

test('a staple actually recurs across most of the catalog, not just in theory', () => {
  // The honest regression guard for this feature. Three earlier designs all
  // passed a single-dish test while doing essentially nothing in aggregate:
  // discounting the repeat penalty (staples never repeated, because a repeat
  // also forgoes `distinctMealBonus`), raising the cap (the dish was not in
  // the trimmed pool often enough to repeat), and paying repeats a bonus
  // (the dish never scored well enough to be chosen at all). Only a sweep
  // over the whole catalog catches that, so the sweep is the test.
  let appeared = 0;
  let repeated = 0;
  let infeasible = 0;

  for (const meal of mealDatabase.lunchDinner) {
    const week = plan(prefs({ [meal.name]: { tier: 'staple' } }));
    if (!week.feasible) infeasible += 1;
    const uses = namesOf(week).filter((n) => n === meal.name).length;
    if (uses > 0) appeared += 1;
    if (uses > 1) repeated += 1;
  }

  const total = mealDatabase.lunchDinner.length;
  // Zero is the non-negotiable one: turning tiering on must never cost a
  // feasible week, because the fallback is the untiered search itself.
  assert.equal(infeasible, 0, `${infeasible} dishes made the week infeasible when marked staple`);
  assert.ok(appeared / total > 0.6, `only ${appeared}/${total} staples appeared at all`);
  assert.ok(repeated / total > 0.45, `only ${repeated}/${total} staples actually recurred`);
});

test('the candidate pool reserves room for dishes the user elevated', () => {
  // The measurement behind the reservation pass: of 23,688 enumerated days
  // only 300 survive the trim, and the median lunch/dinner dish appears in 2
  // of them — 31 of 75 in none at all. A dish in one pooled day can be planned
  // once whatever its score, because no day may repeat inside a week. No
  // amount of scoring fixes that; only pool composition does.
  const poorlyRanked = mealDatabase.lunchDinner.filter(
    (m) => !namesOf(plan(prefs())).includes(m.name)
  );
  assert.ok(poorlyRanked.length > 0, 'need a dish the planner does not pick by default');

  const target = poorlyRanked[0];
  const stapled = namesOf(plan(prefs({ [target.name]: { tier: 'staple' } })));
  const base = namesOf(plan(prefs()));
  assert.notDeepEqual(stapled, base, 'elevating an unpicked dish should change the week');
});

test('a high rating alone earns pool room, without any tier change', () => {
  // `hasTierEffects` is false for a ratings-only map, so reservations are
  // built from the full map rather than from that gate. A dish rated 5 and
  // left at the default tier must still be reachable.
  const unpicked = mealDatabase.lunchDinner.find((m) => !namesOf(plan(prefs())).includes(m.name));
  assert.ok(unpicked);
  const rated = namesOf(plan(prefs({ [unpicked.name]: { rating: 5 } })));
  assert.notDeepEqual(rated, namesOf(plan(prefs())));
});

test('a rare dish is pushed away from the week, not merely capped', () => {
  const week = plan(prefs());
  const target = mealDatabase.lunchDinner.find((m) => namesOf(week).includes(m.name));
  const rare = namesOf(plan(prefs({ [target.name]: { tier: 'rare' } })));
  assert.ok(rare.filter((n) => n === target.name).length <= 1);
  assert.notDeepEqual(rare, namesOf(week), 'a rare tier should change the week it appeared in');
});

test('tier definitions are deep-frozen — they are read in the hot loop', () => {
  // A stray write would change every future week with nothing to show where
  // it came from. Shallow Object.freeze leaves the inner numbers writable.
  assert.throws(() => { TIER_DEFINITIONS.staple.maxPerWeek = 99; }, TypeError);
  assert.equal(TIER_DEFINITIONS.staple.maxPerWeek, 3);
});
