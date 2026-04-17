// src/data/ingredients.js

/**
 * Core Ingredient Reference database
 * Single source of truth for all macro calculations.
 *
 * `per100g` structure: { kcal, p, c, f }
 * `defaultPortion` structure: { qty, unit, pieceWeightG (optional) }
 */

/**
 * User physical profile and derived standard portions.
 * Use these fallbacks whenever a user proposes a meal without explicit quantities.
 */
export const userProfile = {
  gender: 'male',
  age: 46,
  weight_kg: 83,
  height_cm: 178, // 5ft 10in
  estimated_tdee_kcal: 2400, // maintenance for moderate activity
  daily_protein_target_g: 130 // ~1.5g per kg bodyweight
};

export const STANDARD_PORTIONS = {
  protein_meat: { qty: 150, unit: "g", description: "Yields ~35-45g protein (chicken, fish, mutton)" },
  protein_veg: { qty: 150, unit: "g", description: "Legumes, paneer, tofu (often requires pairing to hit targets)" },
  carbs_grain: { qty: 100, unit: "g", description: "Cooked rice, pasta, or noodles" },
  carbs_bread: { qty: 2, unit: "piece", description: "Jowar roti, slices of toast, paratha" },
  vegetables: { qty: 150, unit: "g", description: "Mixed salad, sautéed greens, or sabzi" },
  fats_oils: { qty: 15, unit: "g", description: "Cooking oil, butter, or dressing per meal" }
};

