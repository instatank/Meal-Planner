import { GoogleGenAI } from '@google/genai';
import { ingredients, userProfile, STANDARD_PORTIONS } from '../data/ingredients.js';

// Initialize the Gemini client
// Native Vite support via import.meta.env, fallback to process.env for Node testing
const apiKey = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env.VITE_GEMINI_API_KEY
  : process.env.VITE_GEMINI_API_KEY;

// Only initialize if we have a key (so it doesn't crash on boot if missing)
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const isGeminiConfigured = () => !!ai;

// Build a lightweight catalog text for the LLM prompt to save tokens
const catalogString = Object.entries(ingredients)
  .map(([id, def]) => `- [${id}]: ${def.name} (Default: ${def.defaultPortion?.qty}${def.defaultPortion?.unit})`)
  .join('\n');

const SYSTEM_PROMPT = `You are an intelligent meal parsing assistant.
Your sole job is to translate natural language meal descriptions into a strict JSON payload.

USER PROFILE:
Gender: ${userProfile.gender}
Age: ${userProfile.age}
Weight: ${userProfile.weight_kg}kg
Height: ${userProfile.height_cm}cm

STANDARD BASELINE PORTIONS:
Protein (Meat): ${STANDARD_PORTIONS.protein_meat.qty}${STANDARD_PORTIONS.protein_meat.unit}
Protein (Veg): ${STANDARD_PORTIONS.protein_veg.qty}${STANDARD_PORTIONS.protein_veg.unit}
Carbs (Grain): ${STANDARD_PORTIONS.carbs_grain.qty}${STANDARD_PORTIONS.carbs_grain.unit}
Carbs (Bread): ${STANDARD_PORTIONS.carbs_bread.qty}${STANDARD_PORTIONS.carbs_bread.unit}
Vegetables: ${STANDARD_PORTIONS.vegetables.qty}${STANDARD_PORTIONS.vegetables.unit}
Oils/Fats: ${STANDARD_PORTIONS.fats_oils.qty}${STANDARD_PORTIONS.fats_oils.unit}

If the user does not explicitly state a quantity, apply these baseline portions.
If the user says "half portion" or "large portion", adjust the baseline accordingly.

EGG PORTION RULES (CRITICAL):
- Whenever the user mentions "eggs" (e.g. scrambled eggs, omelette, boiled eggs) without a quantity, ASSUME 3 EGGS total.
- NEVER use the "egg_whole" ingredient.
- ALWAYS split eggs into "egg_white" and "egg_yolk" using this exact ratio: 1 egg = 1 "egg_white" + 0.5 "egg_yolk".
- For example: if the user eats 3 eggs, output { "ingredientId": "egg_white", "qty": 3 } AND { "ingredientId": "egg_yolk", "qty": 1.5 }. If they eat 4 eggs, output 4 whites and 2 yolks. If they eat 5 eggs, output 5 whites and 2.5 yolks.

ALLOWED INGREDIENT IDs:
The ONLY valid ingredient IDs you can output are from this list:
${catalogString}

OUTPUT FORMAT:
Analyze the user's intent and return a JSON object wrapping ONE of the following actions.

If the user wants to log or add a meal they ate/planned:
{
  "intent": "ADD_CUSTOM",
  "data": {
    "name": "A short, readable name for the meal (e.g. 'Scrambled Eggs & Toast')",
    "parts": [
      { "ingredientId": "egg_whole", "qty": 3, "unit": "piece" },
      { "ingredientId": "whole_wheat_toast", "qty": 2, "unit": "piece" }
    ]
  }
}

If the user wants to edit/modify the current specific slot (requires context):
{
  "intent": "MODIFY",
  "data": {
    "additions": [ { "ingredientId": "...", "qty": 1, "unit": "piece" } ],
    "removals": [ "ingredientId1" ],
    "scale": 1.0 
  }
}

If the user is dining out / cheat meal:
{
  "intent": "DINING_OUT",
  "data": {
    "name": "Restaurant Name / Meal",
    "estimatedCalories": 1200,
    "estimatedProtein": 45,
    "estimatedCarbs": 60,
    "estimatedFats": 35
  }
}

If the user asks for a generic swap but didn't specify exactly what components:
{
  "intent": "GENERAL_SWAP",
  "data": {
    "effort": 1, // 1=easy, 2=med, 3=hard. E.g., "I'm exhausted" -> 1
    "preference": "lighter", // or "heavier", "high-protein", "vegetarian"
    "exclude": [] 
  }
}

If the user asks for a complex or novel meal you CANNOT reasonably build using the EXACT allowed ingredient IDs, estimate the macros based on your knowledge and return:
{
  "intent": "UNVERIFIED_NOVEL_FOOD",
  "data": {
    "name": "A short, readable name for the meal (e.g. 'Mexican Lamb Burrito')",
    "estimatedCalories": 850,
    "estimatedProtein": 45,
    "estimatedCarbs": 60,
    "estimatedFats": 35
  }
}

CRITICAL RULES:
1. ONLY return the JSON. No markdown, no backticks, no conversational text.
2. For ADD_CUSTOM, the "ingredientId" MUST perfectly match the ALLOWED INGREDIENT IDs list exactly. Do not invent IDs.
3. Quantities should be numbers, units should be "g" or "piece" based on the catalog.
`;

