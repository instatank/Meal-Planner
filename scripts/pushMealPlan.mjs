/**
 * pushMealPlan.mjs
 * Pushes a Claude-generated meal plan directly to Firestore.
 * Run: node scripts/pushMealPlan.mjs
 */

import { createRequire } from 'module';
import { mealDatabase } from '../src/data/mealDatabase.js';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

// ── Config ───────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = './meal-planner-fa6ee-firebase-adminsdk-fbsvc-c136fcb9e0.json';
const USER_UID = 'ke8DbcbcOiYj5X4dWULhRZ4g8Ix2';

// ── Initialize Firebase Admin ─────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ── Meal Lookup ───────────────────────────────────────────────────────
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

const makeMealEntry = (name) => {
  const meal = findMeal(name);
  if (!meal) {
    console.warn(`⚠️  Could not find meal: "${name}" — skipping`);
    return null;
  }
  return meal;
};

// ── Plan Definition ───────────────────────────────────────────────────
// Claude-generated Standard/Balanced plan — Apr 21–27 2026
const STANDARD_PLAN = {
  '2026-04-21': { breakfast: 'Smoked salmon + avocado on toast',        lunch: 'Arhar dal + rice + matar paneer',                       dinner: 'Grilled fish + pumpkin salad' },
  '2026-04-22': { breakfast: 'Poha + kabab/protein shake',              lunch: 'Vietnamese chicken pho',                                dinner: 'Paneer sabzi + dal + raita' },
  '2026-04-23': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Grilled salmon + sauteed veg + garlic rice',            dinner: 'Thai pad krapow + rice' },
  '2026-04-24': { breakfast: 'Egg white omelette + avocado',            lunch: 'Chicken curry + jowar roti + dal',                      dinner: 'Grilled steak + mixed greens salad' },
  '2026-04-25': { breakfast: 'Idli, Mysore masala dosa + sambar + chutney', lunch: 'Tandoori chicken + smoked chicken + avocado salad', dinner: 'Broccoli soup + grilled fish + spaghetti aglio e olio' },
  '2026-04-26': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Saag meat + jowar roti + dal',                         dinner: 'Chicken soup + smoked salmon salad' },
  '2026-04-27': { breakfast: 'Boiled eggs + ham sandwich',              lunch: 'Rajma chawal + raita',                                  dinner: 'Pork chop + mixed greens salad' },
};

// Claude-generated High-Protein plan — Apr 21–27 2026
const HIGH_PROTEIN_PLAN = {
  '2026-04-21': { breakfast: 'Smoked salmon + avocado on toast',        lunch: 'Chicken curry + jowar roti + dal',                      dinner: 'Grilled steak + mixed greens salad' },
  '2026-04-22': { breakfast: 'Boiled eggs + ham sandwich',              lunch: 'Saag meat + jowar roti + dal',                         dinner: 'Broccoli soup + grilled fish + spaghetti aglio e olio' },
  '2026-04-23': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Tandoori chicken + smoked chicken + avocado salad',     dinner: 'Grilled fish + pumpkin salad' },
  '2026-04-24': { breakfast: 'Egg white omelette + avocado',            lunch: 'Kababs + dal + gobi + jowar roti',                      dinner: 'Chicken soup + smoked salmon salad' },
  '2026-04-25': { breakfast: 'Poha + kabab/protein shake',              lunch: 'Arhar dal + rice + matar paneer',                       dinner: 'Grilled salmon + sauteed veg + garlic rice' },
  '2026-04-26': { breakfast: 'Scrambled eggs + toast',                  lunch: 'Chicken curry + jowar roti + dal',                      dinner: 'Broccoli soup + grilled fish + spaghetti aglio e olio' },
  '2026-04-27': { breakfast: 'Boiled eggs + ham sandwich',              lunch: 'Paneer sabzi + dal + raita',                            dinner: 'Grilled salmon + sauteed veg + garlic rice' },
};

// ── Choose Which Plan ─────────────────────────────────────────────────
const PLAN_TO_PUSH = HIGH_PROTEIN_PLAN; // ← change to STANDARD_PLAN if needed
const PLAN_LABEL = 'High-Protein'; // ← for logging

// ── Build Firestore-ready object ──────────────────────────────────────
const buildFirestoreValue = (planDef) => {
  const result = {};
  for (const [dateKey, slots] of Object.entries(planDef)) {
    const day = {};
    for (const [slot, mealName] of Object.entries(slots)) {
      const meal = makeMealEntry(mealName);
      if (meal) day[slot] = meal;
    }
    result[dateKey] = day;
  }
  return result;
};

// ── Push ──────────────────────────────────────────────────────────────
const pushPlan = async () => {
  console.log(`\n🚀 Pushing ${PLAN_LABEL} meal plan for Apr 21–27 2026...`);
  
  const value = buildFirestoreValue(PLAN_TO_PUSH);
  const datesCount = Object.keys(value).length;
  const mealsCount = Object.values(value).reduce((sum, day) => sum + Object.keys(day).length, 0);

  console.log(`   📅 Days: ${datesCount} | 🍽️  Slots: ${mealsCount}`);

  // First read existing plan to merge (not overwrite unrelated dates)
  const docRef = db.collection('users').doc(USER_UID).collection('metrics').doc('meal-plans');
  const existing = await docRef.get();
  const existingValue = existing.exists ? (existing.data()?.value || {}) : {};

  const merged = { ...existingValue, ...value };
  const now = new Date().toISOString();

  await docRef.set({ value: merged, updatedAt: now }, { merge: true });

  console.log(`\n✅ Done! Plan written to Firestore at ${now}`);
  console.log(`   Path: users/${USER_UID}/metrics/meal-plans`);
  console.log(`   Refresh your app to see the plan.\n`);
  process.exit(0);
};

pushPlan().catch(err => {
  console.error('❌ Push failed:', err.message);
  process.exit(1);
});
