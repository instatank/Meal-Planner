#!/usr/bin/env node
/**
 * Fold meals the user added in the app into the shipped catalog.
 *
 * ── Why this is a script and not a sync ──
 *
 * A meal added in the app is already usable — it lives in `meal-user-catalog`,
 * syncs through Firestore, and the planner plans it. This script is about the
 * *other* half: promoting it into `src/data/mealDatabase.js` so it is a real
 * catalog dish with sourced nutrition, available to every device and every
 * future rebuild, and no longer carrying `portionsEstimated: true`.
 *
 * That promotion is a judgement call — are these portions right, is this
 * ingredient the right proxy, does this dish need a new ingredient with a real
 * IFCT/USDA figure behind it — so it belongs in a session with a person or an
 * agent reading it, not in an automatic write.
 *
 * ── The handover path, and why it is a paste ──
 *
 * The founder has no local checkout and no Firebase admin credentials, so the
 * two obvious routes (read Firestore from a script, or read the repo from the
 * browser) are both closed. What is open is the clipboard: the app's "Copy for
 * the database" button emits `buildIngestionPayload`, and this reads exactly
 * that. Same reasoning that makes `generateConsolePaste.mjs` the preferred
 * push path over `pushMealPlan.mjs`.
 *
 * ── Usage ──
 *
 *   node scripts/ingestUserMeals.mjs payload.json
 *   pbpaste | node scripts/ingestUserMeals.mjs
 *   node scripts/ingestUserMeals.mjs payload.json --out docs/user-meals/2026-09.md
 *
 * Output is a report plus paste-ready `baseMealsList` entries. It never edits
 * `mealDatabase.js` itself — the entries still want a human eye on the
 * portions and a `nutrition_source` that says where the numbers came from.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { ingredients } from '../src/data/ingredients.js';
import { mealDatabase } from '../src/data/mealDatabase.js';
import { buildCatalogMeal } from '../src/lib/mealDataLayer.js';
import { getRules } from '../src/lib/rules.js';
import { mealNameKey, slugifyMealName } from '../src/lib/userMeals.js';

const SLOT_TO_MEAL_TYPE = {
  breakfast: 'breakfast',
  lunchDinner: 'lunch_dinner',
  snack: 'snack'
};

const readPayload = (path) => {
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Payload is not valid JSON: ${error.message}`);
  }
  if (parsed?.kind !== 'meal-planner/user-meals') {
    throw new Error(
      `Unexpected payload kind "${parsed?.kind}". Expected the output of the app's "Copy for the database" button.`
    );
  }
  return parsed;
};

/** Every canonical name the shipped catalog already holds. */
const existingKeys = new Set(
  Object.values(mealDatabase)
    .flat()
    .map((meal) => mealNameKey(meal.canonical_name || meal.name))
);

const checkParts = (parts = []) => {
  const unknown = [];
  for (const part of parts) {
    if (!ingredients[part?.ingredientId]?.per100g) unknown.push(part?.ingredientId || '(blank)');
  }
  return unknown;
};

/**
 * Render one meal as a `baseMealsList` entry.
 *
 * `nutrition_source` deliberately still says "user-estimated portions". The
 * whole point of this pass is that somebody replaces that with a real source
 * after checking the quantities — leaving a confident-looking source string on
 * an unchecked estimate is how a guess gets laundered into a reference.
 */
const renderEntry = (meal, slot) => {
  const partsJson = meal.parts
    .map((p) => `        { "ingredientId": "${p.ingredientId}", "qty": ${p.qty}, "unit": "${p.unit}" }`)
    .join(',\n');

  return `    {
      "meal_id": "${SLOT_TO_MEAL_TYPE[slot] || slot}_${slugifyMealName(meal.name)}",
      "canonical_name": "${meal.name}",
      "display_name": "${meal.name}",
      "nutrition_source": "User-added; portions user-estimated — REPLACE with a real source after checking",
      "assumption_version": "user_added_v1",
      "name": "${meal.name}",
      "parts": [
${partsJson}
      ]
    },`;
};

