#!/usr/bin/env node
/**
 * scorePlan.mjs — score a week against docs/QUALITY_RUBRIC.md v1.
 *
 * The rubric logic lives in `src/lib/planScorer.js` so the app can call it on
 * a generated week and feed the violation strings into a retry. This file is
 * the CLI over it.
 *
 *   npm run score -- path/to/plan.json
 *   npm run score -- docs/rejections/*.json
 *   npm run score -- plan.json --pin "Scrambled eggs + toast"
 *   npm run score -- plan.json --goal standard --json
 *
 * Accepted plan shapes (see `normalizePlan`):
 *   { "2026-08-03": { breakfast: {...}, lunch: {...}, dinner: {...} }, ... }
 *   { days: [{ dateKey, breakfast, lunch, dinner }] }
 *   { timestamp, plan, reason }        ← a rejection record from rejectWeek()
 */

import { readFileSync } from 'fs';
import path from 'path';
import { RUBRIC, scorePlan } from '../src/lib/planScorer.js';

const args = process.argv.slice(2);

const flagValue = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const FLAGS_WITH_VALUES = new Set(['--pin', '--goal']);
const files = args.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  const previous = args[index - 1];
  return !(previous && FLAGS_WITH_VALUES.has(previous));
});

if (files.length === 0 || hasFlag('--help')) {
  console.log(`
Score a week against the quality rubric (${RUBRIC.version}). Ship at ${RUBRIC.shipThreshold}+.

  npm run score -- <plan.json> [more.json ...] [options]

Options:
  --pin "<dish>"   Allow one dish up to ${RUBRIC.pinnedAllowance} appearances (R1).
  --goal <goal>    Ruleset for the pass/fail gates. Default: high_protein.
  --json           Emit JSON instead of the human-readable report.
  --help           This message.
`);
  process.exit(files.length === 0 ? 1 : 0);
}

const pinned = flagValue('--pin');
const goal = flagValue('--goal', 'high_protein');
const asJson = hasFlag('--json');

const readPlan = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
};

const results = [];
let failed = 0;

for (const file of files) {
  const label = path.relative(process.cwd(), file);
  try {
    // A plan may name its own pin; an explicit --pin overrides it.
    const raw = readPlan(file);
    const planPin = pinned || raw?.pinned || raw?.plan?.pinned || null;
    const result = scorePlan(raw, { goal, pinned: planPin });
    results.push({ file: label, ...result, reason: raw?.reason ?? null });
  } catch (error) {
    failed += 1;
    results.push({ file: label, error: error.message });
  }
}

if (asJson) {
  // Single file in, single object out — the rubric's documented shape.
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

const verdict = (result) => {
  if (!result.passed_gates) return '⛔ GATES FAILED';
  return result.total >= RUBRIC.shipThreshold ? '✅ SHIP' : '❌ BELOW THRESHOLD';
};

for (const result of results) {
  console.log(`\n${'─'.repeat(72)}`);

  if (result.error) {
    console.log(`${result.file}\n  ⚠️  ${result.error}`);
    continue;
  }

  console.log(`${result.file}`);
  if (result.reason) console.log(`  rejected because: "${result.reason}"`);
  console.log(
    `  ${result.total}/100   ${verdict(result)}   ` +
      `(${result.meta.dayCount} days, gates: ${result.passed_gates ? 'passed' : 'FAILED'}` +
      `${result.meta.pinned ? `, pinned: ${result.meta.pinned}` : ''})`
  );

  if (result.violations.length === 0) {
    console.log('  no rubric violations');
  } else {
    for (const violation of result.violations) console.log(`  · ${violation}`);
  }

  const { R1, R2, R3, R4, penalty } = result.breakdown;
  console.log(
    `  R1 -${R1.penalty}  R2 -${R2.penalty} (${R2.eggBreakfasts} egg breakfasts)  ` +
      `R3 -${R3.penalty}  R4 -${R4.penalty}   total -${penalty}`
  );

  if (result.meta.unresolved.length > 0) {
    console.log(`  ⚠️  ${result.meta.unresolved.length} slot(s) not in the catalog — R2/R3/R4 skip them:`);
    for (const item of result.meta.unresolved) {
      console.log(`      ${item.dateKey} ${item.slot}: "${item.name}"`);
    }
  }

  if (!result.passed_gates && result.meta.gateViolations.length > 0) {
    console.log(`  gate failures (pass/fail, not scored):`);
    for (const violation of result.meta.gateViolations.slice(0, 8)) {
      console.log(`      [tier ${violation.tier ?? '?'}] ${violation.code}: ${violation.message}`);
    }
    const extra = result.meta.gateViolations.length - 8;
    if (extra > 0) console.log(`      … and ${extra} more`);
  }
}

console.log(`\n${'─'.repeat(72)}`);
const scored = results.filter((r) => !r.error);
if (scored.length > 1) {
  const shipping = scored.filter((r) => r.passed_gates && r.total >= RUBRIC.shipThreshold).length;
  console.log(`${scored.length} weeks scored — ${shipping} at ${RUBRIC.shipThreshold}+ with gates passed\n`);
}

process.exit(failed > 0 ? 1 : 0);
