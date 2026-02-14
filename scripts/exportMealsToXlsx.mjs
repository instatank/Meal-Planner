import * as XLSX from 'xlsx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mealDatabase } from '../src/data/mealDatabase.js';

const workbook = XLSX.utils.book_new();

const flattenMeal = (mealType, meal) => ({
  mealType,
  name: meal.name || '',
  protein_g: meal.protein ?? '',
  calories_kcal: meal.cal ?? '',
  macros_p_g: meal.macros?.p ?? '',
  macros_c_g: meal.macros?.c ?? '',
  macros_f_g: meal.macros?.f ?? '',
  cuisine: meal.cuisine || '',
  isTreat: meal.isTreat ? 'yes' : 'no',
  component_protein: meal.components?.protein || '',
  component_protein_amount: meal.components?.amount ?? '',
  component_carb: meal.components?.carb || '',
  component_carb_amount: meal.components?.carbAmount ?? '',
  component_veg: meal.components?.veg || '',
  component_veg_amount: meal.components?.vegAmount ?? '',
  component_style: meal.components?.style || ''
});

const allRows = [];

for (const [mealType, meals] of Object.entries(mealDatabase)) {
  const rows = meals.map((meal) => flattenMeal(mealType, meal));
  allRows.push(...rows);

  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, mealType);
}

const allSheet = XLSX.utils.json_to_sheet(allRows);
XLSX.utils.book_append_sheet(workbook, allSheet, 'all_meals');

const thisFile = fileURLToPath(import.meta.url);
const outputPath = path.resolve(path.dirname(thisFile), '../exports/meal_database.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log(`Wrote ${allRows.length} meals to ${outputPath}`);
