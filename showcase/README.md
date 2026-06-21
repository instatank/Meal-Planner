# Showcase harness

Tooling to capture marketing/showcase screenshots of the **real** app UI without
needing Firebase, Google sign-in, or the production maintenance flag.

## How it works

- `vite.demo.config.js` (repo root) stubs `firebase/app`, `firebase/firestore`,
  and `firebase/auth` (see `stubs/`) so the app runs fully offline. It also injects
  a dummy `VITE_GEMINI_API_KEY` so the Omnibox renders its real input bar.
- `demo-main.jsx` seeds `localStorage` with a realistic week of plans + history,
  built from the **real** `src/data/mealDatabase.js`, then mounts the genuine
  `MealPlannerMain` component directly (bypassing the maintenance/auth gate).
- `screenshot.mjs` drives Playwright/Chromium to capture each screen at desktop
  (1280px) and mobile (414px) widths.

The only change made to app code is exporting `MealPlannerMain` from `src/App.jsx`
(`export const MealPlannerMain = ...`) — additive and harmless.

## Re-running

```bash
npm i -D playwright            # dev-only; not committed to package.json
npx vite --config vite.demo.config.js --port 5199 &
node showcase/screenshot.mjs   # writes PNGs to showcase/screenshots/
```

Playwright needs a Chromium binary. In CI/sandbox environments without CDN access,
point `executablePath` in `screenshot.mjs` at a preinstalled Chromium.

## Screens captured

| File | Screen |
| --- | --- |
| `01-onboarding` | Goal-selection setup |
| `02-dashboard-desktop` | Main day view (hero) |
| `03-week-plan-desktop` | "This Week's Plan" snapshot |
| `04-progress-desktop` | Progress tracker stats |
| `05-calendar-modal-desktop` | Date picker |
| `06-omnibox-slot-modal-desktop` | Omnibox "log a meal" slot picker |
| `07-dashboard-mobile` | Main day view (mobile) |
| `08-week-plan-mobile` | Week snapshot (mobile) |
