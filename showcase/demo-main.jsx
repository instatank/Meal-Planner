// ─────────────────────────────────────────────────────────────────────────────
// Showcase demo entry point.
//
// Seeds localStorage with a realistic week of plans + history (built from the
// REAL meal database) BEFORE the app boots, then renders the actual app UI.
// Firebase is stubbed via vite.demo.config.js so nothing hits the network.
// Used only to capture marketing screenshots — not part of the shipped app.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import ReactDOM from 'react-dom/client';
import { mealDatabase } from '../src/data/mealDatabase.js';
import '../src/index.css';

// ── IST date helpers (mirror App.jsx getDateKey / getWeekDateKeys) ───────────
const IST = 'Asia/Kolkata';
const getDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
};
const parseKey = (k) => {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  return new Date(Date.UTC(+y, +m - 1, +d));
};
const fmtKey = (date) => date.toISOString().slice(0, 10);
const weekKeys = (centerKey) => {
  const center = parseKey(centerKey);
  const dayIdx = center.getUTCDay();
  const mondayOffset = dayIdx === 0 ? -6 : 1 - dayIdx;
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(center);
    dd.setUTCDate(center.getUTCDate() + mondayOffset + i);
    return fmtKey(dd);
  });
};

// ── Build a varied week from real meals ──────────────────────────────────────
const asPlanMeal = (m) => ({
  name: m.name,
  display_name: m.display_name || m.name,
  protein: m.protein,
  cal: m.cal,
  macros: m.macros,
  cuisine: m.cuisine,
});
const pick = (arr, i) => asPlanMeal(arr[i % arr.length]);

const today = getDateKey();
const days = weekKeys(today);

const mealPlans = {};
const mealHistory = {};

days.forEach((dateKey, i) => {
  const plan = {
    breakfast: pick(mealDatabase.breakfast, i),
    lunch: pick(mealDatabase.lunchDinner, i * 2),
    snack: pick(mealDatabase.snack, i),
    dinner: pick(mealDatabase.lunchDinner, i * 2 + 1),
  };
  mealPlans[dateKey] = plan;

  const confirmFrom = (slots) => {
    const day = {};
    slots.forEach((slot) => {
      day[slot] = {
        meal: plan[slot].name,
        protein: plan[slot].protein,
        cal: plan[slot].cal,
        confirmed: true,
      };
    });
    return day;
  };

  if (dateKey < today) {
    // Past days: fully logged.
    mealHistory[dateKey] = confirmFrom(['breakfast', 'lunch', 'snack', 'dinner']);
  } else if (dateKey === today) {
    // Today: breakfast + lunch + snack done, dinner still actionable.
    mealHistory[dateKey] = confirmFrom(['breakfast', 'lunch', 'snack']);
  }
  // Future days: planned only, no history.
});

const nowIso = new Date().toISOString();
const onboarding = {
  version: 1,
  mode: 'owner',
  goal: 'high_protein',
  completedAt: nowIso,
  updatedAt: nowIso,
};

// ── Seed localStorage (skip onboarding profile when ?screen=onboarding) ──────
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');

const seed = (key, value) => {
  window.localStorage.setItem(key, JSON.stringify(value));
  window.localStorage.setItem(`${key}__ts`, nowIso);
};

window.localStorage.clear();
seed('meal-plans', mealPlans);
seed('meal-history', mealHistory);
seed('meal-events', []);
seed('meal-preferences', {});
seed('meal-user-catalog', {});
if (screen !== 'onboarding') {
  seed('meal-onboarding-profile', onboarding);
}

// Render the real app UI. We mount MealPlannerMain directly so the showcase
// bypasses the production maintenance flag + Google sign-in gate, while still
// exercising the genuine component, state, and styling. Firestore is stubbed
// via the demo vite config, so the seeded localStorage data is authoritative.
const { MealPlannerMain } = await import('../src/App.jsx');
const demoUser = { displayName: 'Demo Chef', uid: 'demo-user' };
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(MealPlannerMain, { user: demoUser, handleSignOut: () => {} }),
  ),
);
