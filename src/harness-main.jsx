/**
 * Render harness — `npx vite` then open /harness.html
 *
 * The app gates on Google sign-in before `MealPlannerMain` mounts, so there is
 * no way to see a component render in a container (or any environment without
 * real credentials) by driving the app itself. This mounts the feedback
 * components directly against a realistic synthetic event log, which is how
 * the screenshots verifying them were taken.
 *
 * Not part of the production build: vite takes only `index.html` as an entry,
 * so `harness.html` is served in dev and never emitted to `dist/`. Verified,
 * not assumed — `npm run build` produces no harness asset.
 *
 * Add `?modal=1` to render the week-review sheet over it.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import InsightsPanel from './components/InsightsPanel';
import PlanReviewModal from './components/PlanReviewModal';
import { mealDatabase } from './data/mealDatabase';
import { createMealEvent } from './lib/mealEvents';
import { buildPlanReviewPayload, collectWeekDishes } from './lib/planReview';
import { learnPreferences, extractMealAttributes } from './lib/preferenceLearning';
import { flattenMealDatabase } from './lib/mealDataLayer';

const ago = (n) => new Date(Date.now() - n * 86400000).toISOString();
const meals = flattenMealDatabase(mealDatabase);
const paneer = meals.filter((m) => extractMealAttributes(m).includes('primary:paneer')).map((m) => m.name);
const chicken = meals.filter((m) => extractMealAttributes(m).includes('family:chicken')).map((m) => m.name);

let n = 0;
const events = [
  ...paneer.slice(0, 4).map((name, i) => createMealEvent({ id: `s${n++}`, type: 'swap', dateKey: `2026-09-0${i + 1}`, mealType: 'lunch', fromMealName: name, toMealName: 'X', timestamp: ago(i * 4 + 2) })),
  ...chicken.slice(0, 7).map((name, i) => createMealEvent({ id: `c${n++}`, type: 'confirm', dateKey: `2026-09-0${i + 1}`, mealType: 'dinner', mealName: name, protein: 42, timestamp: ago(i * 3 + 1) })),
  createMealEvent({ id: 'k1', type: 'skip', dateKey: '2026-09-05', mealType: 'breakfast', mealName: paneer[0], protein: 24, timestamp: ago(6) }),
  createMealEvent({ id: 'k2', type: 'skip', dateKey: '2026-09-08', mealType: 'breakfast', mealName: paneer[0], protein: 24, timestamp: ago(3) }),
  createMealEvent({ id: 'x1', type: 'custom', dateKey: '2026-09-09', mealType: 'lunch', mealName: 'Shawarma bowl', previousMealName: paneer[1], customMealText: 'shawarma bowl', source: 'custom_parts', protein: 38, timestamp: ago(2) }),
  createMealEvent({ id: 'r1', timestamp: ago(7), ...buildPlanReviewPayload({ weekStartKey: '2026-08-31', dateKeys: ['2026-08-31'], verdict: 'rejected', rating: 2, reasonIds: ['too_much_flatbread', 'too_repetitive'], note: 'Roti at both lunch and dinner four days running.', dishes: paneer.slice(0, 3) }) }),
  createMealEvent({ id: 'r2', timestamp: ago(1), ...buildPlanReviewPayload({ weekStartKey: '2026-09-07', dateKeys: ['2026-09-07'], verdict: 'accepted', rating: 4, reasonIds: ['good_variety'], note: 'Much better — more chicken, less repetition.', dishes: chicken.slice(0, 3) }) })
];

const learned = learnPreferences({ events, mealDatabase });
const week = {
  '2026-09-07': { breakfast: { name: chicken[0] }, lunch: { name: paneer[0] }, dinner: { name: chicken[1] } },
  '2026-09-08': { breakfast: { name: chicken[2] }, lunch: { name: paneer[1] }, dinner: { name: chicken[3] } }
};

const App = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
    <div className="max-w-md mx-auto">
      <InsightsPanel events={events} learned={learned} mealDatabase={mealDatabase} legacyRejections={[]} />
    </div>
    {new URLSearchParams(location.search).has('modal') && (
      <PlanReviewModal
        weekStartKey="2026-09-07"
        dateKeys={Object.keys(week)}
        dishes={collectWeekDishes(week, Object.keys(week))}
        onSubmit={(d) => console.log('submit', d)}
        onClose={() => {}}
      />
    )}
  </div>
);

createRoot(document.getElementById('root')).render(<App />);
