import test from 'node:test';
import assert from 'node:assert/strict';

import { generatePlanForDate } from '../src/lib/plannerGenerator.js';

const HEAVY_MEAL_CALORIE_THRESHOLD = 650;
const DAILY_CARB_CAP_G = 120;
const DAILY_MACRO_REQUIREMENTS_G = {
  protein: 100,
  carb: 90,
  fat: 35
};

const makeMeal = ({ name, protein, cal, macros, components = {} }) => ({
  name,
  protein,
  cal,
  macros,
  components
});

const dailyMacroTotals = (plan) =>
  ['breakfast', 'lunch', 'dinner'].reduce(
    (totals, mealType) => {
      const meal = plan?.[mealType] || {};
      const macros = meal.macros || {};
      totals.protein += Number(macros.p ?? meal.protein ?? 0);
      totals.carb += Number(macros.c ?? 0);
      totals.fat += Number(macros.f ?? 0);
      return totals;
    },
    { protein: 0, carb: 0, fat: 0 }
  );

const proteinFamily = (meal) => {
  const source = String(meal?.components?.protein || '').toLowerCase();
  if (source.includes('fish') || source.includes('salmon')) return 'fish';
  if (source.includes('chicken')) return 'chicken';
  return 'other';
};

test('no fish+fish or chicken+chicken lunch+dinner pairing', () => {
  const scenarios = [
    {
      forbiddenPair: 'fish',
      dateKey: '2026-03-15',
      lunchDinner: [
        makeMeal({
          name: 'Fish power plate A',
          protein: 60,
          cal: 350,
          macros: { p: 60, c: 9, f: 8 },
          components: { protein: 'Fish fillet', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Fish power plate B',
          protein: 58,
          cal: 355,
          macros: { p: 58, c: 11, f: 9 },
          components: { protein: 'Grilled salmon', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Lean chicken fallback',
          protein: 20,
          cal: 330,
          macros: { p: 20, c: 20, f: 7 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        })
      ]
    },
    {
      forbiddenPair: 'chicken',
      dateKey: '2026-03-16',
      lunchDinner: [
        makeMeal({
          name: 'Chicken power plate A',
          protein: 60,
          cal: 350,
          macros: { p: 60, c: 9, f: 8 },
          components: { protein: 'Chicken breast', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Chicken power plate B',
          protein: 58,
          cal: 355,
          macros: { p: 58, c: 11, f: 9 },
          components: { protein: 'Chicken thigh', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Lean fish fallback',
          protein: 20,
          cal: 330,
          macros: { p: 20, c: 20, f: 7 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        })
      ]
    }
  ];

  for (const scenario of scenarios) {
    const generated = generatePlanForDate({
      dateKey: scenario.dateKey,
      plans: {},
      preferences: {},
      mealDatabase: {
        breakfast: [
          makeMeal({
            name: 'Neutral breakfast',
            protein: 15,
            cal: 220,
            macros: { p: 15, c: 20, f: 7 },
            components: { protein: 'Eggs (whole)', carb: 'Toast' }
          })
        ],
        lunchDinner: scenario.lunchDinner
      }
    });

    const lunchProtein = proteinFamily(generated.lunch);
    const dinnerProtein = proteinFamily(generated.dinner);

    assert.ok(
      !(lunchProtein === scenario.forbiddenPair && dinnerProtein === scenario.forbiddenPair),
      `Expected lunch+dinner to avoid ${scenario.forbiddenPair}+${scenario.forbiddenPair}; got lunch=${generated.lunch?.name}, dinner=${generated.dinner?.name}`
    );
  }
});

test('heavy meal daily cap limits to one heavy meal maximum', () => {
  const generated = generatePlanForDate({
    dateKey: '2026-03-17',
    plans: {},
    preferences: {},
    mealDatabase: {
      breakfast: [
        makeMeal({
          name: 'Light breakfast',
          protein: 20,
          cal: 280,
          macros: { p: 20, c: 22, f: 9 },
          components: { protein: 'Eggs (whole)', carb: 'Toast' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'Heavy chicken thali',
          protein: 62,
          cal: 760,
          macros: { p: 62, c: 70, f: 24 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        }),
        makeMeal({
          name: 'Heavy fish rice bowl',
          protein: 60,
          cal: 740,
          macros: { p: 60, c: 67, f: 22 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        }),
        makeMeal({
          name: 'Light tofu salad',
          protein: 24,
          cal: 300,
          macros: { p: 24, c: 18, f: 11 },
          components: { protein: 'Paneer', carb: 'No carb' }
        })
      ]
    }
  });

  const heavyCount = ['breakfast', 'lunch', 'dinner'].filter(
    (mealType) => (generated?.[mealType]?.cal || 0) >= HEAVY_MEAL_CALORIE_THRESHOLD
  ).length;

  assert.ok(
    heavyCount <= 1,
    `Expected at most one heavy meal (>=${HEAVY_MEAL_CALORIE_THRESHOLD} kcal), got ${heavyCount}: breakfast=${generated.breakfast?.name}, lunch=${generated.lunch?.name}, dinner=${generated.dinner?.name}`
  );
});

test('daily plan satisfies protein, carb, and fat minimum requirements', () => {
  const generated = generatePlanForDate({
    dateKey: '2026-03-18',
    plans: {},
    preferences: {},
    mealDatabase: {
      breakfast: [
        makeMeal({
          name: 'Lean starter',
          protein: 30,
          cal: 220,
          macros: { p: 30, c: 6, f: 4 },
          components: { protein: 'Egg whites', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Balanced oats bowl',
          protein: 28,
          cal: 340,
          macros: { p: 28, c: 35, f: 12 },
          components: { protein: 'Eggs (whole)', carb: 'Oats' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'Lean chicken plate',
          protein: 50,
          cal: 340,
          macros: { p: 50, c: 8, f: 6 },
          components: { protein: 'Chicken breast', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Balanced curry plate',
          protein: 44,
          cal: 650,
          macros: { p: 44, c: 45, f: 18 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        }),
        makeMeal({
          name: 'Balanced fish rice',
          protein: 43,
          cal: 630,
          macros: { p: 43, c: 40, f: 17 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        })
      ]
    }
  });

  const totals = dailyMacroTotals(generated);

  assert.ok(
    totals.protein >= DAILY_MACRO_REQUIREMENTS_G.protein,
    `Expected protein >= ${DAILY_MACRO_REQUIREMENTS_G.protein}g, got ${totals.protein}g`
  );
  assert.ok(
    totals.carb >= DAILY_MACRO_REQUIREMENTS_G.carb,
    `Expected carbs >= ${DAILY_MACRO_REQUIREMENTS_G.carb}g, got ${totals.carb}g`
  );
  assert.ok(
    totals.fat >= DAILY_MACRO_REQUIREMENTS_G.fat,
    `Expected fat >= ${DAILY_MACRO_REQUIREMENTS_G.fat}g, got ${totals.fat}g`
  );
});

test('carb cap guardrail keeps daily carbs at or below cap', () => {
  const generated = generatePlanForDate({
    dateKey: '2026-03-19',
    plans: {},
    preferences: {},
    mealDatabase: {
      breakfast: [
        makeMeal({
          name: 'Moderate carb breakfast',
          protein: 25,
          cal: 300,
          macros: { p: 25, c: 35, f: 8 },
          components: { protein: 'Eggs (whole)', carb: 'Toast' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'High carb chicken bowl',
          protein: 50,
          cal: 450,
          macros: { p: 50, c: 65, f: 12 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        }),
        makeMeal({
          name: 'High carb fish bowl',
          protein: 48,
          cal: 430,
          macros: { p: 48, c: 60, f: 11 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        }),
        makeMeal({
          name: 'Low carb fallback bowl',
          protein: 26,
          cal: 360,
          macros: { p: 26, c: 8, f: 10 },
          components: { protein: 'Paneer', carb: 'No carb' }
        })
      ]
    }
  });

  const totals = dailyMacroTotals(generated);

  assert.ok(
    totals.carb <= DAILY_CARB_CAP_G,
    `Expected carbs <= ${DAILY_CARB_CAP_G}g, got ${totals.carb}g (breakfast=${generated.breakfast?.name}, lunch=${generated.lunch?.name}, dinner=${generated.dinner?.name})`
  );
});

test('deterministic output remains stable for fixed constraints fixture', () => {
  const fixtureInput = {
    dateKey: '2026-03-20',
    plans: {
      '2026-03-19': {
        breakfast: makeMeal({
          name: 'History breakfast',
          protein: 20,
          cal: 260,
          macros: { p: 20, c: 25, f: 8 },
          components: { protein: 'Eggs (whole)', carb: 'Toast' }
        }),
        lunch: makeMeal({
          name: 'History lunch',
          protein: 40,
          cal: 500,
          macros: { p: 40, c: 40, f: 14 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        }),
        dinner: makeMeal({
          name: 'History dinner',
          protein: 42,
          cal: 520,
          macros: { p: 42, c: 42, f: 15 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        })
      }
    },
    preferences: {
      accepts: { 'Lean chicken plate': 2 },
      avoids: { 'Heavy chicken thali': 2 },
      edits: {},
      skips: {}
    },
    mealDatabase: {
      breakfast: [
        makeMeal({
          name: 'Lean starter',
          protein: 30,
          cal: 220,
          macros: { p: 30, c: 6, f: 4 },
          components: { protein: 'Egg whites', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Balanced oats bowl',
          protein: 28,
          cal: 340,
          macros: { p: 28, c: 35, f: 12 },
          components: { protein: 'Eggs (whole)', carb: 'Oats' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'Lean chicken plate',
          protein: 50,
          cal: 340,
          macros: { p: 50, c: 8, f: 6 },
          components: { protein: 'Chicken breast', carb: 'No carb' }
        }),
        makeMeal({
          name: 'Balanced fish rice',
          protein: 43,
          cal: 630,
          macros: { p: 43, c: 40, f: 17 },
          components: { protein: 'Fish fillet', carb: 'Rice' }
        }),
        makeMeal({
          name: 'Heavy chicken thali',
          protein: 62,
          cal: 760,
          macros: { p: 62, c: 70, f: 24 },
          components: { protein: 'Chicken breast', carb: 'Rice' }
        })
      ]
    }
  };

  const runFixture = () =>
    generatePlanForDate({
      dateKey: fixtureInput.dateKey,
      plans: structuredClone(fixtureInput.plans),
      preferences: structuredClone(fixtureInput.preferences),
      mealDatabase: fixtureInput.mealDatabase
    });

  const first = runFixture();
  for (let i = 0; i < 40; i += 1) {
    assert.deepEqual(runFixture(), first);
  }
});
