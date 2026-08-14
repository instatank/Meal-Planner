import test from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePreferencesFromEvents,
  createMealEvent,
  getCustomMealOccurrenceCount,
  getUndoTargetsForSlots
} from '../src/lib/mealEvents.js';

const at = (time) => new Date(time).toISOString();

test('confirm is major upvote (+2 accept)', () => {
  const events = [
    createMealEvent({ id: 'e1', type: 'confirm', dateKey: '2026-02-17', mealType: 'lunch', mealName: 'Chicken curry + jowar roti', timestamp: at('2026-02-17T08:00:00Z') })
  ];

  const prefs = derivePreferencesFromEvents(events);
  assert.equal(prefs.accepts['Chicken curry + jowar roti'], 2);
});

test('swap only first instance per day+slot counts as downvote', () => {
  const events = [
    createMealEvent({ id: 's1', type: 'swap', dateKey: '2026-02-17', mealType: 'lunch', fromMealName: 'Meal A', toMealName: 'Meal B', timestamp: at('2026-02-17T08:00:00Z') }),
    createMealEvent({ id: 's2', type: 'swap', dateKey: '2026-02-17', mealType: 'lunch', fromMealName: 'Meal B', toMealName: 'Meal C', timestamp: at('2026-02-17T08:01:00Z') }),
    createMealEvent({ id: 's3', type: 'swap', dateKey: '2026-02-17', mealType: 'dinner', fromMealName: 'Meal X', toMealName: 'Meal Y', timestamp: at('2026-02-17T08:02:00Z') })
  ];

  const prefs = derivePreferencesFromEvents(events);
  assert.equal(prefs.avoids['Meal A'], 1.2);
  assert.equal(prefs.avoids['Meal B'] || 0, 0);
  assert.equal(prefs.avoids['Meal X'], 1.2);
});

test('edit and custom are recorded but do not move preferences', () => {
  // This test used to assert downvotes of 0.4 / 0.6 / 1.5 for these two event
  // types. Those weights are gone by decision, not by accident: all three read
  // `originalMealName` / `updatedMealName`, which no producer in App.jsx ever
  // wrote, so `customAvoid` never fired in production and the `edit` weights
  // had no event type to fire on at all. Note the `custom` event below carries
  // an `originalMealName` — a shape the app has never actually produced, which
  // is why the old assertion passed here while the signal was dead in the app.
  //
  // Both types are now captured in full (App.jsx records `previousMealName` on
  // custom events and emits real `edit` events) and interpreted by nothing,
  // until there is enough data to validate what they should mean.
  // See docs/CONSISTENCY_AUDIT.md finding #6.
  const events = [
    createMealEvent({ id: 'e1', type: 'edit', dateKey: '2026-02-17', mealType: 'dinner', originalMealName: 'Meal Old', updatedMealName: 'Meal New', timestamp: at('2026-02-17T08:00:00Z') }),
    createMealEvent({ id: 'e2', type: 'custom', dateKey: '2026-02-17', mealType: 'dinner', mealName: 'Sushi bowl', previousMealName: 'Meal Planned', timestamp: at('2026-02-17T09:00:00Z') })
  ];

  const prefs = derivePreferencesFromEvents(events);
  assert.deepEqual(prefs, { accepts: {}, avoids: {}, edits: {}, skips: {} });
});

test('undo reverses targeted event impacts', () => {
  const events = [
    createMealEvent({ id: 'c1', type: 'confirm', dateKey: '2026-02-17', mealType: 'lunch', mealName: 'Meal A', timestamp: at('2026-02-17T08:00:00Z') }),
    createMealEvent({ id: 'e1', type: 'edit', dateKey: '2026-02-17', mealType: 'lunch', originalMealName: 'Meal B', updatedMealName: 'Meal C', timestamp: at('2026-02-17T08:05:00Z') }),
    createMealEvent({ id: 'u1', type: 'undo', dateKey: '2026-02-17', mealType: 'day', undoTargets: ['c1', 'e1'], timestamp: at('2026-02-17T08:10:00Z') })
  ];

  const prefs = derivePreferencesFromEvents(events);
  assert.deepEqual(prefs, { accepts: {}, avoids: {}, edits: {}, skips: {} });
});

test('undo target lookup includes active slot events only', () => {
  const events = [
    createMealEvent({ id: 's1', type: 'swap', dateKey: '2026-02-17', mealType: 'lunch', fromMealName: 'A', toMealName: 'B', timestamp: at('2026-02-17T08:00:00Z') }),
    createMealEvent({ id: 'c1', type: 'confirm', dateKey: '2026-02-17', mealType: 'lunch', mealName: 'B', timestamp: at('2026-02-17T08:05:00Z') }),
    createMealEvent({ id: 'u1', type: 'undo', dateKey: '2026-02-17', mealType: 'day', undoTargets: ['s1'], timestamp: at('2026-02-17T08:10:00Z') }),
    createMealEvent({ id: 'c2', type: 'confirm', dateKey: '2026-02-16', mealType: 'lunch', mealName: 'Old', timestamp: at('2026-02-16T08:00:00Z') })
  ];

  const targets = getUndoTargetsForSlots(events, '2026-02-17', ['lunch']);
  assert.deepEqual(targets, ['c1']);
});

// `getCustomMealOccurrenceCount` measures its lookback window from `Date.now()`,
// so fixtures must be anchored to the current clock. Hard-coded 2026-02 dates
// passed when they were written and then silently aged out of every window.
const daysAgo = (days) => {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { iso: date.toISOString(), dateKey: date.toISOString().slice(0, 10) };
};

test('custom meal occurrence count tracks last 45 days and ignores undone customs', () => {
  const d30 = daysAgo(30);
  const d20 = daysAgo(20);
  const d10 = daysAgo(10);

  const events = [
    createMealEvent({ id: 'x1', type: 'custom', dateKey: d30.dateKey, mealType: 'dinner', customMealText: 'Sushi bowl', timestamp: d30.iso }),
    createMealEvent({ id: 'x2', type: 'custom', dateKey: d20.dateKey, mealType: 'dinner', customMealText: 'Sushi bowl', timestamp: d20.iso }),
    createMealEvent({ id: 'u1', type: 'undo', dateKey: d20.dateKey, mealType: 'day', undoTargets: ['x2'], timestamp: d20.iso }),
    createMealEvent({ id: 'x3', type: 'custom', dateKey: d10.dateKey, mealType: 'dinner', customMealText: 'SUSHI   bowl!!', timestamp: d10.iso })
  ];

  const count = getCustomMealOccurrenceCount(events, 'sushi bowl', 45);
  assert.equal(count, 2);
});

test('custom meals older than the lookback window are excluded', () => {
  const d100 = daysAgo(100);
  const d5 = daysAgo(5);

  const events = [
    createMealEvent({ id: 'old', type: 'custom', dateKey: d100.dateKey, mealType: 'dinner', customMealText: 'Sushi bowl', timestamp: d100.iso }),
    createMealEvent({ id: 'new', type: 'custom', dateKey: d5.dateKey, mealType: 'dinner', customMealText: 'Sushi bowl', timestamp: d5.iso })
  ];

  assert.equal(getCustomMealOccurrenceCount(events, 'sushi bowl', 45), 1);
  assert.equal(getCustomMealOccurrenceCount(events, 'sushi bowl', 365), 2);
});
