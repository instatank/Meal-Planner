import { GoogleGenAI } from '@google/genai';
import { ingredients as localIngredients, userProfile as localUserProfile, STANDARD_PORTIONS as localPortions } from '../data/ingredients.js';
import { FALLBACK_PROMPTS } from '../data/fallbackPrompts.js';

const apiKey = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env.VITE_GEMINI_API_KEY
  : process.env.VITE_GEMINI_API_KEY;

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const isGeminiConfigured = () => !!ai;

// Helper to safely extract or fallback to local files
const getActiveConfig = (cloudConfig) => {
  return {
    prompts: cloudConfig?.prompts?.system_instructions || FALLBACK_PROMPTS,
    ingredients: cloudConfig?.ingredients?.data || localIngredients,
    userProfile: localUserProfile, // This remains hardcoded until they want a UI for it
    portions: localPortions
  };
};

export const parseMealIntent = async (userInput, contextSlot = null, cloudConfig = null) => {
  if (!ai) throw new Error("Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local");

  const config = getActiveConfig(cloudConfig);
  
  // Build the dynamic catalog string based on exactly what is structurally passed in
  const catalogString = Object.entries(config.ingredients)
    .map(([id, def]) => `- [${id}]: ${def.name} (Default: ${def.defaultPortion?.qty}${def.defaultPortion?.unit})`)
    .join('\n');

  // String Interpolation
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

  try {
    const prompt = `
      Context Info (for Modify/Swap/Add actions):
      Target Slot (If the user doesn't specify one, assume they mean this one): ${contextSlot || 'None provided'}
      
      User Input: "${userInput}"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, 
        responseMimeType: 'application/json'
      }
    });

    const outputString = response.text;
    if (!outputString) throw new Error("Empty response from AI");

    try {
      return JSON.parse(outputString);
    } catch (parseError) {
      const codeBlockMatch = outputString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }
      console.error("Failed to parse raw output:", outputString);
      throw new Error("AI returned invalid JSON format");
    }

  } catch (error) {
    console.error("Gemini Intent Parsing Error:", error);
    throw error;
  }
};

export const generateWeeklyPlan = async ({
  targetDateKeys,
  mealDatabase,
  preferences,
  historyMap,
  dailyProteinTarget,
  cloudConfig = null,
  goal = 'high_protein'
}) => {
  if (!ai) throw new Error("Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local");

  const config = getActiveConfig(cloudConfig);

  const breakfastSet = new Set((mealDatabase.breakfast || []).map(m => m.canonical_name));
  const lunchDinnerSet = new Set((mealDatabase.lunchDinner || []).map(m => m.canonical_name));

  const availableMeals = [
    ...(mealDatabase.breakfast || []),
    ...(mealDatabase.lunchDinner || []),
    ...(mealDatabase.snack || [])
  ].map(m => ({
    name: m.canonical_name,
    type: breakfastSet.has(m.canonical_name) ? 'breakfast' : (lunchDinnerSet.has(m.canonical_name) ? 'lunch/dinner' : 'snack'),
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

  // Slim history to just meal names per day — avoids sending full meal objects (~1-2k tokens saved)
  const slimHistory = Object.fromEntries(
    Object.entries(historyMap).map(([dateKey, dayData]) => {
      const slim = {};
      for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
        const meal = dayData?.[slot];
        const name = meal?.name || meal?.canonical_name || (typeof meal === 'string' ? meal : null);
        if (name) slim[slot] = name;
      }
      return [dateKey, slim];
    })
  );

  const basePromptTemplate = typeof config.prompts.weeklyGeneration === 'string'
    ? config.prompts.weeklyGeneration
    : (config.prompts.weeklyGeneration[goal] || config.prompts.weeklyGeneration.high_protein || Object.values(config.prompts.weeklyGeneration)[0]);

  const systemPrompt = basePromptTemplate
    .replace('{{AVAILABLE_MEALS}}', JSON.stringify(availableMeals))
    .replace('{{PREFS_ACCEPTS}}', JSON.stringify(preferences?.accepts || {}))
    .replace('{{PREFS_EDITS}}', JSON.stringify(preferences?.edits || {}))
    .replace('{{PREFS_AVOIDS}}', JSON.stringify(preferences?.avoids || {}))
    .replace('{{RECENT_HISTORY}}', JSON.stringify(slimHistory))
    .replace('{{TARGET_DATES}}', JSON.stringify(targetDateKeys))
    .replace(/{{PROTEIN_TARGET}}/g, String(dailyProteinTarget))
    .replace(/{{PROTEIN_MIN}}/g, String(Math.round(Number(dailyProteinTarget) * 0.9)))
    .replace(/{{PROTEIN_MAX}}/g, String(Math.round(Number(dailyProteinTarget) * 1.1)));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: systemPrompt,
      config: {
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: 'HIGH' },
        responseMimeType: 'application/json'
      }
    });

    const outputString = response.text;
    if (!outputString) throw new Error("Empty response from AI");

    const parsed = JSON.parse(outputString);
    if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
    return parsed;
  } catch (error) {
    console.error("Gemini Weekly Generation Error:", error);
    throw error;
  }
};