export const ingredients = {
  // --- Proteins ---
  chicken_breast: {
    name: "Chicken breast (cooked)",
    per100g: { kcal: 165, p: 31, c: 0, f: 3.6 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #05062"
  },
  fish_fillet: {
    name: "Fish fillet (white, cooked)",
    per100g: { kcal: 110, p: 23, c: 0, f: 2.0 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #15088"
  },
  grilled_salmon: {
    name: "Grilled salmon",
    per100g: { kcal: 206, p: 22, c: 0, f: 13 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #15084"
  },
  smoked_salmon: {
    name: "Smoked salmon",
    per100g: { kcal: 117, p: 18, c: 0, f: 4.3 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #15077"
  },
  smoked_chicken: {
    name: "Smoked chicken breast (sliced)",
    per100g: { kcal: 148, p: 26, c: 0, f: 4.5 },
    defaultPortion: { qty: 120, unit: "g" },
    source: "USDA #05182"
  },
  beef_steak: {
    name: "Beef steak (grilled)",
    per100g: { kcal: 250, p: 26, c: 0, f: 16 },
    defaultPortion: { qty: 180, unit: "g" },
    source: "USDA #13009"
  },
  pork_chop: {
    name: "Pork chop (grilled)",
    per100g: { kcal: 233, p: 23, c: 0, f: 15 },
    defaultPortion: { qty: 180, unit: "g" },
    source: "USDA #10065"
  },
  mutton_keema: {
    name: "Mutton keema (cooked)",
    per100g: { kcal: 230, p: 19, c: 0, f: 17 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "IFCT Reference"
  },
  lamb_seekh_kabab: {
    name: "Lamb seekh kabab",
    per100g: { kcal: 280, p: 17, c: 2, f: 22 },
    defaultPortion: { qty: 2, unit: "piece", pieceWeightG: 75 },
    source: "IFCT Reference"
  },
  egg_whole: {
    name: "Egg (whole)",
    per100g: { kcal: 143, p: 12.6, c: 0.7, f: 9.5 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 50 },
    source: "USDA #01123"
  },
  egg_white: {
    name: "Egg white",
    per100g: { kcal: 52, p: 11, c: 0.7, f: 0.2 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 33 },
    source: "USDA #01124"
  },
  egg_yolk: {
    name: "Egg yolk",
    per100g: { kcal: 322, p: 15.8, c: 3.6, f: 26.5 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 17 },
    source: "USDA #01125"
  },
  paneer: {
    name: "Paneer",
    per100g: { kcal: 265, p: 18, c: 3, f: 20 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "IFCT Reference"
  },
  protein_shake: {
    name: "Protein shake (powder)",
    per100g: { kcal: 412, p: 73.5, c: 14.7, f: 5.9 }, // Scaled to ~140kcal for 25g protein per 34g scoop
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 34 },
    source: "General Supplement Label"
  },
  kaala_chanaa: {
    name: "Kaala chanaa (cooked)",
    per100g: { kcal: 164, p: 8.9, c: 27.4, f: 2.6 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "IFCT Reference"
  },
  rajma: {
    name: "Rajma (cooked)",
    per100g: { kcal: 127, p: 8.7, c: 22.8, f: 0.5 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "IFCT Reference"
  },
  arhar_dal: {
    name: "Arhar dal (cooked)",
    per100g: { kcal: 116, p: 7, c: 20, f: 0.8 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "IFCT Reference"
  },
  chole: {
    name: "Chole (cooked)",
    per100g: { kcal: 164, p: 8.9, c: 27.4, f: 2.6 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "IFCT Reference"
  },
  greek_yogurt: {
    name: "Greek yogurt (low fat)",
    per100g: { kcal: 73, p: 10, c: 4, f: 1.9 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #01287"
  },
  curd: {
    name: "Curd / Raita",
    per100g: { kcal: 61, p: 3.5, c: 4.7, f: 3.3 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "IFCT Reference"
  },

  // --- Carbs ---
  cooked_rice: {
    name: "Cooked white rice",
    per100g: { kcal: 130, p: 2.4, c: 28, f: 0.3 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA #20445"
  },
  garlic_rice: {
    name: "Garlic rice",
    per100g: { kcal: 150, p: 3, c: 28, f: 3 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA/IFCT inferred"
  },
  jowar_roti: {
    name: "Jowar roti",
    per100g: { kcal: 312, p: 6.7, c: 60, f: 3.2 },
    defaultPortion: { qty: 2, unit: "piece", pieceWeightG: 40 },
    source: "IFCT Reference"
  },
  whole_wheat_toast: {
    name: "Whole wheat toast",
    per100g: { kcal: 247, p: 13, c: 41, f: 3.4 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 28 }, // 1 slice
    source: "USDA #18075"
  },
  poha: {
    name: "Poha (cooked)",
    per100g: { kcal: 180, p: 6, c: 38, f: 1.5 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "IFCT Reference"
  },
  rice_noodles: {
    name: "Rice noodles (cooked)",
    per100g: { kcal: 109, p: 0.9, c: 24, f: 0.2 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA #20133"
  },
  spaghetti_aglio_olio: {
    name: "Spaghetti aglio e olio",
    per100g: { kcal: 185, p: 4.5, c: 29, f: 6.2 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA/Inferred"
  },
  masala_dosa: {
    name: "Mysore Masala Dosa",
    per100g: { kcal: 220, p: 5, c: 30, f: 8 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 180 },
    source: "IFCT Reference"
  },
  idli: {
    name: "Idli",
    per100g: { kcal: 140, p: 4, c: 28, f: 1.5 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 40 },
    source: "IFCT Reference"
  },
  aloo_paratha: {
    name: "Aloo paratha",
    per100g: { kcal: 260, p: 6.5, c: 38, f: 9 },
    defaultPortion: { qty: 2, unit: "piece", pieceWeightG: 120 },
    source: "IFCT Reference"
  },

  // --- Vegetables / Sides / Flavorings ---
  mixed_salad: {
    name: "Mixed greens salad",
    per100g: { kcal: 20, p: 1.3, c: 3.3, f: 0.2 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA"
  },
  pumpkin_salad: {
    name: "Pumpkin salad",
    per100g: { kcal: 95, p: 2.2, c: 12, f: 4 },
    defaultPortion: { qty: 120, unit: "g" },
    source: "USDA"
  },
  sweet_potato: {
    name: "Sweet potato (cooked)",
    per100g: { kcal: 90, p: 2, c: 21, f: 0.1 },
    defaultPortion: { qty: 150, unit: "g" },
    source: "USDA #11839"
  },
  broccoli: {
    name: "Sautéed broccoli",
    per100g: { kcal: 55, p: 4, c: 7, f: 2 },
    defaultPortion: { qty: 120, unit: "g" },
    source: "USDA"
  },
  cauliflower: {
    name: "Cauliflower",
    per100g: { kcal: 25, p: 2, c: 5, f: 0.3 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA #11135"
  },
  mixed_veg_sabzi: {
    name: "Mixed veg sabzi",
    per100g: { kcal: 80, p: 3, c: 12, f: 2.5 },
    defaultPortion: { qty: 120, unit: "g" },
    source: "IFCT Reference"
  },
  veg_kofta: {
    name: "Vegetable kofta",
    per100g: { kcal: 180, p: 4.5, c: 15, f: 11 },
    defaultPortion: { qty: 80, unit: "g" }, // approx 2 pieces
    source: "IFCT/Estimated"
  },
  spinach: {
    name: "Sautéed spinach",
    per100g: { kcal: 40, p: 3, c: 4, f: 1.5 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA"
  },

  // --- Basics & Fats ---
  curry_base: {
    name: "Curry base (oil, onion, tomato)",
    per100g: { kcal: 250, p: 2, c: 15, f: 20 },
    defaultPortion: { qty: 50, unit: "g" },
    source: "Inferred base"
  },
  avocado: {
    name: "Avocado",
    per100g: { kcal: 160, p: 2, c: 8.5, f: 14.7 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 50 }, // Half avocado
    source: "USDA #09037"
  },
  nuts_seeds: {
    name: "Mixed nuts & seeds",
    per100g: { kcal: 600, p: 20, c: 20, f: 50 },
    defaultPortion: { qty: 30, unit: "g" },
    source: "USDA"
  },
  berry_mix: {
    name: "Mixed berries",
    per100g: { kcal: 57, p: 0.7, c: 14, f: 0.3 },
    defaultPortion: { qty: 80, unit: "g" },
    source: "USDA"
  },
  ham_slice: {
    name: "Ham slice",
    per100g: { kcal: 145, p: 17, c: 1.5, f: 7.5 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 28 }, // 1 slice
    source: "USDA"
  },
  cheese_slice: {
    name: "Cheese slice (cheddar/swiss)",
    per100g: { kcal: 400, p: 25, c: 1.3, f: 33 },
    defaultPortion: { qty: 1, unit: "piece", pieceWeightG: 21 }, // 1 slice
    source: "USDA"
  },
  hummus: {
    name: "Hummus",
    per100g: { kcal: 166, p: 7.9, c: 14.3, f: 9.6 },
    defaultPortion: { qty: 50, unit: "g" },
    source: "USDA #16158"
  },
  crackers: {
    name: "Seed/Wheat crackers",
    per100g: { kcal: 502, p: 10, c: 60, f: 24 },
    defaultPortion: { qty: 30, unit: "g" },
    source: "USDA"
  },
  raw_vegetables: {
    name: "Raw vegetable sticks (carrot, cucumber, radish)",
    per100g: { kcal: 20, p: 1, c: 4, f: 0.1 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA"
  },

  // --- Custom Snacks ---
  mixed_fruit_100g: {
    name: "Mixed fruit (pomegranate, orange)",
    per100g: { kcal: 65, p: 1.3, c: 15, f: 0.6 },
    defaultPortion: { qty: 100, unit: "g" },
    source: "USDA Custom Average"
  },
  almonds_5pc: {
    name: "Almonds (5 pieces)",
    per100g: { kcal: 579, p: 21, c: 21, f: 50 },
    defaultPortion: { qty: 5, unit: "piece", pieceWeightG: 1.2 },
    source: "USDA"
  },
  plant_protein_shake_25g: {
    name: "Plant protein shake (water)",
    per100g: { kcal: 400, p: 80, c: 10, f: 5 },
    defaultPortion: { qty: 25, unit: "g" },
    source: "Standard Supplement"
  },
  half_bhel_puri_no_potato: {
    name: "Bhel puri (half portion, no potato)",
    per100g: { kcal: 157, p: 3.3, c: 23.3, f: 5.3 },
    defaultPortion: { qty: 75, unit: "g" },
    source: "IFCT Derived Custom"
  },
  half_papdi_chaat_baked: {
    name: "Papdi chaat (half portion, baked, no potato)",
    per100g: { kcal: 170, p: 5.3, c: 24.6, f: 4.6 },
    defaultPortion: { qty: 75, unit: "g" },
    source: "IFCT Derived Custom"
  }
};
