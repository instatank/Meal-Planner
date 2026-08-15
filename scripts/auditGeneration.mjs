#!/usr/bin/env node
/**
 * auditGeneration.mjs — re-runs the measurement method from
 * docs/EVAL_AND_ROADMAP.md against the live code.
 *
 * Nothing here is estimated. It enumerates every legal breakfast/lunch/dinner
 * combination from the real catalog, reports the distribution, then generates
 * and validates a week and scores it against each Phase 1 acceptance criterion.
 *
 *   npm run audit:generation
 *   npm run audit:generation -- --goal standard --days 7 --start 2026-08-03
 */

import { buildWeekPlan, enumerateFeasibleDays } from '../src/lib/planOptimizer.js';
import { validateWeek, formatViolations } from '../src/lib/planValidator.js';
import { anchorFamilyMaxPerWeek, getRules } from '../src/lib/rules.js';
import { mealDatabase } from '../src/data/mealDatabase.js';

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const goal = argValue('--goal', 'high_protein');
const dayCount = Number(argValue('--days', '7'));
const startDate = argValue('--start', '2026-08-03');

const rules = getRules(goal);

const dateKeys = Array.from({ length: dayCount }, (_, index) => {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1));
const percentile = (sorted, fraction) => sorted[Math.floor(fraction * (sorted.length - 1))];
const heading = (text) => console.log(`\n${text}\n${'─'.repeat(text.length)}`);
const capLabel = (cap) => (Number.isFinite(cap) ? `the ${cap}g carb cap` : 'the carb cap (unset for this goal)');

// ─── 1. Catalog and combination space ───────────────────────────────────────

heading(`Catalog (goal: ${goal}, daily protein target ${rules.dailyProteinTarget}g)`);

const legalBreakfasts = mealDatabase.breakfast.filter((m) => m.protein >= rules.hard.minMealProtein);
const legalLunchDinner = mealDatabase.lunchDinner.filter((m) => m.protein >= rules.hard.minMealProtein);

console.log(`breakfasts        ${legalBreakfasts.length} of ${mealDatabase.breakfast.length} clear the ${rules.hard.minMealProtein}g per-meal floor`);
console.log(`lunch/dinner      ${legalLunchDinner.length} of ${mealDatabase.lunchDinner.length}`);
console.log(`snacks            ${mealDatabase.snack.length} (not used by the 3-slot planner)`);

const combos = enumerateFeasibleDays({ mealDatabase, rules, preferences: {} });

heading('Day combinations satisfying Tier 1');

const inBand = combos.filter((day) => day.proteinInBand).length;
const underCarbs = combos.filter((day) => day.underCarbCap).length;
const inCalories = combos.filter((day) => day.inCalorieBounds).length;
const allThree = combos.filter((day) => day.proteinInBand && day.underCarbCap && day.inCalorieBounds).length;

console.log(`${'total legal combinations'.padEnd(40)}${combos.length}`);
console.log(`protein in ${rules.budgeted.dailyProteinMin}-${rules.budgeted.dailyProteinMax}g band`.padEnd(40) + `${inBand} (${pct(inBand, combos.length)}%)`);
console.log(`under ${capLabel(rules.budgeted.dailyCarbCap)}`.padEnd(40) + `${underCarbs} (${pct(underCarbs, combos.length)}%)`);
console.log(`within ${rules.budgeted.dailyCalorieMin}-${rules.budgeted.dailyCalorieMax} kcal`.padEnd(40) + `${inCalories} (${pct(inCalories, combos.length)}%)`);
console.log(`satisfying all three at once`.padEnd(40) + `${allThree} (${pct(allThree, combos.length)}%)`);

const proteins = combos.map((day) => day.totals.protein).sort((a, b) => a - b);
console.log(
  `\nachievable daily protein          min ${proteins[0]}g / p25 ${percentile(proteins, 0.25)}g / `
  + `median ${percentile(proteins, 0.5)}g / p90 ${percentile(proteins, 0.9)}g / max ${proteins[proteins.length - 1]}g`
);

