/**
 * Express a dish the user named in the ingredients the app already knows.
 *
 * ── Why this is a constrained tool call and not a prompt ──
 *
 * The output of this function becomes `parts[]`, and `parts[]` becomes macros,
 * and macros are what the optimizer enforces hard rules against. A free-text
 * answer naming `chicken_thigh_boneless` — plausible, well-formed, not in
 * `ingredients.js` — would resolve to nothing, and a dish quietly missing its
 * protein source still reads as a chicken dish on screen.
 *
 * So `ingredientId` is an `enum` of the real ids, built per request from the
 * live catalog. This is the same mechanism `planService.buildSubmitPlanTool`
 * uses to make a hallucinated meal name structurally impossible, applied one
 * level down: there the enum is dish names, here it is ingredient ids.
 *
 * `resolveDraftParts` re-checks every id against the catalog anyway. That is
 * not distrust of the enum; it is that this path also carries hand-edited and
 * synced records, and the check is one `in` per part.
 *
 * ── What the model is and is not asked for ──
 *
 * It is asked to pick ingredients and portions. It is *not* asked for
 * calories, protein, or any other macro — those are computed from the parts by
 * `computeMacros`, from IFCT/USDA figures, exactly as they are for every
 * shipped dish. Asking a model for a macro figure when the ingredient table
 * can produce one is how you get a meal whose stated protein and its
 * ingredients disagree, with nothing to say which is right.
 *
 * It is also asked what it could *not* express. An honest `unmatched` entry is
 * worth more than a forced substitution: "kokum" mapped to "tamarind" to
 * satisfy the schema is a wrong dish presented as a right one, whereas
 * "kokum — no equivalent" is a one-line ingredient to add.
 */

import { ingredients as localIngredients, STANDARD_PORTIONS } from '../data/ingredients.js';
import { CUISINE_OPTIONS, MEAL_SLOT, MEAL_SLOT_LABELS, PART_UNITS, resolveDraftParts } from './userMeals.js';

const PROXY_ENDPOINT = '/api/generate-plan';

// Longer than the Omnibox's 20s because this runs against a bigger system
// prompt (the whole ingredient catalog) and nobody is waiting mid-sentence —
// the user pressed a button on a queue item.
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Build the tool, with the ingredient enum taken from the live catalog.
 *
 * Exported so a test can assert the enum matches `ingredients.js` without a
 * network call — the property that matters here is not what the model says,
 * it is that the schema cannot accept an id the app does not have.
 */
export const buildIngredientEstimateTool = (ingredientIndex = localIngredients) => {
  const ingredientIds = Object.keys(ingredientIndex);

  return {
    name: 'submit_meal_ingredients',
    description:
      'Express the named dish as a list of ingredients and portions drawn only from the provided catalog.',
    input_schema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          description:
            'The dish broken into catalog ingredients with the portion one adult would eat in one sitting.',
          items: {
            type: 'object',
            properties: {
              ingredientId: {
                type: 'string',
                enum: ingredientIds,
                description: 'Must be one of the catalog ids. Never invent one.'
              },
              qty: {
                type: 'number',
                description: 'Grams, or a count when the unit is piece/slice. Cooked weight.'
              },
              unit: { type: 'string', enum: [...PART_UNITS] }
            },
            required: ['ingredientId', 'qty', 'unit']
          }
        },
        cuisine: {
          type: 'string',
          enum: [...CUISINE_OPTIONS],
          description: 'Which of the app\'s cuisine buckets this dish belongs to.'
        },
        unmatched: {
          type: 'array',
          description:
            'Components of the dish with no reasonable equivalent in the catalog. Name them rather than substituting something else.',
          items: { type: 'string' }
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description:
            'high = a standard dish you can portion confidently; low = you are guessing at what the dish contains.'
        },
        notes: {
          type: 'string',
          description: 'One short sentence on any assumption worth the user checking. Optional.'
        }
      },
      required: ['parts', 'cuisine', 'confidence']
    }
  };
};

