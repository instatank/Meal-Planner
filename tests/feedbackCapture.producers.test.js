import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EVENT_DEFINITIONS } from '../src/lib/feedbackSchema.js';
import { getCustomMealCandidates, createMealEvent } from '../src/lib/mealEvents.js';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/App.jsx', import.meta.url)),
  'utf8'
);

/**
 * Pull every `appendMealEvent({ ... })` literal out of App.jsx and report the
 * keys it sets.
 *
 * This is a source scan rather than a runtime test because the producers live
 * inside a 2000-line React component with no seam to call them through. The
 * thing worth guarding is narrow and static anyway: *which fields a call site
 * writes*. Finding #6 was exactly that — a consumer keyed on
 * `originalMealName` while the producer wrote `mealName`, and nothing
 * connected the two until someone read both files. This connects them.
 */
const extractProducers = (source) => {
  const producers = [];
  const marker = 'appendMealEvent({';
  let index = source.indexOf(marker);

  while (index !== -1) {
    let depth = 0;
    let cursor = index + marker.length - 1;
    let end = -1;

    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) { end = cursor; break; }
      }
    }

    if (end === -1) break;
    const body = source.slice(index + marker.length, end);

    // Top-level keys only: a nested object (none today) would otherwise leak
    // its own keys into the parent's set.
    const keys = [];
    let nesting = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (nesting === 0) {
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/);
        if (match) keys.push(match[1]);
      }
      nesting += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
    }

    const typeMatch = body.match(/type:\s*'([^']+)'/);
    if (typeMatch) producers.push({ type: typeMatch[1], keys: new Set(keys) });

    index = source.indexOf(marker, end);
  }

  return producers;
};

const producers = extractProducers(APP_SOURCE);

test('every appendMealEvent call site was found by the scanner', () => {
  const callCount = (APP_SOURCE.match(/appendMealEvent\(\{/g) || []).length;
  assert.ok(callCount > 0, 'no producers found — the scanner is broken, not the app');
  assert.equal(producers.length, callCount, 'a call site was found but its type could not be read');
});

test('every producer writes the fields its event type requires', () => {
  for (const producer of producers) {
    const definition = EVENT_DEFINITIONS[producer.type];
    assert.ok(definition, `App.jsx emits "${producer.type}" but the schema has no definition for it`);

    for (const field of definition.required) {
      assert.ok(
        producer.keys.has(field),
        `"${producer.type}" producer is missing required field "${field}"`
      );
    }

    for (const group of definition.requireOneOf || []) {
      assert.ok(
        group.some((field) => producer.keys.has(field)),
        `"${producer.type}" producer writes none of ${group.join(' / ')}`
      );
    }
  }
});

test('no producer writes a field the schema does not know about', () => {
  for (const producer of producers) {
    const definition = EVENT_DEFINITIONS[producer.type];
    const allowed = new Set([
      'type', 'id', 'timestamp', 'v',
      ...definition.required,
      ...definition.optional,
      ...(definition.requireOneOf || []).flat()
    ]);
    for (const key of producer.keys) {
      assert.ok(allowed.has(key), `"${producer.type}" producer writes unknown field "${key}"`);
    }
  }
});

test('a skip now records which meal was skipped', () => {
  // The regression this locks: before, `skip` wrote only a date and a slot,
  // so "I will not eat this" was captured without the "this".
  const skip = producers.find((p) => p.type === 'skip');
  assert.ok(skip, 'no skip producer found');
  assert.ok(skip.keys.has('mealName'), 'a skip that does not name the meal teaches nothing');
});

test('every custom producer records the raw text the promotion path keys on', () => {
  const customs = producers.filter((p) => p.type === 'custom');
  assert.ok(customs.length >= 4, `expected the four omnibox intents, found ${customs.length}`);
  for (const producer of customs) {
    assert.ok(producer.keys.has('customMealText'), 'custom event without customMealText');
    assert.ok(producer.keys.has('previousMealName'), 'custom event without the meal it displaced');
  }
});

test('custom-meal promotion detects a candidate from events the app now emits', () => {
  // End-to-end on the real consumer: three logs of the same thing, shaped the
  // way the patched producers shape them, must surface as a candidate. Run
  // against the previous shape (no customMealText) this returns nothing —
  // which is precisely what production did.
  const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const events = [3, 10, 17].map((daysAgo, i) =>
    createMealEvent({
      id: `c${i}`,
      type: 'custom',
      dateKey: at(daysAgo).slice(0, 10),
      mealType: 'dinner',
      mealName: 'Chicken shawarma bowl',
      previousMealName: 'Rajma chawal + raita',
      customMealText: 'chicken shawarma bowl',
      source: 'custom_parts',
      timestamp: at(daysAgo)
    })
  );

  const candidates = getCustomMealCandidates(events, ['Rajma chawal + raita'], { lookbackDays: 45, minCount: 3 });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].displayName, 'chicken shawarma bowl');
  assert.equal(candidates[0].count, 3);
  assert.equal(candidates[0].suggestedMealType, 'lunchDinner');
});
