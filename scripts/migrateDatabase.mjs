import fs from 'fs';
import { ingredients } from '../src/data/ingredients.js';

// The input file isn't valid JSON, it's a JS file.
// We'll read it, transform it via regex or AST, and overwrite it.
import { flattenMealDatabase, enrichMealForDataLayer } from '../src/lib/mealDataLayer.js';

// Quick Node.js script to run over `mealDatabase.js` that parses and replaces.
const dbStr = fs.readFileSync('./src/data/mealDatabase.js', 'utf-8');

// To do this safely, we will build a completely new string for the mealDatabase.js.
// Since the meals array is static, we can generate the base object directly.

const rewrite = `import { computeMacros, enrichMealForDataLayer } from '../lib/mealDataLayer.js';

// Base meals converted to the new Ingredient Architecture
const baseMealsList = {
  "breakfast": [
    {
      "meal_id": "breakfast_scrambled-eggs-toast",
      "canonical_name": "Scrambled eggs + toast",
      "display_name": "Scrambled eggs + toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Scrambled eggs + toast",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 3, "unit": "piece" },
        { "ingredientId": "whole_wheat_toast", "qty": 1, "unit": "slice" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 150, "carb": "Whole wheat toast", "carbAmount": 1, "veg": null, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_boiled-eggs-ham-sandwich",
      "canonical_name": "Boiled eggs + ham sandwich",
      "display_name": "Boiled eggs + ham sandwich",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Boiled eggs + ham sandwich",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 3, "unit": "piece" },
        { "ingredientId": "ham_slice", "qty": 1, "unit": "slice" },
        { "ingredientId": "whole_wheat_toast", "qty": 2, "unit": "slice" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 150, "carb": "Whole wheat toast", "carbAmount": 2, "veg": null, "style": "Grilled"
      }
    },
    {
      "meal_id": "breakfast_smoked-salmon-avocado-on-toast",
      "canonical_name": "Smoked salmon + avocado on toast",
      "display_name": "Smoked salmon + avocado on toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Smoked salmon + avocado on toast",
      "parts": [
        { "ingredientId": "smoked_salmon", "qty": 150, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "whole_wheat_toast", "qty": 1, "unit": "slice" }
      ],
      "components": {
        "protein": "Smoked salmon", "amount": 150, "carb": "Whole wheat toast", "carbAmount": 1, "veg": null, "style": "Grilled"
      }
    },
    {
      "meal_id": "breakfast_greek-yogurt-berry-bowl",
      "canonical_name": "Greek yogurt + berry bowl",
      "display_name": "Greek yogurt + berry bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Greek yogurt + berry bowl",
      "parts": [
        { "ingredientId": "greek_yogurt", "qty": 200, "unit": "g" },
        { "ingredientId": "berry_mix", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Grilled"
      }
    },
    {
      "meal_id": "breakfast_poha-kabab-protein-shake",
      "canonical_name": "Poha + kabab/protein shake",
      "display_name": "Poha + Kabab/Protein Shake",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Poha + kabab/protein shake",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 100, "unit": "g" },
        { "ingredientId": "poha", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 100, "carb": "Poha", "carbAmount": 100, "veg": null, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_egg-white-omelette-avocado",
      "canonical_name": "Egg white omelette + avocado",
      "display_name": "Egg white omelette + avocado",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Egg white omelette + avocado",
      "parts": [
        { "ingredientId": "egg_white", "qty": 4, "unit": "piece" },
        { "ingredientId": "egg_whole", "qty": 1, "unit": "piece" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 120, "carb": "No carb", "carbAmount": 0, "veg": "Mixed salad", "vegAmount": 100, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_carrot-halwa-sugar-free-protein-shake",
      "canonical_name": "Carrot halwa (sugar-free) + protein shake",
      "display_name": "Carrot Halwa + Protein Shake",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Carrot halwa (sugar-free) + protein shake",
      "parts": [
        { "ingredientId": "protein_shake", "qty": 1, "unit": "piece" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 100, "unit": "g" } // Approximation for halwa body
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Grilled"
      }
    },
    {
      "meal_id": "breakfast_aloo-paratha-curd",
      "canonical_name": "Aloo paratha + curd",
      "display_name": "Aloo paratha + curd",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Aloo paratha + curd",
      "parts": [
        { "ingredientId": "aloo_paratha", "qty": 2, "unit": "piece" },
        { "ingredientId": "curd", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 70, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": null, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_idli-mysore-masala-dosa-sambar-chutney",
      "canonical_name": "Idli, Mysore masala dosa + sambar + chutney",
      "display_name": "Idli + Mysore Dosa + Sambar",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Idli, Mysore masala dosa + sambar + chutney",
      "parts": [
        { "ingredientId": "idli", "qty": 2, "unit": "piece" },
        { "ingredientId": "masala_dosa", "qty": 1, "unit": "piece" },
        { "ingredientId": "arhar_dal", "qty": 100, "unit": "g" } // Approximation for sambar
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Cooked rice", "carbAmount": 80, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Pan-fried"
      }
    }
  ],
  "lunchDinner": [
    {
      "meal_id": "lunch_dinner_chicken-curry-jowar-roti",
      "canonical_name": "Chicken curry + jowar roti",
      "display_name": "Chicken curry + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Chicken curry + jowar roti",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 50, "unit": "g" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_grilled-salmon-fillet-sauteed-veg-spaghetti-aglio-e-olio",
      "canonical_name": "Grilled salmon fillet + sauteed veg + spaghetti aglio e olio",
      "display_name": "Salmon + Veg + Aglio Olio",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Grilled salmon fillet + sauteed veg + spaghetti aglio e olio",
      "parts": [
        { "ingredientId": "grilled_salmon", "qty": 150, "unit": "g" },
        { "ingredientId": "spaghetti_aglio_olio", "qty": 150, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Grilled salmon", "amount": 150, "carb": "Spaghetti aglio e olio (small portion)", "carbAmount": 100, "veg": "Sautéed broccoli", "vegAmount": 150, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_rajma-chawal-raita",
      "canonical_name": "Rajma chawal + raita",
      "display_name": "Rajma chawal + raita",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Rajma chawal + raita",
      "parts": [
        { "ingredientId": "rajma", "qty": 180, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "curd", "qty": 80, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Cooked rice", "carbAmount": 80, "veg": "Mixed veg sabzi", "vegAmount": 150, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_chole-jowar-roti-raita",
      "canonical_name": "Chole + jowar roti + raita",
      "display_name": "Chole + jowar roti + raita",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Chole + jowar roti + raita",
      "parts": [
        { "ingredientId": "chole", "qty": 200, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curd", "qty": 80, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": null, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_vietnamese-chicken-pho",
      "canonical_name": "Vietnamese chicken pho",
      "display_name": "Vietnamese chicken pho",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Vietnamese chicken pho",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "rice_noodles", "qty": 120, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Rice noodles", "carbAmount": 120, "veg": "Mixed salad", "vegAmount": 60, "style": "Soup style"
      },
      "cuisine": "asian"
    },
    {
      "meal_id": "lunch_dinner_grilled-steak-mixed-greens-salad",
      "canonical_name": "Grilled steak + mixed greens salad",
      "display_name": "Steak + Mixed Greens",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Grilled steak + mixed greens salad",
      "parts": [
        { "ingredientId": "beef_steak", "qty": 180, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Beef steak", "amount": 180, "carb": "No carb", "carbAmount": 0, "veg": "Mixed greens salad", "vegAmount": 150, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_thai-pad-krapow-rice",
      "canonical_name": "Thai pad krapow + rice",
      "display_name": "Thai pad krapow + rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Thai pad krapow + rice",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 80, "veg": "Sautéed peppers", "vegAmount": 80, "style": "Pan-fried"
      },
      "cuisine": "asian"
    },
    {
      "meal_id": "lunch_dinner_mutton-keema-jowar-roti",
      "canonical_name": "Mutton keema + jowar roti",
      "display_name": "Mutton keema + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Mutton keema + jowar roti",
      "parts": [
        { "ingredientId": "mutton_keema", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Mutton keema", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": null, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_arhar-dal-rice-matar-paneer",
      "canonical_name": "Arhar dal + rice + matar paneer",
      "display_name": "Arhar Dal + Rice + Matar Paneer",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Arhar dal + rice + matar paneer",
      "parts": [
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "paneer", "qty": 100, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 120, "carb": "Cooked rice", "carbAmount": 80, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_chicken-curry-jowar-roti-dal",
      "canonical_name": "Chicken curry + jowar roti + dal",
      "display_name": "Chicken Curry + Roti + Dal",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Chicken curry + jowar roti + dal",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "arhar_dal", "qty": 120, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Mixed veg sabzi", "vegAmount": 100, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_grilled-fish-pumpkin-salad",
      "canonical_name": "Grilled fish + pumpkin salad",
      "display_name": "Grilled Fish + Pumpkin Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Grilled fish + pumpkin salad",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 150, "unit": "g" },
        { "ingredientId": "pumpkin_salad", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": "Pumpkin salad", "vegAmount": 120, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_grilled-salmon-sauteed-veg-garlic-rice",
      "canonical_name": "Grilled salmon + sauteed veg + garlic rice",
      "display_name": "Salmon + Veg + Garlic Rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Grilled salmon + sauteed veg + garlic rice",
      "parts": [
        { "ingredientId": "grilled_salmon", "qty": 150, "unit": "g" },
        { "ingredientId": "garlic_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Grilled salmon", "amount": 150, "carb": "Garlic rice (small portion)", "carbAmount": 100, "veg": "Sautéed broccoli", "vegAmount": 150, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_chicken-soup-smoked-salmon-salad",
      "canonical_name": "Chicken soup + smoked salmon salad",
      "display_name": "Chicken Soup + Salmon Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Chicken soup + smoked salmon salad",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 100, "unit": "g" },
        { "ingredientId": "smoked_salmon", "qty": 100, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": "Smoked salmon salad", "vegAmount": 120, "style": "Soup style"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_paneer-sabzi-dal-raita",
      "canonical_name": "Paneer sabzi + dal + raita",
      "display_name": "Paneer sabzi + dal + raita",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Paneer sabzi + dal + raita",
      "parts": [
        { "ingredientId": "paneer", "qty": 120, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "curd", "qty": 100, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 100, "carb": "No carb", "carbAmount": 0, "veg": "Mixed veg sabzi", "vegAmount": 150, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_pork-chop-pumpkin-salad",
      "canonical_name": "Pork chop + pumpkin salad",
      "display_name": "Pork Chop + Pumpkin Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Pork chop + pumpkin salad",
      "parts": [
        { "ingredientId": "pork_chop", "qty": 180, "unit": "g" },
        { "ingredientId": "pumpkin_salad", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Pork chop", "amount": 180, "carb": "No carb", "carbAmount": 0, "veg": "Pumpkin salad", "vegAmount": 120, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_pork-chop-mixed-greens-salad",
      "canonical_name": "Pork chop + mixed greens salad",
      "display_name": "Pork Chop + Mixed Greens",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Pork chop + mixed greens salad",
      "parts": [
        { "ingredientId": "pork_chop", "qty": 180, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Pork chop", "amount": 180, "carb": "No carb", "carbAmount": 0, "veg": "Mixed greens salad", "vegAmount": 150, "style": "Grilled"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_tandoori-chicken-smoked-chicken-avocado-salad",
      "canonical_name": "Tandoori chicken + smoked chicken + avocado salad",
      "display_name": "Tandoori Chicken + Smoked Chicken Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Tandoori chicken + smoked chicken + avocado salad",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "smoked_salmon", "qty": 50, "unit": "g" }, // Using as proxy
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": "Smoked chicken + avocado salad", "vegAmount": 120, "style": "Tandoori"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_broccoli-soup-grilled-fish-spaghetti-aglio-e-olio",
      "canonical_name": "Broccoli soup + grilled fish + spaghetti aglio e olio",
      "display_name": "Broccoli Soup + Fish + Aglio Olio",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Broccoli soup + grilled fish + spaghetti aglio e olio",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 150, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 150, "unit": "g" },
        { "ingredientId": "spaghetti_aglio_olio", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 150, "carb": "Spaghetti aglio e olio (small portion)", "carbAmount": 100, "veg": "Sautéed broccoli", "vegAmount": 200, "style": "Soup style"
      },
      "cuisine": "western"
    },
    {
      "meal_id": "lunch_dinner_saag-meat-jowar-roti-dal",
      "canonical_name": "Saag meat + jowar roti + dal",
      "display_name": "Saag meat + jowar roti + dal",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Saag meat + jowar roti + dal",
      "parts": [
        { "ingredientId": "mutton_keema", "qty": 150, "unit": "g" },
        { "ingredientId": "spinach", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "arhar_dal", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Lamb (seekh kabab)", "amount": 170, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Sautéed spinach", "vegAmount": 120, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_kofta-dal-jowar-roti",
      "canonical_name": "Kofta + dal + jowar roti",
      "display_name": "Kofta + dal + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Kofta + dal + jowar roti",
      "parts": [
        { "ingredientId": "lamb_seekh_kabab", "qty": 150, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Lamb (seekh kabab)", "amount": 140, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_kababs-dal-gobi-jowar-roti",
      "canonical_name": "Kababs + dal + gobi + jowar roti",
      "display_name": "Kababs + Dal + Gobi + Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Kababs + dal + gobi + jowar roti",
      "parts": [
        { "ingredientId": "lamb_seekh_kabab", "qty": 150, "unit": "g" },
        { "ingredientId": "cauliflower", "qty": 150, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 100, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" }
      ],
      "components": {
        "protein": "Lamb (seekh kabab)", "amount": 180, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Cauliflower", "vegAmount": 150, "style": "Tandoori"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_fish-curry-rice",
      "canonical_name": "Fish curry + rice",
      "display_name": "Fish curry + rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Fish curry + rice",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 120, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 150, "carb": "Cooked rice", "carbAmount": 80, "veg": null, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_sweet-potato-curry-kaala-chanaa-sabzi-jowar-roti",
      "canonical_name": "Sweet potato curry + kaala chanaa sabzi + jowar roti",
      "display_name": "Sweet Potato Curry + Kaala Chanaa + Jowar Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Sweet potato curry + kaala chanaa sabzi + jowar roti",
      "parts": [
        { "ingredientId": "sweet_potato", "qty": 150, "unit": "g" },
        { "ingredientId": "kaala_chanaa", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Kaala chanaa (black chickpeas)", "amount": 160, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Sweet potato curry", "vegAmount": 180, "style": "Curry style"
      },
      "cuisine": "indian"
    },
    {
      "meal_id": "lunch_dinner_chicken-red-curry-rice",
      "canonical_name": "Chicken red curry + rice",
      "display_name": "Chicken Red Curry + Rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Chicken red curry + rice",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 120, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 80, "veg": "Red curry vegetables", "vegAmount": 100, "style": "Curry style"
      },
      "cuisine": "asian"
    }
  ],
  "snack": [
    {
      "meal_id": "snack_nuts-seeds-protein-shake",
      "canonical_name": "Nuts, seeds + protein shake",
      "display_name": "Nuts + Seeds + Protein Shake",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Nuts, seeds + protein shake",
      "parts": [
        { "ingredientId": "nuts_seeds", "qty": 30, "unit": "g" },
        { "ingredientId": "protein_shake", "qty": 1, "unit": "piece" }
      ],
      "components": {
        "protein": "Mixed nuts & seeds", "amount": 30, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Raw"
      }
    },
    {
      "meal_id": "snack_sweet-potato-chaat",
      "canonical_name": "Sweet potato chaat",
      "display_name": "Sweet potato chaat",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Sweet potato chaat",
      "parts": [
        { "ingredientId": "sweet_potato", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Sweet potato", "carbAmount": 150, "veg": null, "style": "Chaat"
      }
    },
    {
      "meal_id": "snack_kaala-chana-chaat",
      "canonical_name": "Kaala chana chaat",
      "display_name": "Kaala chana chaat",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Kaala chana chaat",
      "parts": [
        { "ingredientId": "kaala_chanaa", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Kaala chana", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Chaat"
      }
    },
    {
      "meal_id": "snack_avocado-cheese-toast",
      "canonical_name": "Avocado/cheese toast",
      "display_name": "Avocado/Cheese Toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Avocado/cheese toast",
      "parts": [
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "cheese_slice", "qty": 1, "unit": "slice" },
        { "ingredientId": "whole_wheat_toast", "qty": 1, "unit": "slice" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Whole wheat toast", "carbAmount": 1, "veg": "Avocado", "vegAmount": 50, "style": "Toast"
      }
    }
  ]
};

// Auto-inject computed macros to maintain strict backward compatibility
export const mealDatabase = {
  breakfast: baseMealsList.breakfast.map(meal => enrichMealForDataLayer({ ...meal, ...computeMacros(meal.parts) }, 'breakfast')),
  lunchDinner: baseMealsList.lunchDinner.map(meal => enrichMealForDataLayer({ ...meal, ...computeMacros(meal.parts) }, 'lunch_dinner')),
  snack: baseMealsList.snack.map(meal => enrichMealForDataLayer({ ...meal, ...computeMacros(meal.parts) }, 'snack'))
};
`;

fs.writeFileSync('./src/data/mealDatabase.js', rewrite);
