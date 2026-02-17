import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mealDatabase } from '../src/data/mealDatabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputJsonPath = path.resolve(__dirname, '../database/seeds/meal_catalog_v1.json');
const outputXlsxPath = path.resolve(__dirname, '../exports/meal_database_architecture_v1.xlsx');

const ASSUMPTIONS = [
  {
    assumption: 'Protein portion (chicken/fish/salmon/smoked salmon)',
    value: '150 g cooked',
    scope: 'Default for meals using these proteins unless meal-specific override'
  },
  {
    assumption: 'Egg style baseline',
    value: '4 egg whites + 1 yolk',
    scope: 'Used for egg-based breakfast normalization where applicable'
  },
  {
    assumption: 'Toast serving',
    value: '1 slice default; sandwich uses 2 slices',
    scope: 'Applied to toast meals and ham sandwich entry'
  },
  {
    assumption: 'Yogurt profile',
    value: 'Low-fat',
    scope: 'Breakfast/yogurt and raita assumptions'
  },
  {
    assumption: 'Protein shake profile',
    value: '25 g protein, 140 kcal per serving',
    scope: 'Applied to meals/snacks containing protein shake'
  },
  {
    assumption: 'Nuts and seeds handful',
    value: 'Mixed almonds + seeds (small handful)',
    scope: 'Used in snack: Nuts, seeds + protein shake'
  },
  {
    assumption: 'Cooked rice serving',
    value: '80 g cooked',
    scope: 'Default for meals using cooked rice unless explicitly customized'
  }
];