export const parseMealIntent = async (userInput, contextSlot = null) => {
  if (!ai) throw new Error("Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local");

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
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1, // Keep it deterministic
        responseMimeType: 'application/json'
      }
    });

    const outputString = response.text;
    if (!outputString) throw new Error("Empty response from AI");

    // Parse the raw text as JSON safely
    try {
      const payload = JSON.parse(outputString);
      return payload;
    } catch (parseError) {
      // Fallback for markdown-wrapped JSON
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
  dailyProteinTarget
}) => {
  if (!ai) throw new Error("Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local");

  // Flatten and compress available meals so we don't blow up the context window
  const availableMeals = [
    ...(mealDatabase.breakfast || []),
    ...(mealDatabase.lunchDinner || []),
    ...(mealDatabase.snack || [])
  ].map(m => ({
    name: m.canonical_name,
    type: (mealDatabase.breakfast || []).includes(m) ? 'breakfast' : ((mealDatabase.lunchDinner || []).includes(m) ? 'lunch/dinner' : 'snack'),
    p: m.protein || 0,
    cal: m.cal || 0,
    c: m.cuisine || 'general'
  }));

  const prompt = `
You are an expert, world-class nutrition planner.
You are tasked with generating a meal plan for the user across multiple upcoming days.

AVAILABLE MEAL CATALOG (JSON format):
${JSON.stringify(availableMeals)}

(You MUST ONLY select meals that perfectly match the \`name\` from this catalog. NEVER invent new meals yourself. STRICTLY OBSERVE MEAL TYPES: You must NEVER schedule a 'breakfast' item for lunch or dinner. You must NEVER schedule a 'lunch/dinner' item for breakfast.)

USER PREFERENCES:
Accepts (Prioritize these): ${JSON.stringify(preferences?.accepts || {})}
Edits (Tweak these): ${JSON.stringify(preferences?.edits || {})}
Avoids (NEVER select these under any circumstances): ${JSON.stringify(preferences?.avoids || {})}

RECENT HISTORY:
The user has recently eaten the following meals. Use this explicitly to find patterns of repetition they like, or meals they want spaced out:
${JSON.stringify(historyMap)}

DATES TO GENERATE:
${JSON.stringify(targetDateKeys)}

DAILY GOAL:
Target Protein per day: ${dailyProteinTarget}g

CRITICAL RULES:
1. INTELLIGENT PATTERN MATCHING (Repetition vs. Variety):
   - Analyze the \`RECENT HISTORY\`.
   - ABSOLUTE REPETITION CEILINGS: A specific 'breakfast' meal can be repeated a MAXIMUM of 4 times in a week. A specific 'lunch/dinner' meal can be repeated a MAXIMUM of 2 times in the entire week.
   - LUNCH AND DINNER VARIETY: Prioritize strict diversity. Do not blindly repeat the same meal just because it fits the macros. Force yourself to find alternative options in the catalog first.
   - NOVELTY PRIORITIZATION: If a valid meal from the catalog (e.g., Fish Curry, Grilled Salmon) has *not* been eaten in the last 7 days, strongly prioritize introducing it to maintain a diverse weekly palate (especially for Lunch).
2. HARD MATHEMATICAL LIMITS:
   - DAILY CARB CAP: The total estimated carbohydrates for the ENTIRE day (Breakfast + Lunch + Dinner) MUST NEVER exceed 130g.
   - MINIMUM MEAL PROTEIN: Every single meal (Breakfast, Lunch, Dinner) MUST contain at least 20g of protein.
   - FAT HEAVY CAP: Only a maximum of ONE meal per day can be "Fat Heavy" (e.g. Cheese/Cream based).
3. FLEXIBLE PROTEIN ANCHORING (10% Concession): The combined total of the generated Breakfast, Lunch, and Dinner does NOT need to be mathematically perfect. You have a ±10% flexible envelope around the user's Target Protein per day. Prioritize culinary variety and logical human sequencing over strict mathematical perfection.
4. PROTEIN DIVERSITY:
   - No single meal can contain two of the same primary protein families (e.g., no chicken and turkey in the same bowl).
   - MEAT & FIBRE RULE: Any meal containing Chicken, Red Meat, or Fish MUST be paired with a high-fibre ingredient (e.g. Vegetables, Salad, or Lentils/Dal). Do not serve plain meat and rice without a vegetable component.
   - Try to use different primary protein families for Lunch and Dinner.
   - LEAN MEAT PRIORITIZATION: Lean heavily towards Chicken and Fish meals throughout the week.
   - RED MEAT CAP: Red meats (Pork, Steak, Lamb) must NEVER exceed 2-3 meals *total* combined across the entire calculated week.
5. CALORIC TAPERING: Structure the day so the heaviest, highest-carb meal is either Breakfast or Lunch. Dinner should be significantly lighter and leaner by comparison.
6. CUISINE SEQUENCING: Lunch and Dinner cannot *both* be Indian cuisine. Do not schedule the same heavy cuisine for Lunch and Dinner on the same day unless the user historically does this.
7. FORMAT: You must output STRICTLY valid JSON in this exact format (no markdown formatting, no backticks, JSON array only):
[
  { "dateKey": "YYYY-MM-DD", "breakfast": "canonical_name", "lunch": "canonical_name", "dinner": "canonical_name" }
]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.7, // Increased variance to force diverse selection
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