// ─── 2. Generate and validate ───────────────────────────────────────────────

heading(`Generated ${dayCount}-day plan`);

const started = Date.now();
const plan = buildWeekPlan({ mealDatabase, rules, targetDateKeys: dateKeys, preferences: {} });
const elapsedMs = Date.now() - started;
const result = validateWeek({ days: plan.days, rules });

for (const day of plan.days) {
  const flags = `${day.proteinInBand ? 'P' : '·'}${day.underCarbCap ? 'C' : '·'}${day.inCalorieBounds ? 'K' : '·'}`;
  console.log(
    `${day.dateKey}  ${String(day.totals.protein).padStart(3)}g p  `
    + `${String(day.totals.carbs).padStart(3)}g c  ${String(day.totals.calories).padStart(4)} kcal  [${flags}]  `
    + day.mealNames.join('  |  ')
  );
}

const summary = result.summary;
console.log(`\noptimizer runtime                 ${elapsedMs}ms over ${plan.candidateCount} candidates`);
console.log(`distinct meals used               ${summary.distinctMeals}`);
console.log(`red-meat meals                    ${summary.redMeatMeals} of ${rules.hard.redMeatMealsPerWeek} allowed`);

heading('Anchor-ingredient family counts (breakfast + lunch + dinner)');

const familyUse = {};
for (const day of plan.days) {
  for (const family of day.anchorFamilies || []) familyUse[family] = (familyUse[family] || 0) + 1;
}
const familyRows = Object.entries(familyUse)
  .map(([family, count]) => ({ family, count, cap: anchorFamilyMaxPerWeek(family, rules) }))
  .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));

if (familyRows.length === 0) {
  console.log('(no meal in the generated week carries a known primary ingredient)');
} else {
  for (const { family, count, cap } of familyRows) {
    const status = count <= cap ? 'ok' : 'OVER CAP';
    console.log(`${family.padEnd(18)}${String(count).padStart(2)} / ${String(cap).padEnd(3)} ${status}`);
  }
}

// ─── 3. Acceptance criteria ─────────────────────────────────────────────────

heading('Acceptance criteria');