const buildSystemPrompt = (ingredientIndex) => {
  const catalog = Object.entries(ingredientIndex)
    .map(([id, def]) => {
      const per = def.per100g || {};
      const portion = def.defaultPortion || {};
      const piece = portion.pieceWeightG ? `, 1 ${portion.unit} ≈ ${portion.pieceWeightG}g` : '';
      return `- ${id} — ${def.name} | per 100g: ${per.kcal}kcal ${per.p}p ${per.c}c ${per.f}f | usual portion ${portion.qty}${portion.unit}${piece}`;
    })
    .join('\n');

  return `You convert a named dish into a list of ingredients from a fixed catalog, so that a meal planner can compute its macros.

# What you are doing
The user has added a dish to their meal planner by name. Your job is to say what is in one serving of it, using only the ingredient ids below. The app computes calories and protein itself from your portions and its own nutrition table — so do not estimate macros, estimate *portions*.

# Rules
1. Use only ingredient ids from the catalog. There is no other id.
2. Portions are for ONE adult serving, as cooked and served. The user is a 83kg adult male targeting a high-protein diet, so portions should be generous rather than dainty — but they must be what this dish actually is, not what you wish it were. Do not inflate the protein to make the dish look better.
3. Standard portions when the dish does not imply otherwise:
   - meat/fish: ${STANDARD_PORTIONS.protein_meat.qty}${STANDARD_PORTIONS.protein_meat.unit}
   - paneer/legumes/tofu: ${STANDARD_PORTIONS.protein_veg.qty}${STANDARD_PORTIONS.protein_veg.unit}
   - cooked rice/pasta: ${STANDARD_PORTIONS.carbs_grain.qty}${STANDARD_PORTIONS.carbs_grain.unit}
   - roti/bread/paratha: ${STANDARD_PORTIONS.carbs_bread.qty} ${STANDARD_PORTIONS.carbs_bread.unit}
   - vegetables: ${STANDARD_PORTIONS.vegetables.qty}${STANDARD_PORTIONS.vegetables.unit}
   - cooking oil/fat: ${STANDARD_PORTIONS.fats_oils.qty}${STANDARD_PORTIONS.fats_oils.unit}
4. Include the cooking fat. A home-style curry carries oil and it shows up in the calories; leaving it out makes the dish look leaner than it is.
5. If part of the dish has no reasonable equivalent in the catalog, put it in \`unmatched\` and leave it out of \`parts\`. Do NOT substitute something merely similar to fill the gap — a wrong ingredient is worse than a missing one, because the user cannot see that it happened.
6. If you do not recognise the dish at all, return an empty \`parts\` list, say so in \`notes\`, and set confidence to low. Returning a guess dressed as an answer is the one thing you must not do.
7. \`cuisine\` is the bucket the planner uses for its Indian-lunch rule, so judge it by what the dish is, not by where the user lives.

# Ingredient catalog
${catalog}`;
};

const describeSlot = (slot) => MEAL_SLOT_LABELS[slot] || MEAL_SLOT_LABELS[MEAL_SLOT.LUNCH_DINNER];

/**
 * Ask for the ingredient breakdown of one dish.
 *
 * Resolves to `{ parts, cuisine, unmatched, confidence, notes, dropped }`.
 * `parts` may legitimately be empty — that is the model declining to guess,
 * and the caller renders it as "needs a human", not as an error.
 */
export const estimateMealIngredients = async (
  { name, slot, note = '' } = {},
  { ingredientIndex = localIngredients, fetchImpl = null } = {}
) => {
  const dishName = String(name || '').trim();
  if (!dishName) throw new Error('A dish name is required.');

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('No fetch implementation available.');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  const userMessage = `Dish: "${dishName}"
Meal slot: ${describeSlot(slot)}
${note ? `User's note about it: "${note}"` : 'No further note from the user.'}

Break this into catalog ingredients for one serving.`;

  try {
    const response = await doFetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        system: buildSystemPrompt(ingredientIndex),
        userMessage,
        tool: buildIngredientEstimateTool(ingredientIndex)
      })
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('[mealIngestService] proxy returned non-OK:', payload);
      throw new Error(payload?.error || 'Could not reach the estimator.');
    }

    const data = await response.json();
    const parsed = data?.toolInput;
    if (!parsed || typeof parsed !== 'object') {
      console.error('[mealIngestService] missing toolInput:', data);
      throw new Error('The estimator did not return a structured answer.');
    }

    // Re-validated against the live catalog even though the enum should make
    // this impossible — see the header. Cheap, and it also covers the
    // qty-of-zero case the enum says nothing about.
    const { parts, dropped } = resolveDraftParts(parsed.parts, ingredientIndex);

    return {
      parts,
      dropped,
      cuisine: CUISINE_OPTIONS.includes(parsed.cuisine) ? parsed.cuisine : '',
      unmatched: (Array.isArray(parsed.unmatched) ? parsed.unmatched : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
      notes: String(parsed.notes || '').trim()
    };
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw new Error('The estimator timed out. Try again.');
    }
    console.error('[mealIngestService] estimateMealIngredients failed:', error);
    throw error;
  }
};
