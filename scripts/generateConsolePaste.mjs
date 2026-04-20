/**
 * generateConsolePaste.mjs
 *
 * Prints a self-contained browser console snippet that writes the
 * High-Protein plan (Apr 21–27) into the signed-in app's localStorage
 * with a future timestamp. On reload, App.jsx's `storageGet` sees the
 * local copy as newer and auto-syncs it to Firestore — no service
 * account needed.
 *
 * Usage:
 *   node scripts/generateConsolePaste.mjs
 *   -> copy the printed snippet
 *   -> open the signed-in app (preview or prod), open DevTools console
 *   -> paste, press enter, the page reloads with the plan applied
 */

import { mealDatabase } from '../src/data/mealDatabase.js';

const allMeals = [
  ...mealDatabase.breakfast,
  ...mealDatabase.lunchDinner,
  ...mealDatabase.snack
];

const findMeal = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return allMeals.find(m =>
    (m.canonical_name || '').toLowerCase() === n ||
    (m.name || '').toLowerCase() === n
  ) || null;
};

const HIGH_PROTEIN_PLAN = {
  '2026-04-21': { breakfast: 'Smoked salmon + avocado on toast',        lunch: 'Chicken curry + jowar roti + dal',                      dinner: 'Grilled steak + mixed greens salad' },
  '2026-04-22': { breakfast: 'Boiled eggs + ham sandwich',              lunch: 'Saag meat + jowar roti + dal',                         dinner: 'Broccoli soup + grilled fish + spaghetti aglio e olio' },
  '2026-04-23': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Tandoori chicken + smoked chicken + avocado salad',     dinner: 'Grilled fish + pumpkin salad' },
  '2026-04-24': { breakfast: 'Egg white omelette + avocado',            lunch: 'Kababs + dal + gobi + jowar roti',                      dinner: 'Chicken soup + smoked salmon salad' },
  '2026-04-25': { breakfast: 'Poha + kabab/protein shake',              lunch: 'Arhar dal + rice + matar paneer',                       dinner: 'Grilled salmon + sauteed veg + garlic rice' },
  '2026-04-26': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Chicken curry + jowar roti + dal',                      dinner: 'Broccoli soup + grilled fish + spaghetti aglio e olio' },
  '2026-04-27': { breakfast: 'Boiled eggs + ham sandwich',              lunch: 'Paneer sabzi + dal + raita',                            dinner: 'Grilled salmon + sauteed veg + garlic rice' },
};

const missing = [];
const plan = {};
for (const [dateKey, slots] of Object.entries(HIGH_PROTEIN_PLAN)) {
  const day = {};
  for (const [slot, mealName] of Object.entries(slots)) {
    const meal = findMeal(mealName);
    if (meal) day[slot] = meal;
    else missing.push(`${dateKey} ${slot}: ${mealName}`);
  }
  plan[dateKey] = day;
}

if (missing.length) {
  console.error('Missing meals in database — aborting:\n' + missing.join('\n'));
  process.exit(1);
}

// Future timestamp so localStorage wins the sync race and propagates to Firestore.
const futureTs = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

const snippet = `(() => {
  const plan = ${JSON.stringify(plan)};
  const existing = JSON.parse(localStorage.getItem('meal-plans') || '{}');
  const merged = { ...existing, ...plan };
  localStorage.setItem('meal-plans', JSON.stringify(merged));
  localStorage.setItem('meal-plans__ts', ${JSON.stringify(futureTs)});
  console.log('✅ High-Protein plan Apr 21–27 written to localStorage. Reloading…');
  setTimeout(() => location.reload(), 500);
})();`;

console.log('\n=== COPY EVERYTHING BELOW THIS LINE ===\n');
console.log(snippet);
console.log('\n=== COPY EVERYTHING ABOVE THIS LINE ===\n');
console.log('Paste it into the DevTools console on the signed-in app. The page will reload and the plan will stick.');
