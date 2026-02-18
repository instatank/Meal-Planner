import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAILY_CARB_HARD_CAP,
  DAILY_PROTEIN_MAX,
  DAILY_PROTEIN_MIN,
  generatePlanForDate
} from '../src/lib/plannerGenerator.js';

const HEAVY_MEAL_CALORIE_THRESHOLD = 650;
const DAILY_CARB_CAP_G = DAILY_CARB_HARD_CAP;

const makeMeal = ({ name, protein, cal, macros, components = {}, cuisine }) => ({
  name,
  protein,
  cal,
  macros,
  components,
  cuisine
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
          name: 'Fish curry + dal + veg',
          protein: 50,
          cal: 520,
          macros: { p: 50, c: 32, f: 15 },
          components: { protein: 'Fish fillet', carb: 'Rice', veg: 'Mixed salad' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Salmon curry + saag',
          protein: 48,
          cal: 500,
          macros: { p: 48, c: 26, f: 14 },
          components: { protein: 'Grilled salmon', carb: 'Rice', veg: 'Sautéed spinach' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Lean chicken salad fallback',
          protein: 42,
          cal: 430,
          macros: { p: 42, c: 24, f: 12 },
          components: { protein: 'Chicken breast', carb: 'No carb', veg: 'Mixed salad' },
          cuisine: 'western'
        })
      ]
    },
    {
      forbiddenPair: 'chicken',
      dateKey: '2026-03-16',
      lunchDinner: [
        makeMeal({
          name: 'Chicken curry + dal + greens',
          protein: 52,
          cal: 540,
          macros: { p: 52, c: 34, f: 15 },
          components: { protein: 'Chicken breast', carb: 'Rice', veg: 'Mixed greens salad' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Chicken tikka + veg',
          protein: 49,
          cal: 500,
          macros: { p: 49, c: 22, f: 13 },
          components: { protein: 'Chicken thigh', carb: 'No carb', veg: 'Mixed salad' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Lean fish salad fallback',
          protein: 40,
          cal: 420,
          macros: { p: 40, c: 24, f: 12 },
          components: { protein: 'Fish fillet', carb: 'No carb', veg: 'Mixed salad' },
          cuisine: 'western'
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
            protein: 25,
            cal: 300,
            macros: { p: 25, c: 24, f: 10 },
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
          protein: 25,
          cal: 320,
          macros: { p: 25, c: 24, f: 10 },
          components: { protein: 'Eggs (whole)', carb: 'Toast' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'Heavy chicken thali + dal',
          protein: 62,
          cal: 760,
          macros: { p: 62, c: 55, f: 24 },
          components: { protein: 'Chicken breast', carb: 'Rice', veg: 'Mixed veg sabzi' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Heavy fish rice bowl + veg',
          protein: 60,
          cal: 740,
          macros: { p: 60, c: 52, f: 22 },
          components: { protein: 'Fish fillet', carb: 'Rice', veg: 'Mixed salad' },
          cuisine: 'western'
        }),
        makeMeal({
          name: 'Light tofu salad',
          protein: 32,
          cal: 360,
          macros: { p: 32, c: 20, f: 12 },
          components: { protein: 'Paneer', carb: 'No carb', veg: 'Mixed greens salad' },
          cuisine: 'western'
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

test('daily plan satisfies high-protein medium-low-carb guardrails', () => {
  const generated = generatePlanForDate({
    dateKey: '2026-03-18',
    plans: {},
    preferences: {},
    mealDatabase: {
      breakfast: [
        makeMeal({
          name: 'Lean starter + toast',
          protein: 30,
          cal: 300,
          macros: { p: 30, c: 24, f: 8 },
          components: { protein: 'Egg whites', carb: 'Whole wheat toast' }
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
          name: 'Lean chicken plate + salad',
          protein: 45,
          cal: 430,
          macros: { p: 45, c: 18, f: 12 },
          components: { protein: 'Chicken breast', carb: 'No carb', veg: 'Mixed salad' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'Balanced fish rice + veg',
          protein: 40,
          cal: 580,
          macros: { p: 40, c: 40, f: 15 },
          components: { protein: 'Fish fillet', carb: 'Rice', veg: 'Mixed salad' },
          cuisine: 'western'
        }),
        makeMeal({
          name: 'Balanced paneer bowl',
          protein: 30,
          cal: 420,
          macros: { p: 30, c: 24, f: 13 },
          components: { protein: 'Paneer', carb: 'No carb', veg: 'Mixed greens salad' },
          cuisine: 'western'
        })
      ]
    }
  });

  const totals = dailyMacroTotals(generated);
  const mealProteins = ['breakfast', 'lunch', 'dinner'].map((mealType) => Number(generated?.[mealType]?.protein || 0));

  assert.ok(
    totals.protein >= DAILY_PROTEIN_MIN && totals.protein <= DAILY_PROTEIN_MAX,
    `Expected protein in ${DAILY_PROTEIN_MIN}-${DAILY_PROTEIN_MAX}g, got ${totals.protein}g`
  );
  assert.ok(
    totals.carb <= DAILY_CARB_CAP_G,
    `Expected carbs <= ${DAILY_CARB_CAP_G}g, got ${totals.carb}g`
  );
  assert.ok(mealProteins.every((value) => value >= 20), `Expected each meal protein >= 20g, got ${mealProteins.join(', ')}`);
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
          protein: 30,
          cal: 340,
          macros: { p: 30, c: 30, f: 10 },
          components: { protein: 'Eggs (whole)', carb: 'Toast' }
        })
      ],
      lunchDinner: [
        makeMeal({
          name: 'High carb chicken bowl + dal',
          protein: 50,
          cal: 450,
          macros: { p: 50, c: 65, f: 12 },
          components: { protein: 'Chicken breast', carb: 'Rice', veg: 'Mixed veg sabzi' },
          cuisine: 'indian'
        }),
        makeMeal({
          name: 'High carb fish bowl + veg',
          protein: 48,
          cal: 430,
          macros: { p: 48, c: 60, f: 11 },
          components: { protein: 'Fish fillet', carb: 'Rice', veg: 'Mixed salad' },
          cuisine: 'western'
        }),
        makeMeal({
          name: 'Low carb fallback bowl',
          protein: 40,
          cal: 360,
          macros: { p: 40, c: 10, f: 12 },
          components: { protein: 'Paneer', carb: 'No carb', veg: 'Mixed greens salad' },
          cuisine: 'western'
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
