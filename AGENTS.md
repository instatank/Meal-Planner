# Meal Planner Multi-Agent Rules

These rules apply to this repository by default.

## Purpose
Use this file as a central task router so agents consistently know what to do for:
- planner/rules logic
- meal database updates
- UI/frontend updates
- testing and regression validation

## Intent Router (Auto-Select Workflow)
Map user intent to workflow:
1. If request is about meal list, macros, nutrition facts, seed/export files -> use Data Workflow.
2. If request is about generation logic, constraints, learning behavior, scoring -> use Rules Workflow.
3. If request is about layout, buttons, modals, spacing, mobile UX -> use UI Workflow.
4. If request is about correctness, regression, bug-proofing, coverage -> use QA Workflow.
5. If request crosses multiple areas, split into sub-tasks and keep file ownership strict.

## Shared Operating Rules (All Workflows)
1. Do not hallucinate facts, nutrition numbers, or source claims.
2. Keep changes minimal and local to the requested scope.
3. Never rewrite unrelated entries/files.
4. Run validation commands before finalizing.
5. Commit locally after checks pass.
6. Never push unless explicitly asked.

## Rules Workflow (Planner/Logic)
Trigger when user asks to change planning behavior, constraints, ranking, adaptive logic, or weekly generation.

### File Scope
Prefer editing:
- `src/lib/plannerGenerator.js`
- `src/lib/mealEvents.js` (if learning/event logic changes)
- `tests/planner.regression.test.js`
- `tests/planner.constraints.test.js`

### Guardrails
- Keep output deterministic for fixed inputs.
- Hard constraints must be enforceable before scoring whenever specified.
- Preserve compatibility with existing meal schema.
- Avoid introducing hidden randomness.

### Validation
Run:
1. `npm run test:logic`
2. `npm run build`

## Data Workflow (Meal DB/Nutrition)
Trigger whenever user asks to add/update/remove meals, macros, nutrition values, components, or database entries.

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
- Avoid illogical pairings unless user explicitly asks (example: fish + fish in one meal).
- Keep `display_name` short; `canonical_name` can be longer.
- Keep macro fields consistent:
  - `protein`, `cal`, `macros.p`, `macros.c`, `macros.f`
- Update planner metadata fields where present (example: `protein_family`, `meal_weight_class`, `carb_level`).

### File Scope
Prefer editing only:
- `src/data/mealDatabase.js`
- `scripts/buildDatabasePack.mjs` (if schema/output behavior changes)
- `database/seeds/meal_catalog_v1.json` (regenerated)
- `exports/meal_database_architecture_v1.xlsx` (regenerated)

### Validation
Run in order:
1. `node scripts/buildDatabasePack.mjs`
2. `npm run test:logic`
3. `npm run build`

### Required Report Format
Include:
- meals added/updated/removed
- per-meal macro summary
- source links used
- assumptions used
- test/build results
- local commit hash

## UI Workflow (Frontend)
Trigger when user asks for visual/layout/mobile/modal/button/interaction changes.

### File Scope
Prefer editing:
- `src/App.jsx`
- `src/index.css` (or other styling files only if needed)

### Guardrails
- Preserve existing behavior unless change is requested.
- Keep mobile layout stable.
- Avoid changing planner/data logic unless explicitly requested.

### Validation
Run:
1. `npm run build`
2. `npm run test:logic` (if UI change touches behavior)

## QA Workflow (Tests/Regression)
Trigger when user asks to add tests, check regressions, or verify behavior.

### File Scope
Prefer editing only test files:
- `tests/*.test.js`

### Guardrails
- Tests should reflect product rules, not accidental implementation details.
- Test fixtures must be feasible under active constraints.
- Do not silently relax assertions without reason.

### Validation
Run:
1. `npm run test:logic`

## Coordinator Notes
When running multiple agents in parallel:
1. Keep each agent in its own branch/worktree.
2. Keep file ownership strict by workflow.
3. Merge only after each branch passes validation.
4. Resolve conflicts in coordinator branch and rerun full checks.
