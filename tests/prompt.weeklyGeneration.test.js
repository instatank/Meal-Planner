import test from 'node:test';
import assert from 'node:assert/strict';

import { FALLBACK_PROMPTS } from '../src/data/fallbackPrompts.js';
import { getRules, requiredCompliantDays } from '../src/lib/rules.js';

const TEMPLATES = FALLBACK_PROMPTS.weeklyGeneration;

/**
 * Mirrors the substitution `planService.generateWeeklyPlan` performs. Kept in
 * the test rather than exported so a drift between the two shows up here.
 */
const render = (template, rules, dayCount) => {
  const minCompliantDays = requiredCompliantDays(dayCount, rules);
  return template
    .replace('{{SHORTLISTS}}', '[See user message]')
    .replace('{{PREFS_ACCEPTS}}', '{}')
    .replace('{{PREFS_AVOIDS}}', '{}')
    .replace(/{{PROTEIN_TARGET}}/g, String(rules.dailyProteinTarget))
    .replace(/{{PROTEIN_MIN}}/g, String(rules.budgeted.dailyProteinMin))
    .replace(/{{PROTEIN_MAX}}/g, String(rules.budgeted.dailyProteinMax))
    .replace(/{{CARB_CAP}}/g, String(rules.budgeted.dailyCarbCap))
    .replace(/{{CALORIE_MIN}}/g, String(rules.budgeted.dailyCalorieMin))
    .replace(/{{CALORIE_MAX}}/g, String(rules.budgeted.dailyCalorieMax))
    .replace(/{{MIN_MEAL_PROTEIN}}/g, String(rules.hard.minMealProtein))
    .replace(/{{DAY_COUNT}}/g, String(dayCount))
    .replace(/{{MIN_COMPLIANT_DAYS}}/g, String(minCompliantDays))
    .replace(/{{MAX_FLEX_DAYS}}/g, String(Math.max(0, dayCount - minCompliantDays)))
    .replace(
      /{{WEEKLY_PROTEIN_FLOOR}}/g,
      String(Math.round(dayCount * rules.dailyProteinTarget * rules.hard.weeklyProteinFloorRatio))
    );
};

test('the false "already verified" guarantee is gone from both prompts', () => {
  for (const [goal, template] of Object.entries(TEMPLATES)) {
    assert.ok(!/ALREADY been verified/i.test(template), `${goal} still claims constraints are pre-verified`);
    assert.ok(!/You do NOT need to check/i.test(template), `${goal} still tells the model not to check`);
    assert.ok(!/informational/i.test(template), `${goal} still calls the protein target informational`);
  }
});

test('the vestigial JSON output-format block is gone', () => {
  for (const [goal, template] of Object.entries(TEMPLATES)) {
    assert.ok(!/OUTPUT FORMAT/i.test(template), `${goal} still has an OUTPUT FORMAT block`);
    assert.ok(!/strictly valid JSON/i.test(template), `${goal} still prompt-begs for JSON`);
    assert.ok(/submit_weekly_plan/.test(template), `${goal} should point at the tool instead`);
  }
});

test('what is guaranteed is stated accurately: per-meal rules yes, daily totals no', () => {
  for (const [goal, template] of Object.entries(TEMPLATES)) {
    assert.match(template, /is NOT guaranteed/i, `${goal} should say what is not guaranteed`);
    assert.match(template, /daily totals/i, `${goal} should hand the daily totals to the model`);
  }
});

test('the rendered high_protein prompt states every threshold as a hard number', () => {
  const rules = getRules('high_protein');
  const rendered = render(TEMPLATES.high_protein, rules, 7);

  assert.ok(!/{{\w+}}/.test(rendered), `unsubstituted placeholder: ${rendered.match(/{{\w+}}/g)}`);

  for (const expected of ['120g', '108g', '132g', '130g', '1600', '2200', '20g', '714g']) {
    assert.ok(rendered.includes(expected), `prompt is missing the literal ${expected}`);
  }
  assert.match(rendered, /At least 5 of 7 days/);
  assert.match(rendered, /At most 2 day\(s\) may fall outside/);
});

test('the prompt tells the model which days may go off-band, and that flex days may be genuinely low', () => {
  const rules = getRules('high_protein');
  const rendered = render(TEMPLATES.high_protein, rules, 7);

  assert.match(rendered, /70g day is fine/i, 'flex days must be described as genuinely low, not near-misses');
  assert.match(rendered, /AIM DAILY, JUDGE WEEKLY/);
  assert.match(rendered, /total protein must be at least 714g/i);
});

test('a partial-week regeneration is told its own pro-rated budget, not the weekly one', () => {
  const rules = getRules('high_protein');
  const rendered = render(TEMPLATES.high_protein, rules, 4);

  assert.match(rendered, /At least 3 of 4 days/);
  assert.match(rendered, /At most 1 day\(s\) may fall outside/);
  assert.match(rendered, /total protein must be at least 408g/i);
});

test('the standard prompt renders its own thresholds', () => {
  const rules = getRules('standard');
  const rendered = render(TEMPLATES.standard, rules, 7);

  assert.ok(!/{{\w+}}/.test(rendered), `unsubstituted placeholder: ${rendered.match(/{{\w+}}/g)}`);
  assert.ok(rendered.includes('100g'));
  assert.ok(rendered.includes('1800'));
  assert.ok(rendered.includes('2400'));
  assert.ok(rendered.includes('12g'));
  assert.match(rendered, /MAXIMUM CATALOG COVERAGE/);
});

test('dinner tapering is phrased as a preference, never a reason to miss protein', () => {
  const rules = getRules('high_protein');
  const rendered = render(TEMPLATES.high_protein, rules, 7);

  assert.match(rendered, /TAPERING/);
  assert.match(rendered, /preference, never a reason to miss a protein target/i);
  assert.ok(!/Heavy/.test(rendered), 'tapering must not reference the hand-typed weight label');
});
