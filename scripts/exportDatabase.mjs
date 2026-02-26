import { mealDatabase } from '../src/data/mealDatabase.js';
import fs from 'fs';
import path from 'path';

const allMeals = [
    ...mealDatabase.breakfast,
    ...mealDatabase.lunchDinner,
    ...mealDatabase.snack
];

const headers = [
    'Meal ID',
    'Name',
    'Meal Type',
    'Cuisine',
    'Calories (kcal)',
    'Protein (g)',
    'Carbs (g)',
    'Fat (g)',
    'Protein Family',
    'Carb Level',
    'Format',
    'Effort',
    'Goal Fit',
    'Parts',
    'Components'
];

const rows = [headers];

for (const meal of allMeals) {
    const partsStr = (meal.parts || []).map(p => `${p.qty}${p.unit} ${p.ingredientId}`).join(' + ');
    const componentsStr = `${meal.components?.protein || ''} / ${meal.components?.carb || ''} / ${meal.components?.veg || ''}`;

    const row = [
        meal.meal_id || '',
        meal.name || '',
        meal.tags?.meal_type || meal.meal_type || '',
        meal.cuisine || meal.tags?.cuisine || 'global',
        meal.cal || meal.calories_kcal || 0,
        meal.protein || meal.macros?.p || meal.protein_g || 0,
        meal.macros?.c || meal.carbs_g || 0,
        meal.macros?.f || meal.fat_g || 0,
        meal.tags?.protein_family || '',
        meal.tags?.carb_level || '',
        meal.tags?.format || '',
        meal.tags?.effort || '',
        (meal.tags?.goal_fit || []).join(', '),
        partsStr,
        componentsStr
    ].map(field => `"${String(field).replace(/"/g, '""')}"`);

    rows.push(row);
}

const csvData = rows.map(r => r.join(',')).join('\n');
const outputPath = path.resolve('./meal_database_export.csv');
fs.writeFileSync(outputPath, csvData);

console.log(`CSV Export successful! Written to ${outputPath}`);