const main = () => {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outPath = outIndex === -1 ? null : args[outIndex + 1];
  // Guarded against `outIndex === -1`: without it, `outIndex + 1` is 0 and the
  // positional input path — always argument 0 — is excluded as if it were the
  // value of a `--out` flag that was never passed.
  const skipIndex = outIndex === -1 ? -1 : outIndex + 1;
  const inputPath = args.find((arg, i) => !arg.startsWith('--') && i !== skipIndex) || null;

  const payload = readPayload(inputPath);
  const rules = getRules('high_protein');
  const minMealProtein = rules.hard.minMealProtein;

  const lines = [];
  const say = (line = '') => lines.push(line);

  say(`# User-added meals — ${payload.exportedAt || 'unknown export date'}`);
  say();
  say(`Approved in app: ${payload.approved.length} · still drafts: ${payload.drafts.length}`);
  if (payload.knownIngredientCount !== Object.keys(ingredients).length) {
    say();
    say(
      `> ⚠️ The export was made against ${payload.knownIngredientCount} ingredients; this checkout has `
      + `${Object.keys(ingredients).length}. Ingredient ids may not line up — check the unknown list below.`
    );
  }

  const ready = [];
  const blocked = [];

  for (const entry of payload.approved) {
    const slot = entry.slot;
    const unknown = checkParts(entry.parts);
    if (unknown.length) {
      blocked.push({ name: entry.name, why: `unknown ingredient ids: ${unknown.join(', ')}` });
      continue;
    }
    if (existingKeys.has(mealNameKey(entry.name))) {
      blocked.push({ name: entry.name, why: 'already in the shipped catalog' });
      continue;
    }

    // Rebuilt here rather than trusting the exported macros. The export came
    // from a browser that may be running an older bundle with older ingredient
    // figures; this checkout's `ingredients.js` is the authority.
    const built = buildCatalogMeal(
      { name: entry.name, canonical_name: entry.name, parts: entry.parts },
      SLOT_TO_MEAL_TYPE[slot] || slot,
      { cuisine: entry.cuisine }
    );

    ready.push({ entry, built, slot });
  }

  // ── What is ready to paste ──
  say();
  say('## Ready to add');
  if (!ready.length) {
    say();
    say('_Nothing._');
  }

  for (const slot of ['breakfast', 'lunchDinner', 'snack']) {
    const inSlot = ready.filter((r) => r.slot === slot);
    if (!inSlot.length) continue;

    say();
    say(`### \`baseMealsList.${slot}\``);
    say();
    say('```js');
    for (const { entry, built } of inSlot) say(renderEntry({ ...entry, parts: built.parts }, slot));
    say('```');
    say();
    say('| Meal | kcal | P | C | F | Fibre | Notes |');
    say('| --- | --- | --- | --- | --- | --- | --- |');
    for (const { entry, built } of inSlot) {
      const flags = [];
      if (slot === 'lunchDinner' && built.protein < minMealProtein) {
        flags.push(`**under the ${minMealProtein}g floor — will never be planned**`);
      }
      if (built.nutrition_metadata?.validation?.macro_calorie?.is_consistent === false) {
        flags.push('macro/calorie mismatch');
      }
      if (entry.portionsEstimated) flags.push('portions estimated');
      if (entry.macrosFromObservation) flags.push('macros from logged observation');
      if (entry.tier) flags.push(`user tier: ${entry.tier}`);
      say(
        `| ${entry.name} | ${built.cal} | ${built.protein} | ${built.macros.c} | ${built.macros.f} `
        + `| ${built.macros.fibre} | ${flags.join('; ') || '—'} |`
      );
    }

    say();
    say('Cuisine lines for `handAuthoredTags`:');
    say();
    say('```js');
    for (const { entry } of inSlot) say(`  "${entry.name}": { cuisine: '${entry.cuisine}' },`);
    say('```');
  }

  // ── What needs work ──
  const unresolvedDrafts = payload.drafts.filter((d) => d.status !== 'estimated');
  const estimatedDrafts = payload.drafts.filter((d) => d.status === 'estimated');

  if (blocked.length || unresolvedDrafts.length || estimatedDrafts.length) {
    say();
    say('## Needs attention');
  }

  if (blocked.length) {
    say();
    say('**Skipped:**');
    say();
    for (const item of blocked) say(`- ${item.name} — ${item.why}`);
  }

  if (estimatedDrafts.length) {
    say();
    say('**Still in the queue, but resolvable** (the user has not approved them in the app yet):');
    say();
    for (const draft of estimatedDrafts) {
      say(`- ${draft.name} (${draft.slot})${draft.note ? ` — "${draft.note}"` : ''}`);
    }
  }

  if (unresolvedDrafts.length) {
    say();
    say('**Could not be built from known ingredients** — these are the real work:');
    say();
    for (const draft of unresolvedDrafts) {
      const missing = draft.unmatched?.length ? ` · missing: ${draft.unmatched.join(', ')}` : '';
      say(`- ${draft.name} (${draft.slot})${draft.note ? ` — "${draft.note}"` : ''}${missing}`);
    }
  }

  // The ingredient backlog: every component the estimator could not express,
  // across the whole payload. Each one is a candidate `ingredients.js` entry,
  // and adding one often unblocks several dishes at once.
  const wanted = new Map();
  for (const draft of payload.drafts) {
    for (const item of draft.unmatched || []) {
      wanted.set(item.toLowerCase(), (wanted.get(item.toLowerCase()) || 0) + 1);
    }
  }
  if (wanted.size) {
    say();
    say('**Ingredients worth adding** (count = dishes blocked on each):');
    say();
    for (const [name, count] of [...wanted.entries()].sort((a, b) => b[1] - a[1])) {
      say(`- ${name} (${count})`);
    }
  }

  say();
  say('---');
  say();
  say('After pasting: run `npm run test:logic` and `npm run audit:generation`. Adding meals can only');
  say('help feasibility, but the audit is what proves the catalog still satisfies R1–R3 and the');
  say('Tier-2 budgets, and it is cheap.');

  const report = lines.join('\n');
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${report}\n`);
    console.log(`Wrote ${outPath} — ${ready.length} ready, ${blocked.length} skipped.`);
  } else {
    console.log(report);
  }
};

main();
