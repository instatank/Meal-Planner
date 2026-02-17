# Meal Planner Backend Architecture v1

## Goal
Build a personal-first backend that is easy to run now, and cleanly evolves to multi-user production later.

## Current Runtime (already working)
- Frontend: React + Vite
- API: Vercel Functions (`/api/storage/[key]`)
- Persistence:
  - Local/dev: `data/runtime-storage.json` via Vite middleware
  - Production: Upstash Redis via Vercel

## Canonical Data Model (new baseline)
Use these tables (see `database/schema_v1.sql`):

1. `app_users`
- Single user now (`user_id = "me"`), supports multi-user later.

2. `meal_templates`
- Central meal catalog with macros, cuisine, tags.
- Acts as the source for generation options.

3. `meal_template_components`
- Normalized ingredient/component structure for each template meal.

4. `daily_meal_plan`
- One row per date + meal slot (breakfast/lunch/dinner).
- Stores the planned or confirmed snapshot used by UI/calendar.

5. `meal_events`
- Append-only history of actions (`confirmed`, `edited`, `undone`, etc.).
- Powers adaptive learning and auditability.

6. `preference_scores`
- Cached user preference scores derived from events.
- Fast lookups for meal generation.

## Why this model
- Keeps planning, tracking, and learning separated.
- Undo/edit remains reliable because event history is preserved.
- Supports future AI-assisted ranking without breaking existing data.

## Learning Logic Recommendation (v1)
Use deterministic scoring first:
- `confirmed` => increase `accepts_score`
- `undone` => reduce previous confirm impact
- `edited` => increase `edits_score`
- `skipped` => increase `skips_score` and mild `avoids_score`

Then generation score per candidate meal can combine:
- protein target fit
- repetition penalty
- recent-day penalty
- preference scores
- day theme (low-carb/indian/etc.)

## AI Guidance (when ready)
Do not start with AI as core planner.
Use AI later as an optional suggestion layer:
- Explain “why these meals”
- Propose meal swaps from your catalog only
- Parse free-text meals into template matches

Keep final plan selection deterministic and user-controlled.

## Practical Next Steps
1. Keep local testing on current app flow.
2. Maintain meal catalog centrally via generated files:
   - JSON: `database/seeds/meal_catalog_v1.json`
   - Excel: `exports/meal_database_architecture_v1.xlsx`
3. Add/adjust meals in catalog, then sync into app data.
4. When ready, migrate runtime storage from 3 blobs to normalized tables.
