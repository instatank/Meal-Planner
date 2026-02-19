-- Meal Planner Backend Schema v1 (Postgres-first, personal-app friendly)
-- Use this as the canonical schema for production evolution.

create table if not exists app_users (
  user_id text primary key,
  email text unique,
  display_name text not null default 'Owner',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meal_templates (
  meal_id text primary key,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'snack')),
  name text not null,
  cuisine text not null default 'global',
  calories_kcal integer not null default 0,
  protein_g numeric(6,2) not null default 0,
  carbs_g numeric(6,2) not null default 0,
  fat_g numeric(6,2) not null default 0,
  source text not null default 'seed',
  is_active boolean not null default true,
  -- tags contract:
  -- {"meal_type","protein_family","carb_level","cuisine","format","effort","goal_fit"}
  tags jsonb not null default '{}'::jsonb,
  -- metadata contract:
  -- {"macros_p","source_type","source_url","confidence_score","needs_review","validation"}
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meal_type, lower(name))
);

create table if not exists meal_template_components (
  meal_id text primary key references meal_templates(meal_id) on delete cascade,
  protein_name text,
  protein_amount_g numeric(8,2),
  carb_name text,
  carb_amount_g numeric(8,2),
  veg_name text,
  veg_amount_g numeric(8,2),
  style text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists daily_meal_plan (
  plan_id bigserial primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  plan_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  meal_id text references meal_templates(meal_id),
  meal_name_snapshot text not null,
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'skipped', 'custom')),
  protein_g numeric(6,2) not null default 0,
  calories_kcal integer not null default 0,
  source text not null default 'generator',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date, meal_type)
);

create table if not exists meal_events (
  event_id bigserial primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  plan_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  event_type text not null check (event_type in ('generated', 'edited', 'swapped', 'confirmed', 'undone', 'custom', 'order_out', 'skipped')),
  meal_id text,
  meal_name text,
  delta jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists preference_scores (
  user_id text not null references app_users(user_id) on delete cascade,
  meal_name text not null,
  accepts_score numeric(8,2) not null default 0,
  avoids_score numeric(8,2) not null default 0,
  edits_score numeric(8,2) not null default 0,
  skips_score numeric(8,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, meal_name)
);

create index if not exists idx_daily_meal_plan_user_date on daily_meal_plan(user_id, plan_date);
create index if not exists idx_meal_events_user_date on meal_events(user_id, plan_date);
create index if not exists idx_meal_events_type on meal_events(event_type);
create index if not exists idx_meal_templates_type on meal_templates(meal_type);
