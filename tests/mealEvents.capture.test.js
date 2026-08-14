/**
 * mealEvents.capture.test.js — custom, edit and skip are recorded, and none of
 * them move preferences.
 *
 * Covers finding #6 of docs/CONSISTENCY_AUDIT.md, at the restricted scope the
 * founder set: data capture only, no signal wiring.
 *
 * The finding was that "which meal an event refers to" lived under five field
 * names, and the producer and consumer disagreed about *which meal* they meant.
 * `derivePreferencesFromEvents` read `originalMealName` on a `custom` event —
 * the meal that was displaced — while App.jsx recorded only `mealName`, the
 * meal that was eaten. Pointing the consumer at the field that existed would
 * have inverted the rule, penalising the meal the user just chose.
 *
 * So the displaced meal is now captured as `previousMealName`, `edit` events
 * gain the producer they never had, and the three weights that consumed them
 * are deleted rather than rewired. Interpretation is deferred until there is
 * enough recorded data to validate it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVENT_WEIGHTS, derivePreferencesFromEvents } from '../src/lib/mealEvents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8');

/** Every appendMealEvent({...}) payload in App.jsx, as { type, fields }. */
const producedEvents = () => {
  const found = [];
  for (const match of appSource.matchAll(/appendMealEvent\(\{([\s\S]*?)\n\s*\}\)/g)) {
    const body = match[1];
    const type = body.match(/type:\s*'([^']+)'/)?.[1];
    // Matches `key: value` and bare shorthand (`previousMealName`) alike.
    const fields = [...body.matchAll(/^\s{6,}(\w+)\s*(?::|,?\s*$)/gm)].map((m) => m[1]);
    if (type) found.push({ type, fields });
  }
  return found;
};

const isEmpty = (preferences) =>
  ['accepts', 'avoids', 'edits', 'skips'].every((bucket) => Object.keys(preferences[bucket]).length === 0);

// ─── Producer: the displaced meal is recorded ───────────────────────────────

test('every custom event records the meal it displaced', () => {
  const customEvents = producedEvents().filter((event) => event.type === 'custom');

  assert.equal(customEvents.length, 4, 'expected the four custom-event call sites in handleAIAction');

  for (const event of customEvents) {
    assert.ok(
      event.fields.includes('mealName'),
      'a custom event should still record the meal that was logged'
    );
    assert.ok(
      event.fields.includes('previousMealName'),
      'a custom event should record the meal it displaced — the consumer wanted this and it was never captured'
    );
  }
});

test('edit events have a producer', () => {
  const editEvents = producedEvents().filter((event) => event.type === 'edit');

  assert.ok(editEvents.length > 0, 'no call site emits an `edit` event');

  for (const event of editEvents) {
    assert.ok(event.fields.includes('originalMealName'), 'an edit should record what was replaced');
    assert.ok(event.fields.includes('updatedMealName'), 'an edit should record what replaced it');
  }
});

test('skip events are still emitted', () => {
  assert.ok(
    producedEvents().some((event) => event.type === 'skip'),
    'skip events should keep being recorded even though they carry no weight'
  );
});

// ─── Consumer: none of the three influence preferences ──────────────────────

test('the weights that consumed custom and edit events are gone', () => {
  assert.ok(!('customAvoid' in EVENT_WEIGHTS), 'customAvoid should be deleted, not rewired');
  assert.ok(!('editAvoid' in EVENT_WEIGHTS), 'editAvoid should be deleted, not rewired');
  assert.ok(!('editAccept' in EVENT_WEIGHTS), 'editAccept should be deleted, not rewired');
});

test('custom, edit and skip events do not move preferences, even fully populated', () => {
  const events = [
    {
      id: 'evt_custom',
      type: 'custom',
      dateKey: '2026-08-17',
      mealType: 'dinner',
      timestamp: '2026-08-17T12:00:00.000Z',
      mealName: 'Leftover biryani',
      previousMealName: 'Grilled fish + pumpkin salad'
    },
    {
      id: 'evt_edit',
      type: 'edit',
      dateKey: '2026-08-17',
      mealType: 'lunch',
      timestamp: '2026-08-17T13:00:00.000Z',
      originalMealName: 'Paneer tikka + jowar roti + salad',
      updatedMealName: 'Chicken shawarma bowl'
    },
    {
      id: 'evt_skip',
      type: 'skip',
      dateKey: '2026-08-17',
      mealType: 'breakfast',
      timestamp: '2026-08-17T14:00:00.000Z',
      mealName: 'Anda bhurji + toast'
    }
  ];

  const preferences = derivePreferencesFromEvents(events);

  assert.ok(
    isEmpty(preferences),
    `custom/edit/skip should be inert, got ${JSON.stringify(preferences)}`
  );
});

// ─── Guard: the two signals that DO work must keep working ──────────────────

test('confirm and swap still move preferences', () => {
  const confirmed = derivePreferencesFromEvents([
    {
      id: 'evt_confirm',
      type: 'confirm',
      dateKey: '2026-08-17',
      mealType: 'dinner',
      timestamp: '2026-08-17T12:00:00.000Z',
      mealName: 'Prawn curry + rice'
    }
  ]);
  assert.equal(confirmed.accepts['Prawn curry + rice'], EVENT_WEIGHTS.confirmAccept);

  const swapped = derivePreferencesFromEvents([
    {
      id: 'evt_swap',
      type: 'swap',
      dateKey: '2026-08-17',
      mealType: 'lunch',
      timestamp: '2026-08-17T12:00:00.000Z',
      fromMealName: 'Aloo paratha + curd',
      toMealName: 'Tuna Nicoise salad'
    }
  ]);
  assert.equal(swapped.avoids['Aloo paratha + curd'], EVENT_WEIGHTS.swapAvoidFirst);
});
