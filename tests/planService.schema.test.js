import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmitPlanTool, toDayArray } from '../src/lib/planService.js';

const meal = (name) => ({ canonical_name: name, name, protein: 40, cal: 500, macros: { p: 40, c: 30, f: 10 } });

const shortlists = {
  '2026-08-03': {
    breakfast: [meal('B1'), meal('B2')],
    lunch: [meal('L1'), meal('L2'), meal('L3')],
    dinner: [meal('L4'), meal('L5')]
  },
  '2026-08-04': {
    breakfast: [meal('B2')],
    lunch: [meal('L6')],
    dinner: [meal('L7'), meal('L8')]
  }
};

const DATES = ['2026-08-03', '2026-08-04'];

test('every slot on every day gets its own enum of legal meal names', () => {
  const tool = buildSubmitPlanTool(shortlists, DATES);
  const days = tool.input_schema.properties.days;

  assert.deepEqual(days.required, DATES);
  assert.equal(days.additionalProperties, false);

  const first = days.properties['2026-08-03'];
  assert.deepEqual(first.required, ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(first.properties.breakfast.enum, ['B1', 'B2']);
  assert.deepEqual(first.properties.lunch.enum, ['L1', 'L2', 'L3']);
  assert.deepEqual(first.properties.dinner.enum, ['L4', 'L5']);

  // A different day genuinely gets a different legal set — the whole reason
  // the plan is keyed by date rather than returned as an array.
  const second = days.properties['2026-08-04'];
  assert.deepEqual(second.properties.breakfast.enum, ['B2']);
  assert.deepEqual(second.properties.lunch.enum, ['L6']);
  assert.deepEqual(second.properties.dinner.enum, ['L7', 'L8']);
});

test('no free-string meal fields survive in the schema', () => {
  const tool = buildSubmitPlanTool(shortlists, DATES);
  const days = tool.input_schema.properties.days;

  for (const daySchema of Object.values(days.properties)) {
    for (const [slot, slotSchema] of Object.entries(daySchema.properties)) {
      assert.ok(Array.isArray(slotSchema.enum) && slotSchema.enum.length > 0, `${slot} has no enum`);
    }
    assert.equal(daySchema.additionalProperties, false);
  }
});

test('duplicate names inside a shortlist collapse to one enum entry', () => {
  const withDupes = {
    '2026-08-03': {
      breakfast: [meal('B1'), meal('B1')],
      lunch: [meal('L1')],
      dinner: [meal('L2')]
    }
  };
  const tool = buildSubmitPlanTool(withDupes, ['2026-08-03']);
  assert.deepEqual(tool.input_schema.properties.days.properties['2026-08-03'].properties.breakfast.enum, ['B1']);
});

test('building a tool with no usable shortlists fails loudly', () => {
  assert.throws(() => buildSubmitPlanTool({}, DATES), /no shortlists/i);
  assert.throws(
    () => buildSubmitPlanTool({ '2026-08-03': { breakfast: [], lunch: [], dinner: [] } }, ['2026-08-03']),
    /no shortlists/i
  );
});

test('date-keyed tool output converts back to the array the app consumes', () => {
  const toolInput = {
    '2026-08-04': { breakfast: 'B2', lunch: 'L6', dinner: 'L7' },
    '2026-08-03': { breakfast: 'B1', lunch: 'L2', dinner: 'L5' }
  };

  assert.deepEqual(toDayArray(toolInput, DATES), [
    { dateKey: '2026-08-03', breakfast: 'B1', lunch: 'L2', dinner: 'L5' },
    { dateKey: '2026-08-04', breakfast: 'B2', lunch: 'L6', dinner: 'L7' }
  ]);

  assert.deepEqual(toDayArray(null, DATES), []);
  assert.deepEqual(toDayArray({ '2026-08-03': { breakfast: 'B1' } }, DATES), [
    { dateKey: '2026-08-03', breakfast: 'B1' }
  ]);
});

test('the optimizer shortlists drop straight into the schema builder', async () => {
  const { buildWeekPlan } = await import('../src/lib/planOptimizer.js');
  const { getRules } = await import('../src/lib/rules.js');
  const { mealDatabase } = await import('../src/data/mealDatabase.js');

  const rules = getRules('high_protein');
  const targetDateKeys = ['2026-08-03', '2026-08-04', '2026-08-05'];
  const plan = buildWeekPlan({ mealDatabase, rules, targetDateKeys, preferences: {} });
  const tool = buildSubmitPlanTool(plan.shortlists, targetDateKeys);

  const catalogNames = new Set([
    ...mealDatabase.breakfast.map((m) => m.canonical_name),
    ...mealDatabase.lunchDinner.map((m) => m.canonical_name)
  ]);

  for (const dateKey of targetDateKeys) {
    const daySchema = tool.input_schema.properties.days.properties[dateKey];
    assert.ok(daySchema, `${dateKey} missing from the schema`);
    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      const names = daySchema.properties[slot].enum;
      assert.ok(names.length > 0);
      assert.ok(names.every((name) => catalogNames.has(name)), `${slot} enum contains a non-catalog name`);
    }
    // The deterministic pick is always offered, so the model can reproduce it.
    const chosen = plan.days.find((day) => day.dateKey === dateKey);
    assert.ok(daySchema.properties.breakfast.enum.includes(chosen.breakfast.canonical_name));
    assert.ok(daySchema.properties.lunch.enum.includes(chosen.lunch.canonical_name));
    assert.ok(daySchema.properties.dinner.enum.includes(chosen.dinner.canonical_name));
  }
});
