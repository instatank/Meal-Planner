// planService.js — client wrapper that calls /api/generate-plan (the Vercel
// serverless Anthropic proxy) instead of hitting any LLM SDK directly.
//
// Structured output is enforced by a tool schema whose meal-name fields are
// per-day, per-slot `enum`s built from the optimizer's shortlists. Anthropic
// validates the tool input against that schema, so a hallucinated or slightly
// reworded meal name is structurally impossible rather than something the app
// has to detect afterwards. (The validator still checks — defence in depth —
// but it should never see an unresolvable name from this path.)

import { FALLBACK_PROMPTS } from '../data/fallbackPrompts.js';
import { requiredCompliantDays } from './rules.js';

const PROXY_ENDPOINT = '/api/generate-plan';
const DEFAULT_TIMEOUT_MS = 90_000;

const getMealName = (meal) => String(meal?.canonical_name || meal?.name || '');

/**
 * Build the `submit_weekly_plan` tool for one specific request.
 *
 * The plan is keyed by date rather than returned as an array, because JSON
 * Schema applies one `items` schema to every element of an array — which would
 * force a single shared enum across all seven days. Keying by date lets each
 * day carry its own legal set.
 */
export const buildSubmitPlanTool = (shortlists, targetDateKeys) => {
  const dayProperties = {};
  const requiredDays = [];

  for (const dateKey of targetDateKeys) {
    const slots = shortlists?.[dateKey];
    if (!slots) continue;

    const slotProperties = {};
    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      const names = Array.from(new Set((slots[slot] || []).map(getMealName).filter(Boolean)));
      if (names.length === 0) continue;
      slotProperties[slot] = {
        type: 'string',
        enum: names,
        description: `Meal for ${slot} on ${dateKey}. Must be one of the listed names.`
      };
    }

    const slotNames = Object.keys(slotProperties);
    if (slotNames.length === 0) continue;

    dayProperties[dateKey] = {
      type: 'object',
      properties: slotProperties,
      required: slotNames,
      additionalProperties: false
    };
    requiredDays.push(dateKey);
  }

  if (requiredDays.length === 0) {
    throw new Error('Cannot build the plan tool: no shortlists were supplied for any target date.');
  }

  return {
    name: 'submit_weekly_plan',
    description: 'Submit the finalized weekly meal plan. Provide exactly one entry per target date, choosing only from that date\'s allowed meal names.',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'object',
          description: 'One entry per target date, keyed by YYYY-MM-DD.',
          properties: dayProperties,
          required: requiredDays,
          additionalProperties: false
        }
      },
      required: ['days'],
      additionalProperties: false
    }
  };
};

/** Convert the date-keyed tool output back into the array shape the app uses. */
export const toDayArray = (days, targetDateKeys) => {
  if (!days || typeof days !== 'object') return [];
  return targetDateKeys
    .filter((dateKey) => days[dateKey])
    .map((dateKey) => ({ dateKey, ...days[dateKey] }));
};

const getActiveConfig = (cloudConfig) => ({
  prompts: cloudConfig?.prompts?.system_instructions || FALLBACK_PROMPTS
});

const buildShortlistsPayload = (shortlists) => {
  const compact = {};
  for (const [dateKey, daySlots] of Object.entries(shortlists)) {
    compact[dateKey] = {};
    for (const [slot, meals] of Object.entries(daySlots)) {
      compact[dateKey][slot] = meals.map((m) => ({
        name: getMealName(m),
        p: Math.round(m.protein || m.macros?.p || 0),
        c: Math.round(m.macros?.c || 0),
        cal: Math.round(m.cal || 0),
        cuis: m.cuisine || 'general',
        has_fibre: !!m.has_fibre,
        pp: m.tags?.protein_family || m.components?.protein || null
      }));
    }
  }
  return compact;
};

// ─── Phase 2, the week-choice path ──────────────────────────────────────────
//
// The shortlist path below hands the model three flat per-slot lists per day
// and asks it to assemble a week. It cannot do that job, and the failure is
// arithmetic rather than a prompting problem:
//
//   - The tool schema permitted ~9.2e18 weeks. Sampling it 400 times the way
//     the schema allows produced 0 legal weeks. Every sample broke a hard
//     rule; the average sample carried 5 dish repeats and 2.5 anchor-family
//     violations.
//   - The shortlists are nearly identical across days — 7 of each day's 8
//     breakfasts are the same meal on all seven days, and the union of all
//     seven days' breakfast lists is 9 meals — while R1 requires 21 distinct
//     dishes across the week.
//   - Four of the hard rules it is graded on (the anchor-family caps, the
//     egg-breakfast floor and ceiling, the red-meat cap, the duplicate-day
//     rule) are not stated in the prompt at all, and the per-meal payload
//     carries no anchor-ingredient field, so the model could not evaluate
//     them even if it were told.
//
// Feeding 60 simulated model answers through `validateAndRepairWeek` returned
// `strategy: 'regenerated_week'` 60 times out of 60, and the final week was
// byte-identical to the optimizer's own in all 60. The AI phase was a no-op
// with a bill and 90 seconds of latency attached.
//
// `chooseWeeklyPlan` gives it a job it can actually do. The optimizer already
// builds several complete weeks that satisfy every rule by construction — they
// sit in the final beam and used to be thrown away — so the model picks one
// instead of assembling one. An illegal answer stops being something to detect
// and becomes something that cannot be expressed.

