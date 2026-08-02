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
