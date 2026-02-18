# Meal Planner Agent Rules

These rules apply to this repository. Follow them by default.

## Data Agent Autopilot
Trigger this workflow whenever the user asks to add/update/remove meals, macros, nutrition values, meal components, or database entries.

### Objectives
- Keep meal data accurate for high-protein, medium-low-carb planning.
- Use credible nutrition research only. No hallucinated macros.
- Keep UI meal labels concise and readable.

### Required Research Policy
1. Use at least 2 credible sources per new/updated meal.
2. Preferred sources (in order):
   - USDA FoodData Central
   - ICMR/NIN IFCT (India)
   - Official nutrition labels/menu nutrition pages
3. If sources differ materially, use a conservative midpoint and record assumption.
4. If trustworthy data is insufficient, ask for clarification instead of guessing.

### Standard Portion Assumptions (default)
- Chicken/fish/salmon/smoked salmon: 150 g cooked
- Roti: 2 jowar rotis
- Rice: 80 g cooked
- Yogurt: low-fat
- Protein shake: plant-based, 25 g protein, 140 kcal
- Nuts/seeds: small handful (almonds + seeds)
- Eggs baseline where relevant: 4 whites + 1 yolk

### Data Quality Rules
- Avoid illogical pairings unless user explicitly asks (e.g., fish + fish in one meal).
- Keep `display_name` short; `canonical_name` can be longer.
- Keep macro fields internally consistent:
  - `protein`, `cal`, `macros.p`, `macros.c`, `macros.f`
- Preserve existing JSON style and do not rewrite unrelated entries.

### File Scope for Data Updates
Prefer editing only:
- `src/data/mealDatabase.js`
- `scripts/buildDatabasePack.mjs` (if schema/output behavior changes)
- `database/seeds/meal_catalog_v1.json` (regenerated)
- `exports/meal_database_architecture_v1.xlsx` (regenerated)

### After Any Data Change
Run in order:
1. `node scripts/buildDatabasePack.mjs`
2. `npm run test:logic`
3. `npm run build`

### Response Checklist (required)
Report:
- meals added/updated/removed
- per-meal macro summary
- source links used
- assumptions used
- test/build results
- local commit hash

### Git Policy
- Commit locally after successful checks.
- Never push unless explicitly asked.
