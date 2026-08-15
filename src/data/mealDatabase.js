import {
  computeMacros,
  deriveCarbType,
  deriveMealTags,
  derivePrimaryIngredient,
  enrichMealForDataLayer
} from '../lib/mealDataLayer.js';

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
    },

    // ── Phase 2 additions ────────────────────────────────────────────────
    //
    // Built against the measured envelope in docs/PHASE2_HANDOVER.md §2:
    // ~35-45g protein AND 500-600 kcal AND <=55g carbs, simultaneously.
    // Optimising protein alone is what the handover's middle-row measurement
    // showed does not work — the two 19g breakfasts already in this list are
    // each 1g of protein short of legal and carry 96g of carbs, so making
    // them legal would move the calorie budget and blow the carb one.
    //
    // Each meal below states which budget it is bought for.
    {
      // Calorie-dense and carb-moderate: 40g protein at 55g carbs, which the
      // catalog previously could not do at breakfast at all.
      "meal_id": "breakfast_chicken-keema-bhurji-jowar-roti",
      "canonical_name": "Chicken keema bhurji + jowar roti",
      "display_name": "Chicken Keema Bhurji + Jowar Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Chicken keema bhurji + jowar roti",
      "parts": [
        { "ingredientId": "chicken_keema", "qty": 120, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "cauliflower", "qty": 80, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken keema", "amount": 120, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Cauliflower", "vegAmount": 80, "style": "Pan-fried"
      }
    },
    {
      // The vegetarian entry in the envelope, and the highest-fibre breakfast
      // in the catalog at 10.4g.
      "meal_id": "breakfast_moong-dal-chilla-paneer-hung-curd",
      "canonical_name": "Moong dal chilla + paneer + hung curd",
      "display_name": "Moong Dal Chilla + Paneer",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Moong dal chilla + paneer + hung curd",
      "parts": [
        { "ingredientId": "moong_dal_chilla", "qty": 2, "unit": "piece" },
        { "ingredientId": "paneer", "qty": 60, "unit": "g" },
        { "ingredientId": "greek_yogurt", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 60, "carb": "Moong dal chilla", "carbAmount": 2, "veg": null, "style": "Pan-fried"
      }
    },
    {
      // Lowest-carb of the new set (47g) while still clearing 500 kcal — this
      // is the one that buys carb-budget room on a day with a heavy dinner.
      "meal_id": "breakfast_oats-whey-porridge-nuts",
      "canonical_name": "Oats + whey porridge with nuts",
      "display_name": "Oats + Whey Porridge",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Oats + whey porridge with nuts",
      "parts": [
        { "ingredientId": "rolled_oats", "qty": 45, "unit": "g" },
        { "ingredientId": "milk_toned", "qty": 200, "unit": "g" },
        { "ingredientId": "protein_shake", "qty": 1, "unit": "piece" },
        { "ingredientId": "nuts_seeds", "qty": 15, "unit": "g" }
      ],
      "components": {
        "protein": "Whey protein + milk", "amount": 34, "carb": "Rolled oats", "carbAmount": 45, "veg": null, "style": "Porridge"
      }
    },
    {
      // Highest protein of the new set at 44g, and only 30g of carbs — the
      // breakfast that lets a high-carb Indian dinner still clear the cap.
      "meal_id": "breakfast_chicken-sausage-scrambled-eggs-toast",
      "canonical_name": "Chicken sausage + scrambled eggs + toast",
      "display_name": "Chicken Sausage + Eggs + Toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Chicken sausage + scrambled eggs + toast",
      "parts": [
        { "ingredientId": "chicken_sausage", "qty": 100, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 3, "unit": "piece" },
        { "ingredientId": "whole_wheat_toast", "qty": 2, "unit": "slice" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken sausage + eggs", "amount": 250, "carb": "Whole wheat toast", "carbAmount": 2, "veg": "Mixed greens", "vegAmount": 80, "style": "Pan-fried"
      }
    },
    {
      // The second vegetarian entry, and the only breakfast that clears the
      // envelope without eggs, dairy or meat.
      "meal_id": "breakfast_tofu-spinach-scramble-avocado-toast",
      "canonical_name": "Tofu & spinach scramble + avocado toast",
      "display_name": "Tofu Scramble + Avocado Toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Tofu & spinach scramble + avocado toast",
      "parts": [
        { "ingredientId": "tofu_firm", "qty": 200, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 2, "unit": "slice" },
        { "ingredientId": "spinach", "qty": 100, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Firm tofu", "amount": 200, "carb": "Whole wheat toast", "carbAmount": 2, "veg": "Spinach + greens", "vegAmount": 150, "style": "Pan-fried"
      }
    },
    {
      // South Indian in the envelope. The existing idli/dosa plate is 19g of
      // protein and 96g of carbs; this reaches it by cutting the dosa and
      // adding egg bhurji rather than by lowering the 20g floor.
      "meal_id": "breakfast_idli-sambar-masala-egg-bhurji",
      "canonical_name": "Idli + sambar + masala egg bhurji",
      "display_name": "Idli + Sambar + Egg Bhurji",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Idli + sambar + masala egg bhurji",
      "parts": [
        { "ingredientId": "idli", "qty": 2, "unit": "piece" },
        { "ingredientId": "arhar_dal", "qty": 120, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 4, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 15, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 200, "carb": "Idli", "carbAmount": 2, "veg": "Sambar", "vegAmount": 120, "style": "Steamed"
      }
    },
    {
      // The North Indian paratha breakfast, reached additively: the existing
      // Aloo paratha + curd stays untouched at 19g protein and 96g carbs, and
      // this stuffed version clears both the protein floor and the carb cap
      // on merit. Lower protein than the rest, kept for its calorie density.
      "meal_id": "breakfast_paneer-paratha-curd",
      "canonical_name": "Paneer paratha + curd",
      "display_name": "Paneer paratha + curd",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Paneer paratha + curd",
      "parts": [
        { "ingredientId": "plain_paratha", "qty": 1, "unit": "piece" },
        { "ingredientId": "paneer", "qty": 80, "unit": "g" },
        { "ingredientId": "curd", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 80, "carb": "Whole wheat paratha", "carbAmount": 1, "veg": null, "style": "Pan-fried"
      }
    },

    // ── Batch 3 additions (2026-08-06) ───────────────────────────────────
    //
    // Recipe URLs are attached only where a real, checked source exists.
    // Never fabricate a source for a meal that never had one.
    {
      "meal_id": "breakfast_scrambled-egg-sandwich",
      "canonical_name": "Scrambled egg sandwich",
      "display_name": "Scrambled Egg Sandwich",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Scrambled egg sandwich",
      "recipe_url": "https://www.eatingonadime.com/scrambled-egg-sandwich/",
      "parts": [
        { "ingredientId": "whole_wheat_toast", "qty": 4, "unit": "slice" },
        { "ingredientId": "egg_whole", "qty": 3, "unit": "piece" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 150, "carb": "Whole wheat toast", "carbAmount": 4, "veg": null, "style": "Pan-fried"
      }
    },
    {
      // Protein-boosted so it clears the breakfast floor — the plain bowl
      // (7g protein) cannot serve as breakfast and lives in snacks instead.
      "meal_id": "breakfast_acai-bowl-protein-boosted",
      "canonical_name": "Acai bowl (protein-boosted)",
      "display_name": "Acai Bowl (Protein-Boosted)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Acai bowl (protein-boosted)",
      "recipe_url": "https://www.cookingclassy.com/acai-bowl/",
      "parts": [
        { "ingredientId": "acai_pulp", "qty": 100, "unit": "g" },
        { "ingredientId": "banana", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "strawberries", "qty": 40, "unit": "g" },
        { "ingredientId": "blueberries", "qty": 30, "unit": "g" },
        { "ingredientId": "almonds_5pc", "qty": 5, "unit": "piece" },
        { "ingredientId": "pumpkin_seeds", "qty": 10, "unit": "g" },
        { "ingredientId": "greek_yogurt", "qty": 150, "unit": "g" },
        { "ingredientId": "protein_shake", "qty": 25, "unit": "g" }
      ],
      "components": {
        "protein": "Greek yogurt + whey", "amount": 175, "carb": "Acai + fruit", "carbAmount": 100, "veg": null, "style": "Bowl"
      }
    },

    {
      "meal_id": "breakfast_anda-bhurji-toast",
      "canonical_name": "Anda bhurji + toast",
      "recipe_url": "https://www.sanjeevkapoor.com/Recipe/Anda-Bhurji.html",
      "display_name": "Anda bhurji + toast",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Anda bhurji + toast",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 150, "unit": "g" },
        { "ingredientId": "egg_white", "qty": 100, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 60, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs (whole + whites)", "amount": 250, "carb": "Whole wheat toast", "carbAmount": 60, "veg": null, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_sardines-toast-avocado",
      "canonical_name": "Sardines on toast + avocado",
      "recipe_url": "https://littlesunnykitchen.com/sardines-on-toast/",
      "display_name": "Sardines on Toast + Avocado",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Sardines on toast + avocado",
      "parts": [
        { "ingredientId": "sardines", "qty": 120, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 60, "unit": "g" },
        { "ingredientId": "avocado", "qty": 50, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Sardines", "amount": 120, "carb": "Whole wheat toast", "carbAmount": 60, "veg": "Avocado + greens", "vegAmount": 130, "style": "Toast"
      }
    },
    {
      "meal_id": "breakfast_shakshuka-feta",
      "canonical_name": "Shakshuka with feta",
      "recipe_url": "https://cooking.nytimes.com/recipes/1014721-shakshuka-with-feta",
      "display_name": "Shakshuka with feta",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Shakshuka with feta",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 150, "unit": "g" },
        { "ingredientId": "egg_white", "qty": 80, "unit": "g" },
        { "ingredientId": "tomato_herb_base", "qty": 40, "unit": "g" },
        { "ingredientId": "feta", "qty": 40, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 30, "unit": "g" },
        { "ingredientId": "spinach", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs + feta", "amount": 270, "carb": "Whole wheat toast", "carbAmount": 30, "veg": "Tomato, pepper, spinach", "vegAmount": 120, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "breakfast_cottage-cheese-smoked-salmon-bowl",
      "canonical_name": "Cottage cheese & smoked salmon bowl",
      "recipe_url": "https://lowcarbsimplified.com/smoked-salmon-cottage-cheese-bowl-high-protein/",
      "display_name": "Cottage Cheese & Smoked Salmon",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Cottage cheese & smoked salmon bowl",
      "parts": [
        { "ingredientId": "cottage_cheese", "qty": 180, "unit": "g" },
        { "ingredientId": "smoked_salmon", "qty": 80, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 60, "unit": "g" },
        { "ingredientId": "avocado", "qty": 40, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 60, "unit": "g" }
      ],
      "components": {
        "protein": "Cottage cheese + smoked salmon", "amount": 260, "carb": "Whole wheat toast", "carbAmount": 60, "veg": "Avocado + greens", "vegAmount": 100, "style": "Bowl"
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
      }
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
      }
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
      }
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
      }
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
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" } // bean sprouts, herbs, greens in pho + small side
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Rice noodles", "carbAmount": 120, "veg": "Pho greens + side salad", "vegAmount": 80, "style": "Soup style"
      }
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
      }
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
        { "ingredientId": "curry_base", "qty": 20, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 50, "unit": "g" } // small side salad
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 80, "veg": "Sautéed peppers + side salad", "vegAmount": 130, "style": "Pan-fried"
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
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
      }
    },
    {
      "meal_id": "lunch_dinner_kofta-dal-jowar-roti",
      "canonical_name": "Kofta + dal + jowar roti",
      "display_name": "Kofta + dal + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Kofta + dal + jowar roti",
      "parts": [
        { "ingredientId": "veg_kofta", "qty": 150, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Veg kofta", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Curry style"
      }
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
      }
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
      }
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
      }
    },
    {
      "meal_id": "lunch_dinner_avocado-smoked-salmon-salad",
      "canonical_name": "Avocado and smoked salmon salad",
      "display_name": "Avocado & Smoked Salmon Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Avocado and smoked salmon salad",
      "parts": [
        { "ingredientId": "smoked_salmon", "qty": 120, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 130, "unit": "g" }
      ],
      "components": {
        "protein": "Smoked salmon", "amount": 120, "carb": "No carb", "carbAmount": 0, "veg": "Avocado & mixed greens", "vegAmount": 155, "style": "Salad"
      }
    },
    {
      "meal_id": "lunch_dinner_avocado-smoked-chicken-salad",
      "canonical_name": "Avocado and smoked chicken salad",
      "display_name": "Avocado & Smoked Chicken Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Avocado and smoked chicken salad",
      "parts": [
        { "ingredientId": "smoked_chicken", "qty": 120, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 130, "unit": "g" }
      ],
      "components": {
        "protein": "Smoked chicken breast", "amount": 120, "carb": "No carb", "carbAmount": 0, "veg": "Avocado & mixed greens", "vegAmount": 155, "style": "Salad"
      }
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
      }
    },

    // ── Phase 2 additions: Asian coverage ────────────────────────────────
    //
    // §3.4. Lunch/dinner was 13 Indian / 10 Continental / 3 Asian, while the
    // weekly prompt asks the model to "mix Indian, Continental and Asian
    // through the week" and Tier-3 scoring pays a cuisine-variety bonus it
    // could not actually earn — three dishes cannot fill fourteen slots
    // without tripping the 2-per-week repeat ceiling.
    {
      "meal_id": "lunch_dinner_korean-chicken-bibimbap-bowl",
      "canonical_name": "Korean chicken bibimbap bowl",
      "display_name": "Chicken Bibimbap Bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Korean chicken bibimbap bowl",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "kimchi", "qty": 60, "unit": "g" },
        { "ingredientId": "spinach", "qty": 80, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 100, "veg": "Kimchi + spinach", "vegAmount": 140, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_salmon-teriyaki-soba-noodles",
      "canonical_name": "Salmon teriyaki + soba noodles",
      "display_name": "Salmon Teriyaki + Soba",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Salmon teriyaki + soba noodles",
      "parts": [
        { "ingredientId": "grilled_salmon", "qty": 150, "unit": "g" },
        { "ingredientId": "soba_noodles", "qty": 150, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 120, "unit": "g" },
        { "ingredientId": "teriyaki_glaze", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Grilled salmon", "amount": 150, "carb": "Soba noodles", "carbAmount": 150, "veg": "Bok choy", "vegAmount": 120, "style": "Grilled"
      }
    },
    {
      "meal_id": "lunch_dinner_prawn-stir-fry-edamame-rice-noodles",
      "canonical_name": "Prawn stir-fry + edamame + rice noodles",
      "display_name": "Prawn Stir-fry + Edamame",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Prawn stir-fry + edamame + rice noodles",
      "parts": [
        { "ingredientId": "prawns", "qty": 180, "unit": "g" },
        { "ingredientId": "rice_noodles", "qty": 120, "unit": "g" },
        { "ingredientId": "edamame", "qty": 80, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 25, "unit": "g" }
      ],
      "components": {
        "protein": "Prawns", "amount": 180, "carb": "Rice noodles", "carbAmount": 120, "veg": "Edamame", "vegAmount": 80, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "lunch_dinner_miso-chicken-ramen-egg",
      "canonical_name": "Miso chicken ramen + egg",
      "display_name": "Miso Chicken Ramen",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Miso chicken ramen + egg",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 120, "unit": "g" },
        { "ingredientId": "egg_noodles", "qty": 120, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 1, "unit": "piece" },
        { "ingredientId": "miso_broth", "qty": 200, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 120, "carb": "Egg noodles", "carbAmount": 120, "veg": "Bok choy", "vegAmount": 100, "style": "Soup style"
      }
    },
    {
      // The vegetarian Asian entry. Also lowers the cost of a `vegetarian`
      // ruleset later — that goal currently throws by design.
      "meal_id": "lunch_dinner_tofu-edamame-ramen",
      "canonical_name": "Tofu & edamame ramen",
      "display_name": "Tofu & Edamame Ramen",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Tofu & edamame ramen",
      "parts": [
        { "ingredientId": "tofu_firm", "qty": 180, "unit": "g" },
        { "ingredientId": "egg_noodles", "qty": 100, "unit": "g" },
        { "ingredientId": "miso_broth", "qty": 200, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 120, "unit": "g" },
        { "ingredientId": "edamame", "qty": 60, "unit": "g" }
      ],
      "components": {
        "protein": "Firm tofu", "amount": 180, "carb": "Egg noodles", "carbAmount": 100, "veg": "Bok choy + edamame", "vegAmount": 180, "style": "Soup style"
      }
    },

    // ── Phase 2 additions: the calorie-dense, carb-moderate gap ──────────
    //
    // §3.5, targeted rather than bulk. After the breakfast and Asian work,
    // calories were still the binding budget (37.8% of legal days reach the
    // 1600 kcal floor, against 56.5% under the carb cap), and the reason was
    // visible in one measurement: of 31 lunch/dinner dishes, exactly ONE sat
    // between 600 and 750 kcal with 50g of carbs or less. Every other
    // calorie-dense dish carried 67-127g of carbs, so the only way to reach
    // the calorie floor was to spend the carb budget.
    //
    // These twelve fill that gap: 550-700 kcal at <=55g carbs. They buy
    // calorie headroom without spending carbs, which is the pairing the §2
    // sensitivity measurement says the catalog was missing.
    {
      "meal_id": "lunch_dinner_butter-chicken-jowar-roti",
      "canonical_name": "Butter chicken + jowar roti",
      "display_name": "Butter Chicken + Jowar Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Butter chicken + jowar roti",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 70, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 1.5, "unit": "piece" },
        { "ingredientId": "cauliflower", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 1.5, "veg": "Cauliflower", "vegAmount": 100, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_grilled-chicken-sweet-potato-broccoli",
      "canonical_name": "Grilled chicken + sweet potato + broccoli",
      "display_name": "Grilled Chicken + Sweet Potato",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Grilled chicken + sweet potato + broccoli",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "sweet_potato", "qty": 150, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 150, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Sweet potato", "carbAmount": 150, "veg": "Broccoli", "vegAmount": 150, "style": "Grilled"
      }
    },
    {
      "meal_id": "lunch_dinner_pepper-beef-garlic-rice-greens",
      "canonical_name": "Pepper beef + garlic rice + greens",
      "display_name": "Pepper Beef + Garlic Rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Pepper beef + garlic rice + greens",
      "parts": [
        { "ingredientId": "beef_steak", "qty": 180, "unit": "g" },
        { "ingredientId": "garlic_rice", "qty": 120, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 120, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Beef steak", "amount": 180, "carb": "Garlic rice", "carbAmount": 120, "veg": "Bok choy", "vegAmount": 120, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "lunch_dinner_paneer-tikka-jowar-roti-salad",
      "canonical_name": "Paneer tikka + jowar roti + salad",
      "display_name": "Paneer Tikka + Jowar Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Paneer tikka + jowar roti + salad",
      "parts": [
        { "ingredientId": "paneer", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 1.5, "unit": "piece" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "curd", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 1.5, "veg": "Mixed greens salad", "vegAmount": 100, "style": "Tandoori"
      }
    },
    {
      "meal_id": "lunch_dinner_grilled-salmon-sweet-potato-spinach",
      "canonical_name": "Grilled salmon + sweet potato + spinach",
      "display_name": "Salmon + Sweet Potato + Spinach",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Grilled salmon + sweet potato + spinach",
      "parts": [
        { "ingredientId": "grilled_salmon", "qty": 180, "unit": "g" },
        { "ingredientId": "sweet_potato", "qty": 150, "unit": "g" },
        { "ingredientId": "spinach", "qty": 120, "unit": "g" },
        { "ingredientId": "nuts_seeds", "qty": 10, "unit": "g" }
      ],
      "components": {
        "protein": "Grilled salmon", "amount": 180, "carb": "Sweet potato", "carbAmount": 150, "veg": "Sautéed spinach", "vegAmount": 120, "style": "Grilled"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-biryani-raita",
      "canonical_name": "Chicken biryani + raita",
      "display_name": "Chicken biryani + raita",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Chicken biryani + raita",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 150, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 50, "unit": "g" },
        { "ingredientId": "curd", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 150, "veg": null, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_fish-moilee-rice",
      "canonical_name": "Fish moilee + rice",
      "display_name": "Fish moilee + rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Fish moilee + rice",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 200, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 120, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 70, "unit": "g" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 200, "carb": "Cooked rice", "carbAmount": 120, "veg": "Mixed veg sabzi", "vegAmount": 80, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_egg-curry-dal-jowar-roti",
      "canonical_name": "Egg curry + dal + jowar roti",
      "display_name": "Egg Curry + Dal + Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Egg curry + dal + jowar roti",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 4, "unit": "piece" },
        { "ingredientId": "jowar_roti", "qty": 1, "unit": "piece" },
        { "ingredientId": "arhar_dal", "qty": 80, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 200, "carb": "Jowar roti (millet)", "carbAmount": 1, "veg": "Dal", "vegAmount": 80, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-shawarma-bowl",
      "canonical_name": "Chicken shawarma bowl",
      "display_name": "Chicken shawarma bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Chicken shawarma bowl",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 140, "unit": "g" },
        { "ingredientId": "hummus", "qty": 60, "unit": "g" },
        { "ingredientId": "whole_wheat_toast", "qty": 2, "unit": "slice" },
        { "ingredientId": "mixed_salad", "qty": 120, "unit": "g" },
        { "ingredientId": "avocado", "qty": 0.5, "unit": "piece" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 140, "carb": "Flatbread", "carbAmount": 2, "veg": "Salad + hummus", "vegAmount": 180, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_prawn-curry-rice",
      "canonical_name": "Prawn curry + rice",
      "display_name": "Prawn curry + rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Prawn curry + rice",
      "parts": [
        { "ingredientId": "prawns", "qty": 180, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 110, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 70, "unit": "g" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 70, "unit": "g" }
      ],
      "components": {
        "protein": "Prawns", "amount": 180, "carb": "Cooked rice", "carbAmount": 110, "veg": "Mixed veg sabzi", "vegAmount": 70, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-meatballs-spaghetti-salad",
      "canonical_name": "Chicken meatballs + spaghetti + salad",
      "display_name": "Chicken Meatballs + Spaghetti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Chicken meatballs + spaghetti + salad",
      "parts": [
        { "ingredientId": "chicken_keema", "qty": 180, "unit": "g" },
        { "ingredientId": "spaghetti_aglio_olio", "qty": 150, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken keema", "amount": 180, "carb": "Spaghetti", "carbAmount": 150, "veg": "Mixed greens salad", "vegAmount": 100, "style": "Pan-fried"
      }
    },

    // ── Research batch, 2026-08-03 ───────────────────────────────────────
    //
    // Weighted toward the two gaps the audit identified: the 600-750 kcal /
    // <=50g carb / 45g+ protein band, and vegetarian dishes clearing 35g of
    // protein. Note that soya chunks and tofu, not paneer, are what actually
    // unlock vegetarian protein — paneer is only 18g protein per 100g against
    // 20g of fat, so a paneer dish reaches 35g by adding dal or chickpeas and
    // arrives carrying 30-43g of fat.
    {
      "meal_id": "lunch_dinner_palak-paneer-jowar-roti",
      "canonical_name": "Palak paneer + jowar roti",
      "recipe_url": "https://hebbarskitchen.com/palak-paneer-recipe-restaurant-style/",
      "display_name": "Palak paneer + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Palak paneer + jowar roti",
      "parts": [
        { "ingredientId": "paneer", "qty": 150, "unit": "g" },
        { "ingredientId": "spinach", "qty": 200, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 40, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 50, "veg": "Spinach", "vegAmount": 200, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_achari-paneer-tikka-dal-salad",
      "canonical_name": "Achari paneer tikka + dal + salad",
      "recipe_url": "https://hebbarskitchen.com/easy-achari-paneer-tikka-recipe-tawa/",
      "display_name": "Achari Paneer Tikka + Dal",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Achari paneer tikka + dal + salad",
      "parts": [
        { "ingredientId": "paneer", "qty": 150, "unit": "g" },
        { "ingredientId": "curd", "qty": 50, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": "Dal + salad", "vegAmount": 250, "style": "Tandoori"
      }
    },
    {
      "meal_id": "lunch_dinner_soya-keema-curry-jowar-roti",
      "canonical_name": "Soya keema curry + jowar roti",
      "recipe_url": "https://hebbarskitchen.com/meal-maker-curry-recipe-soya-chunks/",
      "display_name": "Soya Keema + Jowar Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Soya keema curry + jowar roti",
      "parts": [
        { "ingredientId": "soya_chunks", "qty": 70, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 60, "unit": "g" },
        { "ingredientId": "curd", "qty": 50, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Soya chunks (minced)", "amount": 70, "carb": "Jowar roti (millet)", "carbAmount": 30, "veg": null, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_chole-paneer-bowl-salad",
      "canonical_name": "Chole-paneer bowl + salad",
      "recipe_url": "https://www.indianhealthyrecipes.com/chana-paneer-recipe-paneer-chana-masala/",
      "display_name": "Chole-Paneer Bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chole-paneer bowl + salad",
      "parts": [
        { "ingredientId": "chole", "qty": 150, "unit": "g" },
        { "ingredientId": "paneer", "qty": 120, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer + chole", "amount": 270, "carb": "No carb", "carbAmount": 0, "veg": "Mixed greens salad", "vegAmount": 100, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_kadai-chicken-jowar-roti",
      "canonical_name": "Kadai chicken + jowar roti",
      "recipe_url": "https://www.indianhealthyrecipes.com/kadai-chicken/",
      "display_name": "Kadai chicken + jowar roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Kadai chicken + jowar roti",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 160, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 60, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 160, "carb": "Jowar roti (millet)", "carbAmount": 50, "veg": "Capsicum + salad", "vegAmount": 80, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_tandoori-fish-tikka-veg-roti",
      "canonical_name": "Tandoori fish tikka + sauteed veg + roti",
      "recipe_url": "https://www.indianhealthyrecipes.com/fish-tikka-in-oven/",
      "display_name": "Tandoori Fish Tikka + Veg",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Tandoori fish tikka + sauteed veg + roti",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 220, "unit": "g" },
        { "ingredientId": "curd", "qty": 50, "unit": "g" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 100, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 220, "carb": "Jowar roti (millet)", "carbAmount": 40, "veg": "Mixed veg sabzi", "vegAmount": 100, "style": "Tandoori"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-keema-matar-jowar-roti",
      "canonical_name": "Chicken keema matar + jowar roti",
      "recipe_url": "https://www.ruchiskitchen.com/chicken-keema-recipe/",
      "display_name": "Chicken Keema Matar + Roti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chicken keema matar + jowar roti",
      "parts": [
        { "ingredientId": "chicken_keema", "qty": 180, "unit": "g" },
        { "ingredientId": "curry_base", "qty": 50, "unit": "g" },
        { "ingredientId": "edamame", "qty": 60, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 40, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken keema", "amount": 180, "carb": "Jowar roti (millet)", "carbAmount": 40, "veg": "Peas / edamame", "vegAmount": 60, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_beef-bulgogi-bowl",
      "canonical_name": "Beef bulgogi bowl",
      "recipe_url": "https://www.maangchi.com/recipe/bulgogi",
      "display_name": "Beef bulgogi bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Beef bulgogi bowl",
      "parts": [
        { "ingredientId": "beef_steak", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "kimchi", "qty": 80, "unit": "g" },
        { "ingredientId": "spinach", "qty": 100, "unit": "g" },
        { "ingredientId": "teriyaki_glaze", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Beef steak (lean sirloin)", "amount": 150, "carb": "Cooked rice", "carbAmount": 100, "veg": "Kimchi + spinach", "vegAmount": 180, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_tofu-veg-bibimbap",
      "canonical_name": "Tofu & vegetable bibimbap",
      "recipe_url": "https://www.maangchi.com/recipe/bibimbap",
      "display_name": "Tofu & Veg Bibimbap",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Tofu & vegetable bibimbap",
      "parts": [
        { "ingredientId": "tofu_firm", "qty": 200, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 90, "unit": "g" },
        { "ingredientId": "kimchi", "qty": 80, "unit": "g" },
        { "ingredientId": "spinach", "qty": 100, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 50, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 10, "unit": "g" }
      ],
      "components": {
        "protein": "Firm tofu + egg", "amount": 250, "carb": "Cooked rice", "carbAmount": 90, "veg": "Kimchi + spinach namul", "vegAmount": 180, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_oyakodon-side-salad",
      "canonical_name": "Oyakodon + side salad",
      "recipe_url": "https://www.justonecookbook.com/oyakodon/",
      "display_name": "Oyakodon (chicken & egg)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Oyakodon + side salad",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 140, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 100, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 120, "unit": "g" },
        { "ingredientId": "teriyaki_glaze", "qty": 25, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast + egg", "amount": 240, "carb": "Cooked rice", "carbAmount": 120, "veg": "Side salad", "vegAmount": 80, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_dubu-jorim-rice-kimchi",
      "canonical_name": "Dubu jorim + rice + kimchi",
      "recipe_url": "https://www.maangchi.com/recipe/dubu-jorim",
      "display_name": "Dubu Jorim (braised tofu)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Dubu jorim + rice + kimchi",
      "parts": [
        { "ingredientId": "tofu_firm", "qty": 220, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 90, "unit": "g" },
        { "ingredientId": "kimchi", "qty": 100, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 12, "unit": "g" }
      ],
      "components": {
        "protein": "Firm tofu", "amount": 220, "carb": "Cooked rice", "carbAmount": 90, "veg": "Kimchi", "vegAmount": 100, "style": "Curry style"
      }
    },
    {
      "meal_id": "lunch_dinner_home-style-tofu-chicken-stir-fry",
      "canonical_name": "Home-style tofu & chicken stir-fry",
      "recipe_url": "https://thewoksoflife.com/home-style-tofu-stir-fry/",
      "display_name": "Home-Style Tofu & Chicken",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Home-style tofu & chicken stir-fry",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 120, "unit": "g" },
        { "ingredientId": "tofu_firm", "qty": 120, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 20, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast + tofu", "amount": 240, "carb": "Cooked rice", "carbAmount": 80, "veg": "Broccoli", "vegAmount": 150, "style": "Pan-fried"
      }
    },
    {
      "meal_id": "lunch_dinner_vietnamese-lemongrass-chicken-bowl",
      "canonical_name": "Vietnamese lemongrass chicken bowl",
      "recipe_url": "https://helenrecipes.com/recipe-51-ga-xao-sa-ot-lemongrass-chili-chicken/",
      "display_name": "Lemongrass Chicken Bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Vietnamese lemongrass chicken bowl",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 170, "unit": "g" },
        { "ingredientId": "rice_noodles", "qty": 100, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 120, "unit": "g" },
        { "ingredientId": "raw_vegetables", "qty": 50, "unit": "g" },
        { "ingredientId": "nuts_seeds", "qty": 15, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 170, "carb": "Rice noodles", "carbAmount": 100, "veg": "Herb salad + pickles", "vegAmount": 170, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_cantonese-steamed-fish-edamame",
      "canonical_name": "Cantonese steamed fish + edamame + rice",
      "recipe_url": "https://www.madewithlau.com/recipes/steamed-fish",
      "display_name": "Steamed Fish + Edamame",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Cantonese steamed fish + edamame + rice",
      "parts": [
        { "ingredientId": "fish_fillet", "qty": 200, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 150, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 90, "unit": "g" },
        { "ingredientId": "edamame", "qty": 80, "unit": "g" },
        { "ingredientId": "sesame_stirfry_base", "qty": 12, "unit": "g" }
      ],
      "components": {
        "protein": "Fish fillet", "amount": 200, "carb": "Cooked rice", "carbAmount": 90, "veg": "Bok choy + edamame", "vegAmount": 230, "style": "Steamed"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-bulgogi-bowl",
      "canonical_name": "Chicken bulgogi bowl",
      "recipe_url": "https://www.koreanbapsang.com/dak-bulgogi-korean-bbq-chicken/",
      "display_name": "Chicken bulgogi bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chicken bulgogi bowl",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 180, "unit": "g" },
        { "ingredientId": "cooked_rice", "qty": 100, "unit": "g" },
        { "ingredientId": "kimchi", "qty": 80, "unit": "g" },
        { "ingredientId": "bok_choy", "qty": 100, "unit": "g" },
        { "ingredientId": "gochujang", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 180, "carb": "Cooked rice", "carbAmount": 100, "veg": "Kimchi + bok choy", "vegAmount": 180, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-souvlaki-tzatziki-greek-salad",
      "canonical_name": "Chicken souvlaki + tzatziki + Greek salad",
      "recipe_url": "https://www.themediterraneandish.com/greek-chicken-souvlaki-recipe-tzatziki/",
      "display_name": "Chicken Souvlaki + Greek Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chicken souvlaki + tzatziki + Greek salad",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 180, "unit": "g" },
        { "ingredientId": "greek_yogurt", "qty": 100, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 120, "unit": "g" },
        { "ingredientId": "feta", "qty": 30, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 8, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 180, "carb": "No carb", "carbAmount": 0, "veg": "Greek salad + tzatziki", "vegAmount": 220, "style": "Grilled"
      }
    },
    {
      "meal_id": "lunch_dinner_baked-feta-chickpea-traybake",
      "canonical_name": "Baked feta & chickpea traybake",
      "recipe_url": "https://ottolenghi.co.uk/pages/recipes/braised-chickpeas-with-carrots-dates-and-feta",
      "display_name": "Baked Feta & Chickpea Traybake",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Baked feta & chickpea traybake",
      "parts": [
        { "ingredientId": "chole", "qty": 130, "unit": "g" },
        { "ingredientId": "feta", "qty": 90, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 8, "unit": "g" },
        { "ingredientId": "greek_yogurt", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Feta + chickpeas", "amount": 220, "carb": "No carb", "carbAmount": 0, "veg": "Roast vegetables + greens", "vegAmount": 100, "style": "Plate"
      }
    },
    {
      "meal_id": "lunch_dinner_tuna-nicoise-salad",
      "canonical_name": "Tuna Nicoise salad",
      "recipe_url": "https://www.foodnetwork.com/recipes/food-network-kitchen/classic-nicoise-salad-recipe-2127613",
      "display_name": "Tuna Nicoise salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Tuna Nicoise salad",
      "parts": [
        { "ingredientId": "tuna_water", "qty": 150, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 100, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 150, "unit": "g" },
        { "ingredientId": "olives_black", "qty": 30, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 8, "unit": "g" },
        { "ingredientId": "sweet_potato", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Tuna + egg", "amount": 250, "carb": "Sweet potato", "carbAmount": 80, "veg": "Salad + olives", "vegAmount": 180, "style": "Salad"
      }
    },
    {
      "meal_id": "lunch_dinner_halloumi-roasted-veg-quinoa-bowl",
      "canonical_name": "Halloumi & roasted-veg quinoa bowl",
      "recipe_url": "https://www.bbcgoodfoodme.com/recipes/halloumi-traybake/",
      "display_name": "Halloumi & Quinoa Bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Halloumi & roasted-veg quinoa bowl",
      "parts": [
        { "ingredientId": "halloumi", "qty": 100, "unit": "g" },
        { "ingredientId": "quinoa_cooked", "qty": 120, "unit": "g" },
        { "ingredientId": "broccoli", "qty": 120, "unit": "g" },
        { "ingredientId": "greek_yogurt", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Halloumi", "amount": 100, "carb": "Quinoa", "carbAmount": 120, "veg": "Roast broccoli", "vegAmount": 120, "style": "Bowl"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-white-bean-stew",
      "canonical_name": "Chicken & white-bean stew",
      "recipe_url": "https://www.recipetineats.com/tuscan-chicken-stew/",
      "display_name": "Chicken & White-Bean Stew",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chicken & white-bean stew",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "white_beans", "qty": 150, "unit": "g" },
        { "ingredientId": "tomato_herb_base", "qty": 40, "unit": "g" },
        { "ingredientId": "spinach", "qty": 100, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 10, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast + white beans", "amount": 270, "carb": "No carb", "carbAmount": 0, "veg": "Spinach + tomato", "vegAmount": 140, "style": "Soup style"
      }
    },
    {
      "meal_id": "lunch_dinner_chickpea-pasta-tuna-tomato",
      "canonical_name": "Chickpea pasta with tuna & tomato",
      "recipe_url": "https://www.healthyfood.com/healthy-recipes/tuna-and-chickpea-pasta/",
      "display_name": "Chickpea Pasta with Tuna",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chickpea pasta with tuna & tomato",
      "parts": [
        { "ingredientId": "chickpea_pasta", "qty": 155, "unit": "g" },
        { "ingredientId": "tuna_water", "qty": 120, "unit": "g" },
        { "ingredientId": "tomato_herb_base", "qty": 40, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 8, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Tuna", "amount": 120, "carb": "Chickpea pasta", "carbAmount": 155, "veg": "Arrabbiata + side salad", "vegAmount": 120, "style": "Plate"
      }
    },
    {
      "meal_id": "lunch_dinner_chicken-ricotta-carbonara-style-spaghetti",
      "canonical_name": "Chicken & ricotta carbonara-style spaghetti",
      "recipe_url": "https://www.hungryhealthyhappy.com/high-protein-chicken-carbonara/",
      "display_name": "Chicken & Ricotta Spaghetti",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Chicken & ricotta carbonara-style spaghetti",
      "parts": [
        { "ingredientId": "spaghetti_aglio_olio", "qty": 150, "unit": "g" },
        { "ingredientId": "chicken_breast", "qty": 120, "unit": "g" },
        { "ingredientId": "ricotta_partskim", "qty": 60, "unit": "g" },
        { "ingredientId": "egg_whole", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast + ricotta", "amount": 180, "carb": "Spaghetti", "carbAmount": 150, "veg": null, "style": "Plate"
      }
    },
    {
      "meal_id": "lunch_dinner_mackerel-quinoa-salad",
      "canonical_name": "Mackerel & quinoa salad",
      "recipe_url": "https://thecookreport.co.uk/smoked-mackerel-salad/",
      "display_name": "Mackerel & Quinoa Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_03",
      "name": "Mackerel & quinoa salad",
      "parts": [
        { "ingredientId": "mackerel_canned", "qty": 120, "unit": "g" },
        { "ingredientId": "quinoa_cooked", "qty": 120, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 120, "unit": "g" },
        { "ingredientId": "avocado", "qty": 40, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" }
      ],
      "components": {
        "protein": "Mackerel", "amount": 120, "carb": "Quinoa", "carbAmount": 120, "veg": "Salad + avocado", "vegAmount": 160, "style": "Salad"
      }
    },

    // ── Batch 3 additions (2026-08-06) ───────────────────────────────────
    //
    // "Fish tikka plate" and "plain paneer tikka" from this research batch
    // were dropped as duplicates — already covered by "Tandoori fish tikka +
    // sauteed veg + roti" and "Paneer tikka + jowar roti + salad" /
    // "Achari paneer tikka + dal + salad". "Home-style chicken biryani"
    // (150g-rice build) was dropped for the same reason: near-identical to
    // the existing "Chicken biryani + raita" (629/55/54/19). Adding either
    // would be clutter, not coverage.
    {
      "meal_id": "lunch_dinner_grilled-chicken-veg-pasta",
      "canonical_name": "Grilled chicken, veg + pasta",
      "display_name": "Grilled Chicken, Veg & Pasta",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Grilled chicken, veg + pasta",
      "recipe_url": "https://www.delallo.com/recipe/summer-pesto-pasta-with-grilled-chicken-vegetables/",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 150, "unit": "g" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 100, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" },
        { "ingredientId": "spaghetti_aglio_olio", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Spaghetti", "carbAmount": 100, "veg": "Sabzi + salad", "vegAmount": 180, "style": "Grilled"
      }
    },
    {
      // Rice-plate variant of "Chicken shawarma bowl" (533/57/38/17/11.2).
      // Heavier and less fibre (more rice, less bowl veg) — genuinely
      // different, not a re-add of the same dish.
      "meal_id": "lunch_dinner_chicken-shawarma-plate-garlic-rice",
      "canonical_name": "Chicken shawarma plate + garlic rice",
      "display_name": "Chicken Shawarma Plate + Rice",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Chicken shawarma plate + garlic rice",
      "recipe_url": "https://www.hungrypaprikas.com/shawarma-rice/",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 180, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 8, "unit": "g" },
        { "ingredientId": "garlic_rice", "qty": 150, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "hummus", "qty": 20, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 180, "carb": "Garlic rice", "carbAmount": 150, "veg": "Salad + hummus", "vegAmount": 120, "style": "Plate"
      }
    },
    {
      // Leaner than the malai/achari tikkas already in the catalog — no
      // cream, no dal. Genuinely distinct, not a re-add.
      "meal_id": "lunch_dinner_plain-chicken-tikka-plate",
      "canonical_name": "Plain chicken tikka plate",
      "display_name": "Plain Chicken Tikka Plate",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Plain chicken tikka plate",
      "recipe_url": "https://www.indianhealthyrecipes.com/chicken-tikka-in-oven/",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 180, "unit": "g" },
        { "ingredientId": "curd", "qty": 30, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 45, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 180, "carb": "Jowar roti (millet)", "carbAmount": 45, "veg": "Mixed greens salad", "vegAmount": 100, "style": "Tandoori"
      }
    },
    {
      // Millet-pasta pesto main. Carbs sit right at the ceiling by design —
      // do not increase the pasta portion beyond 60g dry.
      "meal_id": "lunch_dinner_pesto-millet-pasta-chicken",
      "canonical_name": "Pesto millet pasta + chicken",
      "display_name": "Pesto Millet Pasta + Chicken",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Pesto millet pasta + chicken",
      "recipe_url": "https://spicedblog.com/pesto-pasta-grilled-chicken/",
      "parts": [
        { "ingredientId": "millet_pasta_dry", "qty": 60, "unit": "g" },
        { "ingredientId": "basil_pesto", "qty": 30, "unit": "g" },
        { "ingredientId": "chicken_breast", "qty": 120, "unit": "g" },
        { "ingredientId": "raw_vegetables", "qty": 50, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast", "amount": 120, "carb": "Millet pasta", "carbAmount": 60, "veg": "Cherry tomatoes", "vegAmount": 50, "style": "Plate"
      }
    },
    {
      // Millet-pasta aglio e olio. The protein add (prawns) is mandatory —
      // plain aglio e olio falls well short of the 20g floor on its own.
      "meal_id": "lunch_dinner_aglio-olio-millet-pasta-prawns",
      "canonical_name": "Aglio e olio millet pasta + prawns",
      "display_name": "Aglio e Olio Millet Pasta + Prawns",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Aglio e olio millet pasta + prawns",
      "recipe_url": "https://simply-delicious-food.com/easy-shrimp-aglio-e-olio/",
      "parts": [
        { "ingredientId": "millet_pasta_dry", "qty": 60, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 12, "unit": "g" },
        { "ingredientId": "prawns", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Prawns", "amount": 150, "carb": "Millet pasta", "carbAmount": 60, "veg": null, "style": "Plate"
      }
    },
    {
      // Fresh-grilled, distinct from the existing "Avocado and smoked salmon
      // salad" (206/24/6/9/4) — roughly double the calories and fat, from
      // grilled salmon's higher fat plus dressing oil. Not a duplicate.
      "meal_id": "lunch_dinner_salmon-avocado-salad-fresh-grilled",
      "canonical_name": "Salmon avocado salad (fresh grilled)",
      "display_name": "Fresh Grilled Salmon & Avocado Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Salmon avocado salad (fresh grilled)",
      "recipe_url": "https://www.laylita.com/recipes/grilled-salmon-and-avocado-salad/",
      "parts": [
        { "ingredientId": "grilled_salmon", "qty": 120, "unit": "g" },
        { "ingredientId": "avocado", "qty": 70, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" }
      ],
      "components": {
        "protein": "Grilled salmon", "amount": 120, "carb": "No carb", "carbAmount": 0, "veg": "Avocado + greens", "vegAmount": 170, "style": "Salad"
      }
    },
    {
      // Full lunch-size version of "Avocado and smoked chicken salad"
      // (244/33/6/9/4), which stays as the light-side entry. This scales
      // the chicken and salad up to a genuine 42g-protein lunch portion.
      "meal_id": "lunch_dinner_smoked-chicken-salad-full",
      "canonical_name": "Smoked chicken salad (full size)",
      "display_name": "Smoked Chicken Salad (Full Size)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Smoked chicken salad (full size)",
      "recipe_url": "https://www.nospoonnecessary.com/greek-chicken-loaded-hummus-bowl/",
      "parts": [
        { "ingredientId": "smoked_chicken", "qty": 150, "unit": "g" },
        { "ingredientId": "avocado", "qty": 60, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 120, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" }
      ],
      "components": {
        "protein": "Smoked chicken breast", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": "Avocado + greens", "vegAmount": 180, "style": "Salad"
      }
    },
    {
      "meal_id": "lunch_dinner_hummus-salad-protein-boosted",
      "canonical_name": "Hummus salad (protein-boosted)",
      "display_name": "Hummus Salad (Protein-Boosted)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Hummus salad (protein-boosted)",
      "recipe_url": "https://www.justalittlebitofbacon.com/chicken-souvlaki-hummus-bowl/",
      "parts": [
        { "ingredientId": "chicken_breast", "qty": 120, "unit": "g" },
        { "ingredientId": "hummus", "qty": 80, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "raw_vegetables", "qty": 80, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" }
      ],
      "components": {
        "protein": "Chicken breast + hummus", "amount": 200, "carb": "No carb", "carbAmount": 0, "veg": "Salad + raw veg", "vegAmount": 180, "style": "Bowl"
      }
    },
    {
      // Leaner build of the existing "Sweet potato curry + kaala chanaa
      // sabzi + jowar roti" (731/23/127/15) — cuts carbs 127g to ~97g and
      // calories 731 to ~525 by shrinking the roti and sweet potato. Still
      // does not clear the <=55g carb envelope on any honest portioning;
      // kept as an occasional carb-day meal, not claimed as compliant.
      "meal_id": "lunch_dinner_sweet-potato-kaala-chana-leaner",
      "canonical_name": "Sweet potato + kaala chana + roti (leaner)",
      "display_name": "Sweet Potato & Kaala Chana (Leaner)",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Sweet potato + kaala chana + roti (leaner)",
      "recipe_url": "https://www.indianhealthyrecipes.com/kala-chana/",
      "parts": [
        { "ingredientId": "kaala_chanaa", "qty": 180, "unit": "g" },
        { "ingredientId": "sweet_potato", "qty": 100, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 45, "unit": "g" }
      ],
      "components": {
        "protein": "Kaala chanaa (black chickpeas)", "amount": 180, "carb": "Jowar roti (millet) + sweet potato", "carbAmount": 45, "veg": null, "style": "Curry style"
      }
    },
    {
      // Full lunch/dinner version of the paneer cutlets — the 2-cutlet
      // snack version lives in snacks below.
      "meal_id": "lunch_dinner_paneer-cutlets-dal-salad",
      "canonical_name": "Paneer cutlets + dal + salad",
      "display_name": "Paneer Cutlets + Dal + Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Paneer cutlets + dal + salad",
      "recipe_url": "https://hebbarskitchen.com/paneer-cutlet-recipe-paneer-starter/",
      "parts": [
        { "ingredientId": "paneer", "qty": 110, "unit": "g" },
        { "ingredientId": "besan", "qty": 15, "unit": "g" },
        { "ingredientId": "breadcrumbs_panko", "qty": 15, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 9, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer cutlets + dal", "amount": 260, "carb": "Besan + breadcrumbs", "carbAmount": 30, "veg": "Mixed greens salad", "vegAmount": 100, "style": "Pan-fried"
      }
    }
  ],
  "snack": [
    {
      "meal_id": "snack_fruit-almonds-plant-shake",
      "canonical_name": "Fruit + Almonds + Plant Shake",
      "display_name": "Fruit + Almonds + Plant Shake",
      "nutrition_source": "USDA + custom user specs",
      "assumption_version": "v1_custom",
      "name": "Fruit + Almonds + Plant Shake",
      "parts": [
        { "ingredientId": "mixed_fruit_100g", "qty": 100, "unit": "g" },
        { "ingredientId": "almonds_5pc", "qty": 5, "unit": "piece" },
        { "ingredientId": "plant_protein_shake_25g", "qty": 25, "unit": "g" }
      ],
      "components": {
        "protein": "Plant Shake", "amount": 25, "carb": "Mixed Fruit", "carbAmount": 100, "veg": "Almonds", "vegAmount": 5, "style": "Snack"
      }
    },
    {
      "meal_id": "snack_chaat-bhel-protein-shake",
      "canonical_name": "Chaat + Bhel + Protein Shake",
      "display_name": "Chaat + Bhel + Protein Shake",
      "nutrition_source": "IFCT/USDA + custom user specs",
      "assumption_version": "v1_custom",
      "name": "Chaat + Bhel + Protein Shake",
      "parts": [
        { "ingredientId": "half_bhel_puri_no_potato", "qty": 75, "unit": "g" },
        { "ingredientId": "half_papdi_chaat_baked", "qty": 75, "unit": "g" },
        { "ingredientId": "plant_protein_shake_25g", "qty": 25, "unit": "g" }
      ],
      "components": {
        "protein": "Plant Shake", "amount": 25, "carb": "Chaat & Bhel", "carbAmount": 150, "style": "Street Food Twist"
      }
    },
    {
      "meal_id": "snack_greek-yogurt-berry-bowl",
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
      "meal_id": "snack_carrot-halwa-sugar-free-protein-shake",
      "canonical_name": "Carrot halwa (sugar-free) + protein shake",
      "display_name": "Carrot Halwa + Protein Shake",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_02_17",
      "name": "Carrot halwa (sugar-free) + protein shake",
      "parts": [
        { "ingredientId": "protein_shake", "qty": 1, "unit": "piece" },
        { "ingredientId": "mixed_veg_sabzi", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Grilled"
      }
    },
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
    },

    // ── Phase 2 additions ────────────────────────────────────────────────
    //
    // Snacks are not read by the 3-slot planner, so these cost nothing in
    // enumeration; they exist for the Omnibox and manual logging.
    {
      "meal_id": "snack_boiled-eggs-hummus-veg-sticks",
      "canonical_name": "Boiled eggs + hummus + veg sticks",
      "display_name": "Eggs + Hummus + Veg Sticks",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Boiled eggs + hummus + veg sticks",
      "parts": [
        { "ingredientId": "egg_whole", "qty": 2, "unit": "piece" },
        { "ingredientId": "hummus", "qty": 50, "unit": "g" },
        { "ingredientId": "raw_vegetables", "qty": 100, "unit": "g" }
      ],
      "components": {
        "protein": "Eggs (whole)", "amount": 100, "carb": "No carb", "carbAmount": 0, "veg": "Raw vegetable sticks", "vegAmount": 100, "style": "Snack"
      }
    },
    {
      "meal_id": "snack_edamame-sea-salt",
      "canonical_name": "Edamame + sea salt",
      "display_name": "Edamame + sea salt",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Edamame + sea salt",
      "parts": [
        { "ingredientId": "edamame", "qty": 150, "unit": "g" }
      ],
      "components": {
        "protein": "Edamame", "amount": 150, "carb": "No carb", "carbAmount": 0, "veg": null, "style": "Steamed"
      }
    },
    {
      "meal_id": "snack_paneer-tikka-skewers",
      "canonical_name": "Paneer tikka skewers",
      "display_name": "Paneer tikka skewers",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Paneer tikka skewers",
      "parts": [
        { "ingredientId": "paneer", "qty": 80, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 60, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 80, "carb": "No carb", "carbAmount": 0, "veg": "Mixed greens", "vegAmount": 60, "style": "Tandoori"
      }
    },
    {
      "meal_id": "snack_overnight-oats-whey-bowl",
      "canonical_name": "Overnight oats + whey bowl",
      "display_name": "Overnight Oats + Whey",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_02",
      "name": "Overnight oats + whey bowl",
      "parts": [
        { "ingredientId": "rolled_oats", "qty": 25, "unit": "g" },
        { "ingredientId": "milk_toned", "qty": 150, "unit": "g" },
        { "ingredientId": "berry_mix", "qty": 60, "unit": "g" }
      ],
      "components": {
        "protein": "Milk", "amount": 150, "carb": "Rolled oats", "carbAmount": 25, "veg": "Mixed berries", "vegAmount": 60, "style": "Bowl"
      }
    },

    // ── Batch 3 additions (2026-08-06) ───────────────────────────────────
    {
      "meal_id": "snack_hummus-salad",
      "canonical_name": "Hummus salad",
      "display_name": "Hummus Salad",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Hummus salad",
      "recipe_url": "https://feelgoodfoodie.net/recipe/mediterranean-hummus-bowl/",
      "parts": [
        { "ingredientId": "hummus", "qty": 60, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 100, "unit": "g" },
        { "ingredientId": "raw_vegetables", "qty": 80, "unit": "g" }
      ],
      "components": {
        "protein": "Hummus", "amount": 60, "carb": "No carb", "carbAmount": 0, "veg": "Salad + raw veg", "vegAmount": 180, "style": "Snack"
      }
    },
    {
      "meal_id": "snack_acai-bowl",
      "canonical_name": "Acai bowl",
      "display_name": "Acai Bowl",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Acai bowl",
      "recipe_url": "https://www.cookingclassy.com/acai-bowl/",
      "parts": [
        { "ingredientId": "acai_pulp", "qty": 100, "unit": "g" },
        { "ingredientId": "banana", "qty": 0.5, "unit": "piece" },
        { "ingredientId": "strawberries", "qty": 40, "unit": "g" },
        { "ingredientId": "blueberries", "qty": 30, "unit": "g" },
        { "ingredientId": "almonds_5pc", "qty": 5, "unit": "piece" },
        { "ingredientId": "pumpkin_seeds", "qty": 10, "unit": "g" }
      ],
      "components": {
        "protein": null, "amount": 0, "carb": "Acai + fruit", "carbAmount": 100, "veg": null, "style": "Bowl"
      }
    },
    {
      "meal_id": "snack_paneer-cutlets",
      "canonical_name": "Paneer cutlets",
      "display_name": "Paneer Cutlets",
      "nutrition_source": "IFCT/ICMR-NIN + USDA references + user assumptions",
      "assumption_version": "assumptions_v2026_08_06",
      "name": "Paneer cutlets",
      "recipe_url": "https://hebbarskitchen.com/paneer-cutlet-recipe-paneer-starter/",
      "parts": [
        { "ingredientId": "paneer", "qty": 55, "unit": "g" },
        { "ingredientId": "besan", "qty": 8, "unit": "g" },
        { "ingredientId": "breadcrumbs_panko", "qty": 8, "unit": "g" },
        { "ingredientId": "olive_oil", "qty": 5, "unit": "g" }
      ],
      "components": {
        "protein": "Paneer", "amount": 55, "carb": "Besan + breadcrumbs", "carbAmount": 16, "veg": null, "style": "Pan-fried"
      }
    }
  ]
};

/**
 * Hand-authored tags — subjective fields only.
 *
 * This used to be `csvTagsMap` and also carried `is_fat_heavy`, `has_fibre`
 * and `meal_weight` typed by hand next to macros computed from `parts[]`. They
 * drifted, as hand-typed data next to computed data always does: 12 of 41
 * meals disagreed on `is_fat_heavy` (mutton keema at 34g fat was tagged
 * `false`, chicken red curry at 14g was tagged `true`) and 3 of 41 on
 * `meal_weight`. All three are now derived in `deriveMealTags` and must not
 * be typed here — a test asserts this map carries nothing but `cuisine`.
 *
 * `cuisine` stays hand-authored because it is a genuine judgement call that no
 * ingredient list can settle: pad krapow and chicken red curry share almost
 * every ingredient with an Indian curry.
 */
const handAuthoredTags = {
  "Scrambled eggs + toast": { cuisine: "continental" },
  "Boiled eggs + ham sandwich": { cuisine: "continental" },
  "Smoked salmon + avocado on toast": { cuisine: "continental" },
  "Poha + kabab/protein shake": { cuisine: "indian" },
  "Egg white omelette + avocado": { cuisine: "continental" },
  "Aloo paratha + curd": { cuisine: "indian" },
  "Idli, Mysore masala dosa + sambar + chutney": { cuisine: "indian" },
  "Chicken keema bhurji + jowar roti": { cuisine: "indian" },
  "Moong dal chilla + paneer + hung curd": { cuisine: "indian" },
  "Oats + whey porridge with nuts": { cuisine: "continental" },
  "Chicken sausage + scrambled eggs + toast": { cuisine: "continental" },
  "Tofu & spinach scramble + avocado toast": { cuisine: "continental" },
  "Idli + sambar + masala egg bhurji": { cuisine: "indian" },
  "Paneer paratha + curd": { cuisine: "indian" },
  "Chicken curry + jowar roti": { cuisine: "indian" },
  "Grilled salmon fillet + sauteed veg + spaghetti aglio e olio": { cuisine: "continental" },
  "Rajma chawal + raita": { cuisine: "indian" },
  "Chole + jowar roti + raita": { cuisine: "indian" },
  "Vietnamese chicken pho": { cuisine: "asian" },
  "Grilled steak + mixed greens salad": { cuisine: "continental" },
  "Thai pad krapow + rice": { cuisine: "asian" },
  "Mutton keema + jowar roti": { cuisine: "indian" },
  "Arhar dal + rice + matar paneer": { cuisine: "indian" },
  "Chicken curry + jowar roti + dal": { cuisine: "indian" },
  "Grilled fish + pumpkin salad": { cuisine: "continental" },
  "Grilled salmon + sauteed veg + garlic rice": { cuisine: "continental" },
  "Chicken soup + smoked salmon salad": { cuisine: "continental" },
  "Paneer sabzi + dal + raita": { cuisine: "indian" },
  "Pork chop + pumpkin salad": { cuisine: "continental" },
  "Pork chop + mixed greens salad": { cuisine: "continental" },
  "Tandoori chicken + smoked chicken + avocado salad": { cuisine: "indian" },
  "Broccoli soup + grilled fish + spaghetti aglio e olio": { cuisine: "continental" },
  "Saag meat + jowar roti + dal": { cuisine: "indian" },
  "Kofta + dal + jowar roti": { cuisine: "indian" },
  "Kababs + dal + gobi + jowar roti": { cuisine: "indian" },
  "Fish curry + rice": { cuisine: "indian" },
  "Sweet potato curry + kaala chanaa sabzi + jowar roti": { cuisine: "indian" },
  "Avocado and smoked salmon salad": { cuisine: "continental" },
  "Avocado and smoked chicken salad": { cuisine: "continental" },
  "Chicken red curry + rice": { cuisine: "asian" },
  "Korean chicken bibimbap bowl": { cuisine: "asian" },
  "Salmon teriyaki + soba noodles": { cuisine: "asian" },
  "Prawn stir-fry + edamame + rice noodles": { cuisine: "asian" },
  "Miso chicken ramen + egg": { cuisine: "asian" },
  "Tofu & edamame ramen": { cuisine: "asian" },
  "Greek yogurt + berry bowl": { cuisine: "international" },
  "Carrot halwa (sugar-free) + protein shake": { cuisine: "indian" },
  "Nuts, seeds + protein shake": { cuisine: "international" },
  "Sweet potato chaat": { cuisine: "indian" },
  "Kaala chana chaat": { cuisine: "indian" },
  "Avocado/cheese toast": { cuisine: "continental" },
  "Fruit + Almonds + Plant Shake": { cuisine: "general" },
  "Chaat + Bhel + Protein Shake": { cuisine: "indian" },
  "Butter chicken + jowar roti": { cuisine: "indian" },
  "Grilled chicken + sweet potato + broccoli": { cuisine: "continental" },
  "Pepper beef + garlic rice + greens": { cuisine: "asian" },
  "Paneer tikka + jowar roti + salad": { cuisine: "indian" },
  "Grilled salmon + sweet potato + spinach": { cuisine: "continental" },
  "Chicken biryani + raita": { cuisine: "indian" },
  "Fish moilee + rice": { cuisine: "indian" },
  "Egg curry + dal + jowar roti": { cuisine: "indian" },
  "Chicken shawarma bowl": { cuisine: "continental" },
  "Prawn curry + rice": { cuisine: "asian" },
  "Chicken meatballs + spaghetti + salad": { cuisine: "continental" },
  "Boiled eggs + hummus + veg sticks": { cuisine: "continental" },
  "Edamame + sea salt": { cuisine: "asian" },
  "Paneer tikka skewers": { cuisine: "indian" },
  "Overnight oats + whey bowl": { cuisine: "continental" },

  // Research batch, 2026-08-03
  "Anda bhurji + toast": { cuisine: "indian" },
  "Sardines on toast + avocado": { cuisine: "continental" },
  "Shakshuka with feta": { cuisine: "continental" },
  "Cottage cheese & smoked salmon bowl": { cuisine: "continental" },
  "Palak paneer + jowar roti": { cuisine: "indian" },
  "Achari paneer tikka + dal + salad": { cuisine: "indian" },
  "Soya keema curry + jowar roti": { cuisine: "indian" },
  "Chole-paneer bowl + salad": { cuisine: "indian" },
  "Kadai chicken + jowar roti": { cuisine: "indian" },
  "Tandoori fish tikka + sauteed veg + roti": { cuisine: "indian" },
  "Chicken keema matar + jowar roti": { cuisine: "indian" },
  "Beef bulgogi bowl": { cuisine: "asian" },
  "Tofu & vegetable bibimbap": { cuisine: "asian" },
  "Oyakodon + side salad": { cuisine: "asian" },
  "Dubu jorim + rice + kimchi": { cuisine: "asian" },
  "Home-style tofu & chicken stir-fry": { cuisine: "asian" },
  "Vietnamese lemongrass chicken bowl": { cuisine: "asian" },
  "Cantonese steamed fish + edamame + rice": { cuisine: "asian" },
  "Chicken bulgogi bowl": { cuisine: "asian" },
  "Chicken souvlaki + tzatziki + Greek salad": { cuisine: "continental" },
  "Baked feta & chickpea traybake": { cuisine: "continental" },
  "Tuna Nicoise salad": { cuisine: "continental" },
  "Halloumi & roasted-veg quinoa bowl": { cuisine: "continental" },
  "Chicken & white-bean stew": { cuisine: "continental" },
  "Chickpea pasta with tuna & tomato": { cuisine: "continental" },
  "Chicken & ricotta carbonara-style spaghetti": { cuisine: "continental" },
  "Mackerel & quinoa salad": { cuisine: "continental" },

  // Batch 3, 2026-08-06
  "Scrambled egg sandwich": { cuisine: "continental" },
  "Acai bowl (protein-boosted)": { cuisine: "continental" },
  "Grilled chicken, veg + pasta": { cuisine: "continental" },
  "Chicken shawarma plate + garlic rice": { cuisine: "continental" },
  "Plain chicken tikka plate": { cuisine: "indian" },
  "Pesto millet pasta + chicken": { cuisine: "continental" },
  "Aglio e olio millet pasta + prawns": { cuisine: "continental" },
  "Salmon avocado salad (fresh grilled)": { cuisine: "continental" },
  "Smoked chicken salad (full size)": { cuisine: "continental" },
  "Hummus salad (protein-boosted)": { cuisine: "continental" },
  "Sweet potato + kaala chana + roti (leaner)": { cuisine: "indian" },
  "Paneer cutlets + dal + salad": { cuisine: "indian" },
  "Hummus salad": { cuisine: "continental" },
  "Acai bowl": { cuisine: "continental" },
  "Paneer cutlets": { cuisine: "indian" }
};

/** Exported so tests can assert no derived field creeps back in. */
export const handAuthoredTagFields = Object.freeze(['cuisine']);
export { handAuthoredTags };

/**
 * Compute macros from `parts[]`, derive the three computed tags from those
 * macros, then layer the subjective hand-authored tags on top. Order matters:
 * macros first, because the derivations read them.
 *
 * `carb_type` is derived here too, but only for lunch/dinner: it exists for
 * rubric R4, which exempts breakfast, so carrying it on breakfast and snack
 * meals would be a field nothing reads.
 */
const buildMeal = (meal, mealType) => {
  const withMacros = { ...meal, ...computeMacros(meal.parts) };
  return enrichMealForDataLayer(
    {
      ...withMacros,
      ...deriveMealTags(withMacros),
      ...(mealType === 'lunch_dinner' ? { carb_type: deriveCarbType(withMacros) } : {}),
      primary_ingredient: derivePrimaryIngredient(withMacros),
      ...(handAuthoredTags[meal.canonical_name] || {})
    },
    mealType
  );
};

export const mealDatabase = {
  breakfast: baseMealsList.breakfast.map(meal => buildMeal(meal, 'breakfast')),
  lunchDinner: baseMealsList.lunchDinner.map(meal => buildMeal(meal, 'lunch_dinner')),
  snack: baseMealsList.snack.map(meal => buildMeal(meal, 'snack'))
};
