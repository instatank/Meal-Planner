/**
 * Meals that are really a pattern: a base, plus any one of several proteins.
 *
 * Most dishes in this catalog only work as authored. Idli, sambar and chutney
 * are one thing; pairing the sambar with a grilled salmon is not a meal anyone
 * eats, and nothing in the app has ever taken a dish apart. That stays the
 * default — `PAIRING_MODE.FIXED` — because assuming a dish can be decomposed
 * is the dangerous guess: it invents food nobody wants.
 *
 * A minority genuinely are mix-and-match. A big salad works with chicken, with
 * salmon, with prawns, with halloumi, and the result is a different meal each
 * time rather than a variation on one. Hand-authoring that grid is tedious and
 * goes stale; declaring the base once and the proteins once does not.
 *
 * ── Why expansion happens here, at catalog build, and not during search ──
 *
 * The optimizer enumerates every legal breakfast/lunch/dinner combination. If
 * templates were expanded inside that loop, every added protein would multiply
 * the work of a search that is already quadratic in the lunch/dinner count.
 * Expanding into concrete meals first means the search sees a flat list and its
 * cost profile is unchanged in shape — only in size, which was measured as
 * cheap: 75 -> 175 lunch/dinner meals moves enumeration 79ms -> 157ms inside a
 * ~900ms run, because the beam search dominates and is bounded independently
 * of catalog size.
 *
 * ── Why macros are not declared here ──
 *
 * A generated meal carries `parts[]` exactly like a hand-authored one, and
 * `computeMacros` rolls it up from the ingredient table. So a generated meal's
 * nutrition is derived by the same path as everything else, from the same
 * source data, and cannot drift from it. Declaring macros on a template would
 * create the one thing this codebase keeps having to remove: a hand-typed
 * number sitting beside a computed one.
 */

/**
 * Templates are deliberately few and conservative.
 *
 * Every generated meal competes with a hand-authored one for a place in the
 * week, so a template that produces mediocre food makes the catalog worse, not
 * bigger. Two patterns that genuinely recombine beat ten that nearly do.
 */
export const MEAL_TEMPLATES = Object.freeze([
  {
    id: 'salad_bowl',
    // `{protein}` is replaced by the option's label.
    nameTemplate: '{protein} salad bowl',
    mealType: 'lunchDinner',
    cuisine: 'continental',
    style: 'Salad bowl',
    base: [
      { ingredientId: 'mixed_salad', qty: 150, unit: 'g' },
      { ingredientId: 'tomato_herb_base', qty: 60, unit: 'g' },
      { ingredientId: 'olive_oil', qty: 5, unit: 'g' }
    ],
    baseLabel: { carb: 'No carb', veg: 'Mixed greens + tomato herb base', vegAmount: 210 },
    proteins: [
      { ingredientId: 'chicken_breast', qty: 150, unit: 'g', label: 'Grilled chicken', component: 'Chicken breast' },
      { ingredientId: 'grilled_salmon', qty: 150, unit: 'g', label: 'Grilled salmon', component: 'Grilled salmon' },
      { ingredientId: 'prawns', qty: 150, unit: 'g', label: 'Garlic prawn', component: 'Prawns' },
      { ingredientId: 'fish_fillet', qty: 150, unit: 'g', label: 'Grilled fish', component: 'Fish fillet' },
      { ingredientId: 'tofu_firm', qty: 150, unit: 'g', label: 'Crisp tofu', component: 'Firm tofu' },
      { ingredientId: 'smoked_chicken', qty: 120, unit: 'g', label: 'Smoked chicken', component: 'Smoked chicken' }
    ]
  },
  {
    id: 'quinoa_bowl',
    nameTemplate: '{protein} quinoa bowl',
    mealType: 'lunchDinner',
    cuisine: 'continental',
    style: 'Grain bowl',
    base: [
      { ingredientId: 'quinoa_cooked', qty: 120, unit: 'g' },
      { ingredientId: 'mixed_salad', qty: 100, unit: 'g' },
      { ingredientId: 'olive_oil', qty: 5, unit: 'g' }
    ],
    baseLabel: { carb: 'Quinoa', carbAmount: 120, veg: 'Mixed greens', vegAmount: 100 },
    proteins: [
      { ingredientId: 'chicken_breast', qty: 150, unit: 'g', label: 'Grilled chicken', component: 'Chicken breast' },
      { ingredientId: 'grilled_salmon', qty: 150, unit: 'g', label: 'Grilled salmon', component: 'Grilled salmon' },
      { ingredientId: 'prawns', qty: 150, unit: 'g', label: 'Garlic prawn', component: 'Prawns' },
      { ingredientId: 'tofu_firm', qty: 150, unit: 'g', label: 'Crisp tofu', component: 'Firm tofu' }
    ]
  }
]);

const slugify = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Turn the templates into concrete meals.
 *
 * `existingNames` suppresses a generated meal whose name a hand-authored dish
 * already uses. The hand-authored one wins every time: it was written
 * deliberately, with portions someone thought about, and silently shadowing it
 * with a generated approximation is the kind of substitution nobody would
 * notice until the macros looked wrong.
 *
 * `isAvailable` lets the caller drop an option whose ingredient is missing
 * from the table, rather than emitting a meal whose macros would silently roll
 * up as zero.
 */
export const expandMealTemplates = ({
  templates = MEAL_TEMPLATES,
  existingNames = [],
  isAvailable = () => true
} = {}) => {
  const taken = new Set(existingNames.map((name) => String(name).trim().toLowerCase()));
  const expanded = [];

  for (const template of templates) {
    const baseAvailable = template.base.every((part) => isAvailable(part.ingredientId));
    if (!baseAvailable) continue;

    for (const protein of template.proteins) {
      if (!isAvailable(protein.ingredientId)) continue;

      const name = template.nameTemplate.replace('{protein}', protein.label);
      if (taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());

      expanded.push({
        meal_id: `tpl_${template.id}_${slugify(protein.label)}`,
        canonical_name: name,
        display_name: name,
        name,
        nutrition_source: 'Composed from template — macros computed from ingredients',
        assumption_version: 'template_v1',
        cuisine: template.cuisine,
        // Protein first: `derivePrimaryIngredient` picks the highest protein
        // contributor, and putting it first keeps the parts list readable in
        // the same order a person would describe the dish.
        parts: [{ ingredientId: protein.ingredientId, qty: protein.qty, unit: protein.unit }, ...template.base],
        components: {
          protein: protein.component,
          amount: protein.qty,
          ...template.baseLabel,
          style: template.style
        },
        // The declaration the tier model reads. Everything else is `fixed`.
        pairing: 'modular',
        from_template: template.id
      });
    }
  }

  return expanded;
};