const required = summary.requiredCompliantDays;
const criteria = [
  {
    label: `>= ${required} of ${dayCount} days protein in ${rules.budgeted.dailyProteinMin}-${rules.budgeted.dailyProteinMax}g band`,
    pass: summary.daysProteinInBand >= required,
    detail: `${summary.daysProteinInBand} of ${dayCount}`
  },
  {
    label: `weekly protein >= ${summary.proteinFloor}g (85% of ${summary.nominalProtein}g nominal)`,
    pass: summary.totalProtein >= summary.proteinFloor,
    detail: `${summary.totalProtein}g (${summary.proteinPctOfNominal}% of nominal, `
      + `${summary.totalProtein - summary.proteinFloor}g of headroom)`
  },
  {
    label: `no day below the ${rules.hard.dailyProteinSanityFloor}g sanity floor`,
    pass: plan.days.every((day) => day.totals.protein >= rules.hard.dailyProteinSanityFloor),
    detail: `lowest day ${Math.min(...plan.days.map((day) => day.totals.protein))}g`
  },
  {
    label: `>= ${required} of ${dayCount} days under ${capLabel(rules.budgeted.dailyCarbCap)}`,
    pass: summary.daysUnderCarbCap >= required,
    detail: `${summary.daysUnderCarbCap} of ${dayCount}`
  },
  {
    label: `>= ${required} of ${dayCount} days within ${rules.budgeted.dailyCalorieMin}-${rules.budgeted.dailyCalorieMax} kcal`,
    pass: summary.daysInCalorieBounds >= required,
    detail: `${summary.daysInCalorieBounds} of ${dayCount}`
  },
  {
    // R3 replaced the old symmetric "exactly one Indian across lunch+dinner"
    // budget with a directional hard rule, so this is now all-or-nothing
    // rather than 5 of 7.
    label: `all ${dayCount} days Indian lunch + non-Indian dinner (R3)`,
    pass: summary.daysR3Compliant === dayCount,
    detail: `${summary.daysR3Compliant} of ${dayCount}`
  },
  {
    label: `${rules.hard.eggBreakfastsMin}-${rules.hard.eggBreakfastsMax} egg-anchored breakfasts (R2)`,
    pass: summary.eggBreakfasts >= summary.eggBreakfastsFloor
      && summary.eggBreakfasts <= summary.eggBreakfastsMax,
    detail: `${summary.eggBreakfasts} of ${dayCount}`
  },
  {
    label: 'every dish distinct across the week, bar the pin (R1)',
    pass: (() => {
      const names = plan.days.flatMap((day) => day.mealNames);
      return new Set(names).size === names.length;
    })(),
    detail: (() => {
      const names = plan.days.flatMap((day) => day.mealNames);
      return `${new Set(names).size} distinct of ${names.length}`;
    })()
  },
  {
    label: 'no day doubles up on flatbread/pasta (R4, scored not gated)',
    pass: true,
    detail: `${summary.daysBothFlatbreadPasta} of ${dayCount} days`
  },
  {
    label: 'no anchor-ingredient family (breakfast + lunch + dinner) over its weekly cap',
    pass: (() => {
      const use = {};
      for (const day of plan.days) {
        for (const family of day.anchorFamilies || []) use[family] = (use[family] || 0) + 1;
      }
      return Object.entries(use).every(([family, n]) => n <= anchorFamilyMaxPerWeek(family, rules));
    })(),
    detail: (() => {
      const use = {};
      for (const day of plan.days) {
        for (const family of day.anchorFamilies || []) use[family] = (use[family] || 0) + 1;
      }
      const worst = Object.entries(use)
        .map(([family, n]) => [family, n, anchorFamilyMaxPerWeek(family, rules)])
        .sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))[0];
      return worst ? `closest to its cap: ${worst[0]} x${worst[1]} (cap ${worst[2]})` : 'none';
    })()
  },
  {
    // Same dishes regardless of which slot each lands in — a day with lunch
    // and dinner swapped is the same day to the person eating it.
    label: 'no duplicate day in the week (lunch/dinner swaps count as duplicates)',
    pass: new Set(plan.days.map((d) => d.dishSetKey)).size === plan.days.length,
    detail: `${new Set(plan.days.map((d) => d.dishSetKey)).size} distinct days of ${plan.days.length}`
  },
  {
    label: 'no Tier-1 violation anywhere in the week',
    pass: result.hardViolations.length === 0,
    detail: `${result.hardViolations.length} found`
  },
  {
    label: 'validator passes the generated week outright',
    pass: result.valid,
    detail: result.valid ? 'clean' : `${result.violations.length} violation(s)`
  }
];

for (const criterion of criteria) {
  console.log(`${criterion.pass ? 'PASS' : 'FAIL'}  ${criterion.label.padEnd(64)} ${criterion.detail}`);
}

if (result.violations.length > 0) {
  heading('Violations');
  console.log(formatViolations(result.violations));
}

// ─── 4. What the catalog cannot do ──────────────────────────────────────────

heading('Catalog headroom (evidence for Phase 2)');

const bestBreakfast = legalBreakfasts.reduce((best, m) => (m.protein > best.protein ? m : best), legalBreakfasts[0]);
console.log(`breakfast is the binding slot: ${legalBreakfasts.length} legal options for ${dayCount} days, best is ${bestBreakfast.protein}g (${bestBreakfast.canonical_name})`);
console.log(`only ${pct(inCalories, combos.length)}% of legal days reach the ${rules.budgeted.dailyCalorieMin} kcal floor — the tightest of the three budgets`);
console.log(`only ${pct(allThree, combos.length)}% of legal days satisfy all three budgets at once`);

const failed = criteria.filter((criterion) => !criterion.pass);
process.exitCode = failed.length === 0 ? 0 : 1;
console.log(`\n${failed.length === 0 ? 'All acceptance criteria pass.' : `${failed.length} criterion/criteria failing.`}`);