export const buildSelectWeekTool = (weekIds) => ({
  name: 'select_weekly_plan',
  description:
    'Choose which of the offered complete weekly plans to use. Every option already satisfies every nutritional and variety rule, so choose on appetite, rhythm and how the week reads as a whole.',
  input_schema: {
    type: 'object',
    properties: {
      week_id: {
        type: 'string',
        enum: weekIds,
        description: 'The id of the week to use.'
      },
      reason: {
        type: 'string',
        description: 'One short sentence on why this week reads best. Shown in logs, not to the user.'
      }
    },
    required: ['week_id'],
    additionalProperties: false
  }
});

/** Compact, model-readable description of one complete week option. */
const describeWeekOption = (option, id) => ({
  week_id: id,
  weekly_protein_g: option.summary?.totalProtein ?? null,
  distinct_meals: option.summary?.distinctMeals ?? null,
  days: option.days.map((day) => ({
    date: day.dateKey,
    protein_g: Math.round(day.totals?.protein || 0),
    calories: Math.round(day.totals?.calories || 0),
    breakfast: getMealName(day.breakfast),
    lunch: getMealName(day.lunch),
    dinner: getMealName(day.dinner)
  }))
});

/**
 * Ask the model to pick one of the optimizer's complete legal weeks.
 *
 * Returns the chosen option's `days` — real meal objects, straight from the
 * optimizer — so nothing needs resolving by name afterwards. On any failure
 * (no key, proxy error, timeout, an id outside the enum) this returns the
 * first option, which is the optimizer's own top-scoring week. The AI is a
 * preference layer on top of a correct answer, never a dependency for getting
 * one.
 */
export const chooseWeeklyPlan = async ({
  weekOptions,
  preferences,
  tiers = null,
  cloudConfig = null,
  goal = 'high_protein'
}) => {
  if (!Array.isArray(weekOptions) || weekOptions.length === 0) {
    throw new Error('chooseWeeklyPlan requires at least one week option from the optimizer.');
  }
  if (weekOptions.length === 1) {
    return { days: weekOptions[0].days, weekId: 'week_1', chosenIndex: 0, source: 'only_option' };
  }

  const ids = weekOptions.map((_, index) => `week_${index + 1}`);
  const config = getActiveConfig(cloudConfig);
  const template = typeof config.prompts.weeklySelection === 'string'
    ? config.prompts.weeklySelection
    : FALLBACK_PROMPTS.weeklySelection;

  // Only the meals the user has actually expressed something about — the full
  // tier table is 110 entries of mostly "occasional" and would crowd the
  // prompt with nothing.
  const notableTiers = {};
  for (const [name, tier] of Object.entries(tiers || {})) {
    if (tier && tier !== 'occasional') notableTiers[name] = tier;
  }

  const systemInstruction = template
    .replace('{{PREFS_ACCEPTS}}', JSON.stringify(preferences?.accepts || {}))
    .replace('{{PREFS_AVOIDS}}', JSON.stringify(preferences?.avoids || {}))
    .replace('{{MEAL_TIERS}}', JSON.stringify(notableTiers))
    .replace('{{GOAL}}', String(goal));

  const userMessage = JSON.stringify({
    weeks: weekOptions.map((option, index) => describeWeekOption(option, ids[index]))
  });

  const fallback = { days: weekOptions[0].days, weekId: ids[0], chosenIndex: 0, source: 'fallback' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        system: systemInstruction,
        userMessage,
        tool: buildSelectWeekTool(ids)
      })
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.warn('[planService] week selection proxy error, using the optimizer\'s own pick:', errPayload);
      return fallback;
    }
    const data = await response.json();
    const chosen = String(data?.toolInput?.week_id || '');
    const index = ids.indexOf(chosen);
    if (index < 0) {
      console.warn('[planService] week selection returned an unknown id:', chosen);
      return fallback;
    }
    return {
      days: weekOptions[index].days,
      weekId: chosen,
      chosenIndex: index,
      reason: data?.toolInput?.reason || '',
      source: 'ai'
    };
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.warn('[planService] week selection failed, using the optimizer\'s own pick:', error?.message || error);
    return fallback;
  }
};

