export const mealDatabase = {
  breakfast: [
    {
      name: "Scrambled eggs + toast",
      components: { protein: "Eggs (whole)", amount: 150, carb: "Whole wheat toast", carbAmount: 1, veg: null, style: "Pan-fried" },
      protein: 32,
      cal: 350,
      macros: { p: 29, c: 20, f: 17 }
    },
    {
      name: "Boiled eggs + ham sandwich",
      components: { protein: "Eggs (whole)", amount: 150, carb: "Whole wheat toast", carbAmount: 2, veg: null, style: "Grilled" },
      protein: 35,
      cal: 440,
      macros: { p: 33, c: 33, f: 19 }
    },
    {
      name: "Smoked salmon + avocado on toast",
      components: { protein: "Smoked salmon", amount: 100, carb: "Whole wheat toast", carbAmount: 2, veg: null, style: "Grilled" },
      protein: 30,
      cal: 420,
      macros: { p: 28, c: 32, f: 22 }
    },
    {
      name: "Greek yogurt + berry bowl",
      components: { protein: null, amount: 0, carb: "No carb", carbAmount: 0, veg: null, style: "Grilled" },
      protein: 25,
      cal: 320,
      macros: { p: 25, c: 35, f: 8 }
    },
    {
      name: "Poha + yogurt",
      components: { protein: null, amount: 0, carb: "Poha", carbAmount: 100, veg: null, style: "Pan-fried" },
      protein: 18,
      cal: 280,
      macros: { p: 21, c: 44, f: 1 }
    },
    {
      name: "Egg white omelette + avocado",
      components: { protein: "Eggs (whole)", amount: 120, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 100, style: "Pan-fried" },
      protein: 28,
      cal: 320,
      macros: { p: 26, c: 8, f: 19 }
    },
    {
      name: "Avocado toast + cheese",
      components: { protein: "Paneer", amount: 60, carb: "Whole wheat toast", carbAmount: 2, veg: null, style: "Grilled" },
      protein: 19,
      cal: 420,
      macros: { p: 19, c: 33, f: 24 }
    },
    {
      name: "Carrot halwa (sugar-free) + protein shake",
      components: { protein: null, amount: 0, carb: "No carb", carbAmount: 0, veg: null, style: "Grilled" },
      protein: 32,
      cal: 320,
      macros: { p: 32, c: 32, f: 11 }
    }
  ],
  lunch: [
    {
      name: "Chicken curry + rice",
      components: { protein: "Chicken breast", amount: 180, carb: "Cooked rice", carbAmount: 100, veg: null, style: "Curry style" },
      protein: 56,
      cal: 547,
      macros: { p: 56, c: 34, f: 11 },
      cuisine: "indian"
    },
    {
      name: "Grilled salmon fillet + sauteed veg",
      components: { protein: "Grilled salmon", amount: 180, carb: "No carb", carbAmount: 0, veg: "Sautéed broccoli", vegAmount: 150, style: "Grilled" },
      protein: 40,
      cal: 450,
      macros: { p: 40, c: 10, f: 26 },
      cuisine: "western"
    },
    {
      name: "Smoked salmon salad",
      components: { protein: "Smoked salmon", amount: 150, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 200, style: "Grilled" },
      protein: 27,
      cal: 320,
      macros: { p: 27, c: 15, f: 18 },
      cuisine: "western"
    },
    {
      name: "Smoked chicken salad",
      components: { protein: "Chicken breast", amount: 150, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 200, style: "Grilled" },
      protein: 46,
      cal: 380,
      macros: { p: 46, c: 12, f: 16 },
      cuisine: "western"
    },
    {
      name: "Pastrami salad",
      components: { protein: "Beef steak", amount: 120, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 200, style: "Grilled" },
      protein: 31,
      cal: 360,
      macros: { p: 31, c: 12, f: 22 },
      cuisine: "western"
    },
    {
      name: "Fish curry + rice",
      components: { protein: "Fish fillet", amount: 180, carb: "Cooked rice", carbAmount: 100, veg: null, style: "Curry style" },
      protein: 41,
      cal: 485,
      macros: { p: 41, c: 34, f: 8 },
      cuisine: "indian"
    },
    {
      name: "Rajma chawal + raita",
      components: { protein: null, amount: 0, carb: "Cooked rice", carbAmount: 100, veg: "Mixed veg sabzi", vegAmount: 150, style: "Curry style" },
      protein: 20,
      cal: 450,
      macros: { p: 20, c: 75, f: 4 },
      cuisine: "indian"
    },
    {
      name: "Chole + jowar roti + raita",
      components: { protein: null, amount: 0, carb: "Jowar roti (millet)", carbAmount: 2, veg: null, style: "Curry style" },
      protein: 22,
      cal: 530,
      macros: { p: 22, c: 66, f: 16 },
      cuisine: "indian"
    },
    {
      name: "Vietnamese chicken pho",
      components: { protein: "Chicken breast", amount: 180, carb: "Rice noodles", carbAmount: 120, veg: "Mixed salad", vegAmount: 60, style: "Soup style" },
      protein: 40,
      cal: 420,
      macros: { p: 40, c: 34, f: 14 },
      cuisine: "asian"
    },
    {
      name: "Grilled steak + salad",
      components: { protein: "Beef steak", amount: 200, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 150, style: "Grilled" },
      protein: 52,
      cal: 530,
      macros: { p: 52, c: 5, f: 32 },
      cuisine: "western"
    },
    {
      name: "Paneer tikka + jowar roti",
      components: { protein: "Paneer", amount: 150, carb: "Jowar roti (millet)", carbAmount: 2, veg: null, style: "Tandoori" },
      protein: 27,
      cal: 600,
      macros: { p: 27, c: 43, f: 30 },
      cuisine: "indian"
    },
    {
      name: "Thai pad krapow",
      components: { protein: "Chicken breast", amount: 150, carb: "Cooked rice", carbAmount: 80, veg: "Sautéed peppers", vegAmount: 80, style: "Pan-fried" },
      protein: 46,
      cal: 480,
      macros: { p: 46, c: 30, f: 12 },
      cuisine: "asian"
    },
    {
      name: "Mutton keema + rice",
      components: { protein: "Mutton keema", amount: 150, carb: "Cooked rice", carbAmount: 100, veg: null, style: "Curry style" },
      protein: 28,
      cal: 550,
      macros: { p: 28, c: 34, f: 26 },
      cuisine: "indian"
    },
    {
      name: "Grilled chicken + pasta",
      components: { protein: "Chicken breast", amount: 180, carb: "Pasta", carbAmount: 100, veg: "Zucchini", vegAmount: 100, style: "Grilled" },
      protein: 56,
      cal: 520,
      macros: { p: 56, c: 28, f: 10 },
      cuisine: "western"
    },
    {
      name: "Arhar dal + rice + matar paneer",
      components: { protein: "Paneer", amount: 120, carb: "Cooked rice", carbAmount: 120, veg: "Mixed veg sabzi", vegAmount: 120, style: "Curry style" },
      protein: 28,
      cal: 670,
      macros: { p: 28, c: 82, f: 23 },
      cuisine: "indian"
    },
    {
      name: "Chicken curry + jowar roti + dal",
      components: { protein: "Chicken breast", amount: 180, carb: "Jowar roti (millet)", carbAmount: 2, veg: "Mixed veg sabzi", vegAmount: 100, style: "Curry style" },
      protein: 43,
      cal: 730,
      macros: { p: 43, c: 78, f: 24 },
      cuisine: "indian"
    }
  ],
  dinner: [
    {
      name: "Grilled fish + salad",
      components: { protein: "Fish fillet", amount: 150, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 150, style: "Grilled" },
      protein: 35,
      cal: 195,
      macros: { p: 35, c: 5, f: 3 },
      cuisine: "western"
    },
    {
      name: "Grilled salmon + sauteed veg",
      components: { protein: "Grilled salmon", amount: 150, carb: "No carb", carbAmount: 0, veg: "Sautéed broccoli", vegAmount: 150, style: "Grilled" },
      protein: 33,
      cal: 380,
      macros: { p: 33, c: 10, f: 21 },
      cuisine: "western"
    },
    {
      name: "Smoked salmon salad",
      components: { protein: "Smoked salmon", amount: 120, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 150, style: "Grilled" },
      protein: 22,
      cal: 260,
      macros: { p: 22, c: 12, f: 14 },
      cuisine: "western"
    },
    {
      name: "Chicken soup + salad",
      components: { protein: "Chicken breast", amount: 120, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 100, style: "Soup style" },
      protein: 37,
      cal: 278,
      macros: { p: 37, c: 10, f: 6 },
      cuisine: "western"
    },
    {
      name: "Paneer sabzi + dal + raita",
      components: { protein: "Paneer", amount: 100, carb: "No carb", carbAmount: 0, veg: "Mixed veg sabzi", vegAmount: 150, style: "Curry style" },
      protein: 32,
      cal: 500,
      macros: { p: 32, c: 35, f: 24 },
      cuisine: "indian"
    },
    {
      name: "Pork chop + salad",
      components: { protein: "Pork chop", amount: 180, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 150, style: "Grilled" },
      protein: 41,
      cal: 450,
      macros: { p: 41, c: 5, f: 27 },
      cuisine: "western"
    },
    {
      name: "Fish curry + cauliflower",
      components: { protein: "Fish fillet", amount: 150, carb: "No carb", carbAmount: 0, veg: "Cauliflower", vegAmount: 150, style: "Curry style" },
      protein: 35,
      cal: 283,
      macros: { p: 35, c: 13, f: 8 },
      cuisine: "indian"
    },
    {
      name: "Tandoori chicken + salad",
      components: { protein: "Chicken breast", amount: 180, carb: "No carb", carbAmount: 0, veg: "Mixed salad", vegAmount: 150, style: "Tandoori" },
      protein: 56,
      cal: 340,
      macros: { p: 56, c: 5, f: 7 },
      cuisine: "indian"
    },
    {
      name: "Broccoli soup + grilled fish",
      components: { protein: "Fish fillet", amount: 120, carb: "No carb", carbAmount: 0, veg: "Sautéed broccoli", vegAmount: 200, style: "Soup style" },
      protein: 30,
      cal: 280,
      macros: { p: 30, c: 18, f: 6 },
      cuisine: "western"
    },
    {
      name: "Pumpkin soup + chicken",
      components: { protein: "Chicken breast", amount: 150, carb: "No carb", carbAmount: 0, veg: null, style: "Soup style" },
      protein: 46,
      cal: 340,
      macros: { p: 46, c: 12, f: 9 },
      cuisine: "western"
    },
    {
      name: "Saag meat + jowar roti + dal",
      components: { protein: "Lamb (seekh kabab)", amount: 170, carb: "Jowar roti (millet)", carbAmount: 2, veg: "Sautéed spinach", vegAmount: 120, style: "Curry style" },
      protein: 42,
      cal: 650,
      macros: { p: 42, c: 63, f: 24 },
      cuisine: "indian"
    },
    {
      name: "Vietnamese chicken pho",
      components: { protein: "Chicken breast", amount: 150, carb: "Rice noodles", carbAmount: 100, veg: "Mixed salad", vegAmount: 50, style: "Soup style" },
      protein: 34,
      cal: 360,
      macros: { p: 34, c: 33, f: 8 },
      cuisine: "asian"
    }
  ]
};
