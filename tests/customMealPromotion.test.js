import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createMealEvent,
  getCustomMealCandidates,
  summarizeObservedMacros
} from '../src/lib/mealEvents.js';

const APP_SOURCE = readFileSync(fileURLToPath(new URL('../src/App.jsx', import.meta.url)), 'utf8');
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString();

const customLog = (i, { protein, cal, carbs = 40, fat = 12 }) =>
  createMealEvent({
    id: `e${i}`,
    type: 'custom',
    dateKey: `d${i}`,
    mealType: 'dinner',
    mealName: 'Shawarma bowl',
    customMealText: 'shawarma bowl',
    protein,
    cal,
    macros: { p: protein, c: carbs, f: fat },
    timestamp: ago(i + 1)
  });

test('a candidate carries the macros it was actually logged with', () => {
  const candidates = getCustomMealCandidates(
    [customLog(1, { protein: 38, cal: 520 }), customLog(2, { protein: 36, cal: 500 }), customLog(3, { protein: 40, cal: 540 })],
    [],
    { minCount: 3 }
  );

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].observedMacros, {
    sampleSize: 3, protein: 38, cal: 520, carbs: 40, fat: 12
  });
});

test('the median resists a fat-fingered entry, where a mean would not', () => {
  // A custom log is exactly the kind of entry that gets mistyped. A mean of
  // 38/2000/36 is 691g of protein — enough to plan a whole week around one
  // imaginary meal.
  const observed = summarizeObservedMacros([
    { protein: 38, cal: 520, carbs: 40, fat: 12 },
    { protein: 2000, cal: 99999, carbs: 40, fat: 12 },
    { protein: 36, cal: 500, carbs: 40, fat: 12 }
  ]);
  assert.equal(observed.protein, 38);
  assert.equal(observed.cal, 520);
});

test('no usable numbers means no macros, not a guess', () => {
  // The caller must be able to tell "I do not know" from "I estimated", so
  // that it can refuse instead of inventing.
  assert.equal(summarizeObservedMacros([]), null);
  assert.equal(summarizeObservedMacros([{ protein: 0, cal: 0, carbs: 0, fat: 0 }]), null);
});

test('promotion refuses a candidate it has no macros for', () => {
  // The regression this guards is subtle and was introduced by fixing the
  // capture gap. `getCustomMealCandidates` groups on `customMealText`; no
  // producer wrote it, so the candidate list was always empty and the
  // promotion button never rendered. That is the only reason a function
  // assigning every promoted meal a flat {p:24,c:42,f:14} was safe.
  //
  // Writing the field switched the path on. The optimizer trusts catalog
  // macros completely, so an invented 24g is not a placeholder — it is a meal
  // that can be planned to satisfy a protein floor it does not meet.
  assert.match(
    APP_SOURCE,
    /const buildPromotedCustomMeal = \(candidate, targetMealType\)/,
    'promotion should take the whole candidate, not just a name'
  );
  assert.match(APP_SOURCE, /if \(!observed \|\| !\(observed\.protein > 0 \|\| observed\.cal > 0\)\) return null;/);
  assert.match(APP_SOURCE, /if \(!promotedMeal\) \{/, 'the caller must handle the refusal');
  assert.doesNotMatch(APP_SOURCE, /profileByType/, 'the fabricated macro table should be gone');
  assert.doesNotMatch(
    APP_SOURCE,
    /\{ p: 24, c: 42, f: 14/,
    'the invented lunch/dinner macros should be gone'
  );
});

test('a promoted meal is flagged as derived from observation, not measured', () => {
  assert.match(APP_SOURCE, /macrosFromObservation: true/);
  assert.match(APP_SOURCE, /Median of \$\{observed\.sampleSize\} logged instances/);
});