const slugify = (text = '') =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const uniqueId = (base, taken) => {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  let candidate = `${base}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  taken.add(candidate);
  return candidate;
};

const inferTags = (meal, mealType) => {
  const tags = new Set();
  if (mealType === 'lunchDinner') {
    tags.add('lunch');
    tags.add('dinner');
  } else {
    tags.add(mealType);
  }

  const name = (meal.name || '').toLowerCase();
  const cuisine = (meal.cuisine || '').toLowerCase();
  const carb = (meal.components?.carb || '').toLowerCase();
  const style = (meal.components?.style || '').toLowerCase();

  if (name.includes('salad')) tags.add('salad');
  if (name.includes('soup') || style.includes('soup')) tags.add('soup');
  if (style.includes('grilled')) tags.add('grilled');
  if (style.includes('curry')) tags.add('curry');
  if (carb === 'no carb') tags.add('low-carb');
  if ((meal.protein || 0) >= 40) tags.add('high-protein');
  if (cuisine) tags.add(cuisine);

  return Array.from(tags);
};

const mealRows = [];
const componentRows = [];
const seenIds = new Set();

for (const [mealType, meals] of Object.entries(mealDatabase)) {
  for (const meal of meals) {
    const canonicalName = meal.canonical_name || meal.name || '';
    const baseId = `${mealType}_${slugify(canonicalName)}`;
    const preferredId = meal.meal_id || baseId;
    const mealId = uniqueId(preferredId, seenIds);
    const tags = inferTags(meal, mealType);

    mealRows.push({
      meal_id: mealId,
      meal_type: mealType === 'lunchDinner' ? 'lunch_dinner' : mealType,
      canonical_name: canonicalName,
      display_name: meal.display_name || canonicalName,
      name: canonicalName,
      cuisine: meal.cuisine || 'global',
      calories_kcal: Number(meal.cal || 0),
      protein_g: Number(meal.protein || 0),
      carbs_g: Number(meal.macros?.c || 0),
      fat_g: Number(meal.macros?.f || 0),
      nutrition_source: meal.nutrition_source || '',
      assumption_version: meal.assumption_version || '',
      source: 'seed_v1',
      is_active: true,
      tags: JSON.stringify(tags),
      metadata: JSON.stringify({
        macros_p: Number(meal.macros?.p || meal.protein || 0)
      })
    });

    componentRows.push({
      meal_id: mealId,
      protein_name: meal.components?.protein || '',
      protein_amount_g: meal.components?.amount ?? '',
      carb_name: meal.components?.carb || '',
      carb_amount_g: meal.components?.carbAmount ?? '',
      veg_name: meal.components?.veg || '',
      veg_amount_g: meal.components?.vegAmount ?? '',
      style: meal.components?.style || '',
      metadata: JSON.stringify({})
    });
  }
}

const catalogJson = {
  version: 'v1',
  generatedAt: new Date().toISOString(),
  mealCount: mealRows.length,
  sourceFile: 'src/data/mealDatabase.js',
  assumptions: ASSUMPTIONS,
  meals: mealRows,
  components: componentRows
};

const schemaRows = [
  { table: 'app_users', column: 'user_id', type: 'text (pk)', required: 'yes', description: 'Unique user id' },
  { table: 'app_users', column: 'timezone', type: 'text', required: 'yes', description: 'User timezone' },
  { table: 'meal_templates', column: 'meal_id', type: 'text (pk)', required: 'yes', description: 'Template meal id' },
  { table: 'meal_templates', column: 'meal_type', type: 'text', required: 'yes', description: 'breakfast/lunch_dinner/snack' },
  { table: 'meal_templates', column: 'canonical_name', type: 'text', required: 'yes', description: 'Stable canonical meal name' },
  { table: 'meal_templates', column: 'display_name', type: 'text', required: 'yes', description: 'Short UI display label' },
  { table: 'meal_templates', column: 'name', type: 'text', required: 'yes', description: 'Meal display name' },
  { table: 'meal_templates', column: 'protein_g', type: 'numeric', required: 'yes', description: 'Protein grams' },
  { table: 'meal_templates', column: 'calories_kcal', type: 'integer', required: 'yes', description: 'Calories' },
  { table: 'meal_templates', column: 'nutrition_source', type: 'text', required: 'no', description: 'Nutrition source traceability' },
  { table: 'meal_templates', column: 'assumption_version', type: 'text', required: 'no', description: 'Assumption profile used for normalization' },
  { table: 'meal_template_components', column: 'meal_id', type: 'text (pk,fk)', required: 'yes', description: 'Links to template' },
  { table: 'daily_meal_plan', column: 'user_id + plan_date + meal_type', type: 'unique', required: 'yes', description: 'One row per meal slot/day' },
  { table: 'daily_meal_plan', column: 'status', type: 'text', required: 'yes', description: 'planned/confirmed/skipped/custom' },
  { table: 'meal_events', column: 'event_type', type: 'text', required: 'yes', description: 'generated/edited/confirmed/undone/etc.' },
  { table: 'meal_events', column: 'delta', type: 'jsonb', required: 'yes', description: 'Payload of change details' },
  { table: 'preference_scores', column: 'accepts_score', type: 'numeric', required: 'yes', description: 'Learning weight' },
  { table: 'preference_scores', column: 'avoids_score', type: 'numeric', required: 'yes', description: 'Learning weight' }
];

const eventRows = [
  {
    event_type: 'generated',
    when: 'Plan created automatically',
    learning_impact: 'none',
    note: 'Used for traceability of generation decisions'
  },
  {
    event_type: 'confirmed',
    when: 'User confirms meal',
    learning_impact: '+accepts',
    note: 'Primary positive signal'
  },
  {
    event_type: 'undone',
    when: 'User undoes confirmed day meals',
    learning_impact: '-accepts',
    note: 'Rollback of previous positive signal'
  },
  {
    event_type: 'edited',
    when: 'User edits meal components',
    learning_impact: '+edits',
    note: 'Preference toward modified patterns'
  },
  {
    event_type: 'swapped',
    when: 'User cycles alternatives',
    learning_impact: 'soft +/−',
    note: 'Can become weak preference input'
  },
  {
    event_type: 'custom',
    when: 'User enters custom meal',
    learning_impact: 'contextual',
    note: 'May be used for future matching'
  },
  {
    event_type: 'skipped',
    when: 'Meal skipped',
    learning_impact: '+skips (+avoid optional)',
    note: 'Negative signal for repeating similar choices'
  }
];

fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
fs.writeFileSync(outputJsonPath, JSON.stringify(catalogJson, null, 2), 'utf-8');

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(mealRows), 'meal_catalog');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(componentRows), 'meal_components');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ASSUMPTIONS), 'assumptions');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(schemaRows), 'backend_schema');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(eventRows), 'learning_events');

fs.mkdirSync(path.dirname(outputXlsxPath), { recursive: true });
XLSX.writeFile(workbook, outputXlsxPath);

console.log(`Built database pack:
- ${outputJsonPath}
- ${outputXlsxPath}
Meals: ${mealRows.length}`);