export const generateWeeklyPlan = async ({
  targetDateKeys,
  preferences,
  historyMap,
  dailyProteinTarget,
  cloudConfig = null,
  goal = 'high_protein',
  shortlists = null,
  rules = null
}) => {
  if (!shortlists) {
    throw new Error('generateWeeklyPlan requires shortlists from the optimizer.');
  }

  const config = getActiveConfig(cloudConfig);
  const basePromptTemplate = typeof config.prompts.weeklyGeneration === 'string'
    ? config.prompts.weeklyGeneration
    : (config.prompts.weeklyGeneration[goal]
      || config.prompts.weeklyGeneration.high_protein
      || Object.values(config.prompts.weeklyGeneration)[0]);

  const target = Number(rules?.dailyProteinTarget ?? dailyProteinTarget);
  const proteinMin = rules?.budgeted?.dailyProteinMin ?? Math.round(target * 0.9);
  const proteinMax = rules?.budgeted?.dailyProteinMax ?? Math.round(target * 1.1);

  // Budgets pro-rate with the number of days actually being generated, so a
  // 4-day remainder is not told it may spend a full week's worth of flex days.
  const dayCount = targetDateKeys.length;
  const minCompliantDays = rules ? requiredCompliantDays(dayCount, rules) : dayCount;
  const weeklyFloor = rules
    ? Math.round(dayCount * rules.dailyProteinTarget * rules.hard.weeklyProteinFloorRatio)
    : '';

  const systemInstruction = basePromptTemplate
    .replace('{{SHORTLISTS}}', '[See user message]')
    .replace('{{AVAILABLE_MEALS}}', '[See user message]')
    .replace('{{PREFS_ACCEPTS}}', JSON.stringify(preferences?.accepts || {}))
    .replace('{{PREFS_EDITS}}', JSON.stringify(preferences?.edits || {}))
    .replace('{{PREFS_AVOIDS}}', JSON.stringify(preferences?.avoids || {}))
    .replace('{{RECENT_HISTORY}}', '[See user message]')
    .replace('{{TARGET_DATES}}', '[See user message]')
    .replace(/{{PROTEIN_TARGET}}/g, String(target))
    .replace(/{{PROTEIN_MIN}}/g, String(proteinMin))
    .replace(/{{PROTEIN_MAX}}/g, String(proteinMax))
    .replace(/{{CARB_CAP}}/g, String(rules?.budgeted?.dailyCarbCap ?? ''))
    .replace(/{{CALORIE_MIN}}/g, String(rules?.budgeted?.dailyCalorieMin ?? ''))
    .replace(/{{CALORIE_MAX}}/g, String(rules?.budgeted?.dailyCalorieMax ?? ''))
    .replace(/{{MIN_MEAL_PROTEIN}}/g, String(rules?.hard?.minMealProtein ?? ''))
    .replace(/{{DAY_COUNT}}/g, String(dayCount))
    .replace(/{{MIN_COMPLIANT_DAYS}}/g, String(minCompliantDays))
    .replace(/{{MAX_FLEX_DAYS}}/g, String(Math.max(0, dayCount - minCompliantDays)))
    .replace(/{{WEEKLY_PROTEIN_FLOOR}}/g, String(weeklyFloor));

  // Bundle everything the model needs into a single user message so the
  // proxy stays dumb (no prompt logic server-side).
  const userMessage = JSON.stringify({
    targetDateKeys,
    recentHistory: historyMap || {},
    shortlists: buildShortlistsPayload(shortlists)
  });

  const tool = buildSubmitPlanTool(shortlists, targetDateKeys);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        system: systemInstruction,
        userMessage,
        tool
      })
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.error('[planService] proxy returned non-OK:', errPayload);
      const statusNote = errPayload?.status ? ` [Anthropic ${errPayload.status}]` : ` [HTTP ${response.status}]`;
      const detail = errPayload?.body ? ` — ${String(errPayload.body).slice(0, 500)}` : '';
      throw new Error(`${errPayload?.error || 'Proxy error'}${statusNote}${detail}`);
    }

    const data = await response.json();
    const days = toDayArray(data?.toolInput?.days, targetDateKeys);
    if (days.length === 0) {
      console.error('[planService] Missing days in toolInput:', data);
      throw new Error('AI did not return a structured plan');
    }
    return days;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw new Error('Meal generation timed out after 90 seconds. Please try again.');
    }
    console.error('[planService] generateWeeklyPlan failed:', error);
    throw error;
  }
};

// The proxy is considered "configured" iff the frontend is reachable. We can't
// detect whether the server has ANTHROPIC_API_KEY set without making a call.
export const isPlanProxyConfigured = () => true;
