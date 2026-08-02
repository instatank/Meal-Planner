// omniboxService.js — client wrapper that calls /api/generate-plan (the Vercel
// serverless Anthropic proxy) to parse Omnibox natural-language input.
//
// Replaces geminiService.js's parseMealIntent. Same signature and return
// shape, so Omnibox.jsx only needed an import swap. Uses Claude via the
// existing proxy's tool_use mechanism instead of Gemini's
// responseMimeType:'application/json' — no client-exposed API key.

import { FALLBACK_PROMPTS } from '../data/fallbackPrompts.js';
import { ingredients as localIngredients, userProfile as localUserProfile, STANDARD_PORTIONS as localPortions } from '../data/ingredients.js';

const PROXY_ENDPOINT = '/api/generate-plan';
const DEFAULT_TIMEOUT_MS = 20_000;

// Mirrors the ADD_CUSTOM / MODIFY / DINING_OUT / GENERAL_SWAP /
// UNVERIFIED_NOVEL_FOOD shapes documented in FALLBACK_PROMPTS.intentParsing.
// `data` stays a loose object (rather than a oneOf per intent) since the
// exact required fields differ per intent and the system prompt already
// spells out the contract in detail.
const SUBMIT_INTENT_TOOL = {
  name: 'submit_meal_intent',
  description: 'Submit the parsed structured meal intent for the user\'s natural-language input.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['ADD_CUSTOM', 'MODIFY', 'DINING_OUT', 'GENERAL_SWAP', 'UNVERIFIED_NOVEL_FOOD'],
        description: 'Which action the user intends.'
      },
      data: {
        type: 'object',
        description: 'Action-specific payload — populate only the fields relevant to the chosen intent.',
        properties: {
          name: { type: 'string', description: 'Short readable meal/restaurant name (ADD_CUSTOM, DINING_OUT, UNVERIFIED_NOVEL_FOOD).' },
          parts: {
            type: 'array',
            description: 'Ingredient breakdown, for ADD_CUSTOM.',
            items: {
              type: 'object',
              properties: {
                ingredientId: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string', enum: ['g', 'piece'] }
              },
              required: ['ingredientId', 'qty', 'unit']
            }
          },
          additions: {
            type: 'array',
            description: 'Ingredients to add, for MODIFY.',
            items: {
              type: 'object',
              properties: {
                ingredientId: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string', enum: ['g', 'piece'] }
              },
              required: ['ingredientId', 'qty', 'unit']
            }
          },
          removals: {
            type: 'array',
            description: 'Ingredient IDs to remove, for MODIFY.',
            items: { type: 'string' }
          },
          scale: { type: 'number', description: 'Portion scale multiplier, for MODIFY (e.g. 1.0).' },
          estimatedCalories: { type: 'number', description: 'For DINING_OUT / UNVERIFIED_NOVEL_FOOD.' },
          estimatedProtein: { type: 'number' },
          estimatedCarbs: { type: 'number' },
          estimatedFats: { type: 'number' },
          effort: { type: 'integer', enum: [1, 2, 3], description: 'For GENERAL_SWAP: 1=easy, 2=med, 3=hard.' },
          preference: { type: 'string', description: 'For GENERAL_SWAP, e.g. lighter/heavier/high-protein/vegetarian.' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'For GENERAL_SWAP, things to avoid.' }
        }
      }
    },
    required: ['intent', 'data']
  }
};

const getActiveConfig = (cloudConfig) => ({
  prompts: cloudConfig?.prompts?.system_instructions || FALLBACK_PROMPTS,
  ingredients: cloudConfig?.ingredients?.data || localIngredients,
  userProfile: localUserProfile,
  portions: localPortions
});

export const parseMealIntent = async (userInput, contextSlot = null, cloudConfig = null) => {
  const config = getActiveConfig(cloudConfig);

  const catalogString = Object.entries(config.ingredients)
    .map(([id, def]) => `- [${id}]: ${def.name} (Default: ${def.defaultPortion?.qty}${def.defaultPortion?.unit})`)
    .join('\n');

  const systemInstruction = config.prompts.intentParsing
    .replace('{{GENDER}}', config.userProfile.gender)
    .replace('{{AGE}}', config.userProfile.age)
    .replace('{{WEIGHT}}', config.userProfile.weight_kg)
    .replace('{{HEIGHT}}', config.userProfile.height_cm)
    .replace('{{PORTION_MEAT}}', `${config.portions.protein_meat.qty}${config.portions.protein_meat.unit}`)
    .replace('{{PORTION_VEG}}', `${config.portions.protein_veg.qty}${config.portions.protein_veg.unit}`)
    .replace('{{PORTION_GRAIN}}', `${config.portions.carbs_grain.qty}${config.portions.carbs_grain.unit}`)
    .replace('{{PORTION_BREAD}}', `${config.portions.carbs_bread.qty}${config.portions.carbs_bread.unit}`)
    .replace('{{PORTION_VEG_BASE}}', `${config.portions.vegetables.qty}${config.portions.vegetables.unit}`)
    .replace('{{PORTION_FATS}}', `${config.portions.fats_oils.qty}${config.portions.fats_oils.unit}`)
    .replace('{{CATALOG_STRING}}', catalogString);

  const userMessage = `Context Info (for Modify/Swap/Add actions):
Target Slot (If the user doesn't specify one, assume they mean this one): ${contextSlot || 'None provided'}

User Input: "${userInput}"`;

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
        tool: SUBMIT_INTENT_TOOL,
        temperature: 0.1
      })
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.error('[omniboxService] proxy returned non-OK:', errPayload);
      throw new Error(errPayload?.error || 'Proxy error');
    }

    const data = await response.json();
    const parsed = data?.toolInput;
    if (!parsed || typeof parsed !== 'object' || !parsed.intent) {
      console.error('[omniboxService] Missing intent in toolInput:', data);
      throw new Error('AI did not return a structured intent');
    }
    return parsed;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    console.error('[omniboxService] parseMealIntent failed:', error);
    throw error;
  }
};
