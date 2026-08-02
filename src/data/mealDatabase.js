import { computeMacros, deriveMealTags, enrichMealForDataLayer } from '../lib/mealDataLayer.js';

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
        { "ingredientId": "mixed_salad", "qty": 80, "unit": "g" } // bean sprouts, herbs, greens in pho + small side
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Rice noodles", "carbAmount": 120, "veg": "Pho greens + side salad", "vegAmount": 80, "style": "Soup style"
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
        { "ingredientId": "curry_base", "qty": 20, "unit": "g" },
        { "ingredientId": "mixed_salad", "qty": 50, "unit": "g" } // small side salad
      ],
      "components": {
        "protein": "Chicken breast", "amount": 150, "carb": "Cooked rice", "carbAmount": 80, "veg": "Sautéed peppers + side salad", "vegAmount": 130, "style": "Pan-fried"
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
        { "ingredientId": "veg_kofta", "qty": 150, "unit": "g" },
        { "ingredientId": "arhar_dal", "qty": 150, "unit": "g" },
        { "ingredientId": "jowar_roti", "qty": 2, "unit": "piece" },
        { "ingredientId": "curry_base", "qty": 30, "unit": "g" }
      ],
      "components": {
        "protein": "Veg kofta", "amount": 150, "carb": "Jowar roti (millet)", "carbAmount": 2, "veg": "Mixed veg sabzi", "vegAmount": 120, "style": "Curry style"
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
      },
      "cuisine": "western"
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
      },
      "cuisine": "western"
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
      },
      "cuisine": "general"
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
      },
      "cuisine": "indian"
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
  "Scrambled eggs + toast": { cuisine: "Continental" },
  "Boiled eggs + ham sandwich": { cuisine: "Continental" },
  "Smoked salmon + avocado on toast": { cuisine: "Continental" },
  "Poha + kabab/protein shake": { cuisine: "Indian" },
  "Egg white omelette + avocado": { cuisine: "Continental" },
  "Aloo paratha + curd": { cuisine: "Indian" },
  "Idli, Mysore masala dosa + sambar + chutney": { cuisine: "Indian" },
  "Chicken keema bhurji + jowar roti": { cuisine: "Indian" },
  "Moong dal chilla + paneer + hung curd": { cuisine: "Indian" },
  "Oats + whey porridge with nuts": { cuisine: "Continental" },
  "Chicken sausage + scrambled eggs + toast": { cuisine: "Continental" },
  "Tofu & spinach scramble + avocado toast": { cuisine: "Continental" },
  "Idli + sambar + masala egg bhurji": { cuisine: "Indian" },
  "Paneer paratha + curd": { cuisine: "Indian" },
  "Chicken curry + jowar roti": { cuisine: "Indian" },
  "Grilled salmon fillet + sauteed veg + spaghetti aglio e olio": { cuisine: "Continental" },
  "Rajma chawal + raita": { cuisine: "Indian" },
  "Chole + jowar roti + raita": { cuisine: "Indian" },
  "Vietnamese chicken pho": { cuisine: "Asian" },
  "Grilled steak + mixed greens salad": { cuisine: "Continental" },
  "Thai pad krapow + rice": { cuisine: "Asian" },
  "Mutton keema + jowar roti": { cuisine: "Indian" },
  "Arhar dal + rice + matar paneer": { cuisine: "Indian" },
  "Chicken curry + jowar roti + dal": { cuisine: "Indian" },
  "Grilled fish + pumpkin salad": { cuisine: "Continental" },
  "Grilled salmon + sauteed veg + garlic rice": { cuisine: "Continental" },
  "Chicken soup + smoked salmon salad": { cuisine: "Continental" },
  "Paneer sabzi + dal + raita": { cuisine: "Indian" },
  "Pork chop + pumpkin salad": { cuisine: "Continental" },
  "Pork chop + mixed greens salad": { cuisine: "Continental" },
  "Tandoori chicken + smoked chicken + avocado salad": { cuisine: "Indian" },
  "Broccoli soup + grilled fish + spaghetti aglio e olio": { cuisine: "Continental" },
  "Saag meat + jowar roti + dal": { cuisine: "Indian" },
  "Kofta + dal + jowar roti": { cuisine: "Indian" },
  "Kababs + dal + gobi + jowar roti": { cuisine: "Indian" },
  "Fish curry + rice": { cuisine: "Indian" },
  "Sweet potato curry + kaala chanaa sabzi + jowar roti": { cuisine: "Indian" },
  "Avocado and smoked salmon salad": { cuisine: "Continental" },
  "Avocado and smoked chicken salad": { cuisine: "Continental" },
  "Chicken red curry + rice": { cuisine: "Asian" },
  "Greek yogurt + berry bowl": { cuisine: "International" },
  "Carrot halwa (sugar-free) + protein shake": { cuisine: "Indian" },
  "Nuts, seeds + protein shake": { cuisine: "International" },
  "Sweet potato chaat": { cuisine: "Indian" },
  "Kaala chana chaat": { cuisine: "Indian" },
  "Avocado/cheese toast": { cuisine: "Continental" },
  "Fruit + Almonds + Plant Shake": { cuisine: "General" },
  "Chaat + Bhel + Protein Shake": { cuisine: "Indian" }
};

/** Exported so tests can assert no derived field creeps back in. */
export const handAuthoredTagFields = Object.freeze(['cuisine']);
export { handAuthoredTags };

/**
 * Compute macros from `parts[]`, derive the three computed tags from those
 * macros, then layer the subjective hand-authored tags on top. Order matters:
 * macros first, because the derivations read them.
 */
const buildMeal = (meal, mealType) => {
  const withMacros = { ...meal, ...computeMacros(meal.parts) };
  return enrichMealForDataLayer(
    {
      ...withMacros,
      ...deriveMealTags(withMacros),
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
