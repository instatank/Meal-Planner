// planService.js — client wrapper that calls /api/generate-plan (the Vercel
// serverless Anthropic proxy) instead of hitting any LLM SDK directly.
//
// Preserves the same `generateWeeklyPlan` signature and return shape as the
// legacy geminiService.js so the rest of the app can swap import sources
// without further changes.

import { FALLBACK_PROMPTS } from '../data/fallbackPrompts.js';

const PROXY_ENDPOINT = '/api/generate-plan';
const DEFAULT_TIMEOUT_MS = 90_000;

// Try JSON.parse, fall back to markdown code block, then fall back to
// extracting the outermost `[...]` substring. Handles cases where the model
// adds a trailing explanation after the array or wraps it in ```json blocks.
const robustParseJsonArray = (raw) => {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('Empty response from AI');
  }

  try {
    return JSON.parse(raw);
  } catch { /* fall through */ }

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch { /* fall through */ }
  }

  const first = raw.indexOf('[');
  const last = raw.lastIndexOf(']');
  if (first !== -1 && last > first) {
    const slice = raw.slice(first, last + 1);
    try { return JSON.parse(slice); } catch { /* fall through */ }
  }

  console.error('[planService] Failed to parse weekly plan output:', raw);
  throw new Error('AI returned invalid JSON format');
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
        name: m.canonical_name || m.name,
        p: Math.round(m.protein || m.macros?.p || 0),
        cal: Math.round(m.cal || 0),
        cuis: m.cuisine || 'general',
        has_fibre: !!m.has_fibre,
        meal_weight: m.meal_weight || 'Medium',
        pp: m.components?.protein || m.tags?.protein_family || null
      }));
    }
  }
  return compact;
};

const buildLegacyCatalogPayload = (mealDatabase) => {
  const breakfastSet = new Set((mealDatabase.breakfast || []).map((m) => m.canonical_name));
  const lunchDinnerSet = new Set((mealDatabase.lunchDinner || []).map((m) => m.canonical_name));
  return [
    ...(mealDatabase.breakfast || []),
    ...(mealDatabase.lunchDinner || []),
    ...(mealDatabase.snack || [])
  ].map((m) => ({
    name: m.canonical_name,
    type: breakfastSet.has(m.canonical_name)
      ? 'breakfast'
      : (lunchDinnerSet.has(m.canonical_name) ? 'lunch/dinner' : 'snack'),
    p: Math.round(m.protein || m.p || 0),
    c: Math.round(m.c || 0),
    f: Math.round(m.f || 0),
    cal: Math.round(m.cal || 0),
    cuis: m.cuisine || 'general',
    is_fat_heavy: !!m.is_fat_heavy,
    has_fibre: !!m.has_fibre,
    meal_weight: m.meal_weight || 'Medium',
    pp: m.components?.protein || m.primary_protein || null
  }));
};

export const generateWeeklyPlan = async ({
  targetDateKeys,
  mealDatabase,
  preferences,
  historyMap,
  dailyProteinTarget,
  cloudConfig = null,
  goal = 'high_protein',
  shortlists = null
}) => {
  const config = getActiveConfig(cloudConfig);

  const basePromptTemplate = typeof config.prompts.weeklyGeneration === 'string'
    ? config.prompts.weeklyGeneration
    : (config.prompts.weeklyGeneration[goal]
      || config.prompts.weeklyGeneration.high_protein
      || Object.values(config.prompts.weeklyGeneration)[0]);

  const dynamicData = shortlists
    ? JSON.stringify(buildShortlistsPayload(shortlists))
    : JSON.stringify(buildLegacyCatalogPayload(mealDatabase));

  const systemInstruction = basePromptTemplate
    .replace('{{SHORTLISTS}}', '[See user message]')
    .replace('{{AVAILABLE_MEALS}}', '[See user message]')
    .replace('{{PREFS_ACCEPTS}}', JSON.stringify(preferences?.accepts || {}))
    .replace('{{PREFS_EDITS}}', JSON.stringify(preferences?.edits || {}))
    .replace('{{PREFS_AVOIDS}}', JSON.stringify(preferences?.avoids || {}))
    .replace('{{RECENT_HISTORY}}', '[See user message]')
    .replace('{{TARGET_DATES}}', '[See user message]')
    .replace(/{{PROTEIN_TARGET}}/g, String(dailyProteinTarget))
    .replace(/{{PROTEIN_MIN}}/g, String(Math.round(Number(dailyProteinTarget) * 0.9)))
    .replace(/{{PROTEIN_MAX}}/g, String(Math.round(Number(dailyProteinTarget) * 1.1)));

  // Bundle everything the model needs into a single user message so the
  // proxy stays dumb (no prompt logic server-side).
  const userMessage = JSON.stringify({
    targetDateKeys,
    recentHistory: historyMap || {},
    ...(shortlists ? { shortlists: JSON.parse(dynamicData) } : { availableMeals: JSON.parse(dynamicData) })
  });

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
        // Force Claude to begin its response with "[" so the output is
        // always a JSON array — no prose preamble, no markdown fencing.
        assistantPrefill: '[',
        temperature: 0.7
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
    const outputString = data?.text || '';
    if (!outputString) throw new Error('Empty response from AI');

    const parsed = robustParseJsonArray(outputString);
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
    return parsed;
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
