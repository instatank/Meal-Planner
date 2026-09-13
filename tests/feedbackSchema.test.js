import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_DEFINITIONS,
  EVENT_TYPE,
  FEEDBACK_SCHEMA_VERSION,
  MAX_RETAINED_EVENTS,
  PLAN_REVIEW_REASONS,
  PLAN_REVIEW_REASON_BY_ID,
  RATING_NEUTRAL,
  validateEvent
} from '../src/lib/feedbackSchema.js';
import { createMealEvent, inspectMealEvent, trimEventLog } from '../src/lib/mealEvents.js';

test('every event type produced by the app has a definition', () => {
  // The list the app actually emits. A producer added without a definition
  // means a signal nobody can interpret, which is how `edit` and `custom`
  // went uninterpreted for months.
  const produced = [
    'confirm', 'skip', 'swap', 'edit', 'custom',
    'custom_promoted', 'undo', 'regen', 'plan_review', 'legacy_import'
  ];
  for (const type of produced) {
    assert.ok(EVENT_DEFINITIONS[type], `no definition for "${type}"`);
  }
});

test('createMealEvent stamps the schema version', () => {
  const event = createMealEvent({ type: EVENT_TYPE.CONFIRM, dateKey: '2026-09-01', mealType: 'lunch', mealName: 'X' });
  assert.equal(event.v, FEEDBACK_SCHEMA_VERSION);
  assert.ok(event.id.startsWith('evt_'));
});

test('a well-formed event of each type validates', () => {
  const samples = {
    confirm: { dateKey: 'd', mealType: 'lunch', mealName: 'A' },
    skip: { dateKey: 'd', mealType: 'lunch', mealName: 'A' },
    swap: { dateKey: 'd', mealType: 'lunch', fromMealName: 'A', toMealName: 'B' },
    edit: { dateKey: 'd', mealType: 'lunch', originalMealName: 'A', updatedMealName: 'B' },
    custom: { dateKey: 'd', mealType: 'lunch', mealName: 'A', previousMealName: 'B' },
    custom_promoted: { customMealText: 'sushi', promotedMealName: 'Sushi' },
    undo: { dateKey: 'd', undoTargets: ['e1'] },
    regen: { dateKey: 'd' },
    plan_review: { weekStartKey: '2026-09-07', verdict: 'accepted', rating: 4 },
    legacy_import: {}
  };

  for (const [type, payload] of Object.entries(samples)) {
    const result = inspectMealEvent(createMealEvent({ type, ...payload }));
    assert.ok(result.valid, `${type} should validate, got: ${result.issues.join('; ')}`);
  }
});

test('a missing required field is reported, not thrown', () => {
  const result = validateEvent({ type: 'swap', dateKey: 'd', mealType: 'lunch' });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes('fromMealName')));
});

test('a custom event may identify the meal by either name or raw text', () => {
  // Both forms occur: matched entries carry `mealName`, unmatched ones only
  // the text the user typed. Requiring both would reject the unmatched kind,
  // which is the kind worth keeping.
  assert.ok(validateEvent({ type: 'custom', dateKey: 'd', mealType: 'lunch', mealName: 'A' }).valid);
  assert.ok(validateEvent({ type: 'custom', dateKey: 'd', mealType: 'lunch', customMealText: 'sushi' }).valid);
  const neither = validateEvent({ type: 'custom', dateKey: 'd', mealType: 'lunch' });
  assert.equal(neither.valid, false);
  assert.ok(neither.issues.some((i) => i.includes('mealName')));
});

test('an unexpected field is reported — a typo must not silently vanish', () => {
  const result = validateEvent({ type: 'confirm', dateKey: 'd', mealType: 'lunch', mealName: 'A', mealNmae: 'A' });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes('mealNmae')));
});

test('an unknown event type is flagged but not treated as corrupt', () => {
  const result = validateEvent({ type: 'time_travel' });
  assert.equal(result.valid, false);
  assert.equal(result.unknownType, true);
});

test('the event log is bounded, keeping the newest events', () => {
  const events = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}` }));
  const trimmed = trimEventLog(events, 5);
  assert.equal(trimmed.length, 5);
  assert.equal(trimmed[0].id, 'e7');
  assert.equal(trimmed[4].id, 'e11');
  // Under the limit, the same array is handed straight back.
  assert.equal(trimEventLog(events, 50), events);
  assert.ok(MAX_RETAINED_EVENTS > 1000, 'the bound should be years of use, not weeks');
});

test('signal declarations only reference fields the event can carry', () => {
  // A valence pointing at a field the type never has is exactly the bug that
  // left `customAvoid` dead: a weight aimed at `originalMealName` on an event
  // that only ever wrote `mealName`.
  for (const [type, def] of Object.entries(EVENT_DEFINITIONS)) {
    const known = new Set([...def.required, ...def.optional, ...(def.requireOneOf || []).flat()]);
    for (const signal of def.signals || []) {
      assert.ok(known.has(signal.field), `${type}: signal field "${signal.field}" is not in the schema`);
    }
  }
});

test('review reasons are uniquely identified and carry a usable signal', () => {
  const ids = PLAN_REVIEW_REASONS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate reason id');
  for (const reason of PLAN_REVIEW_REASONS) {
    assert.ok(reason.label && reason.signal?.kind, `reason ${reason.id} is incomplete`);
    assert.equal(PLAN_REVIEW_REASON_BY_ID[reason.id], reason);
  }
  assert.equal(RATING_NEUTRAL, 3, 'a middling rating must be the zero point');
});
