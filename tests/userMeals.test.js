import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEAL_SLOT,
  DRAFT_STATUS,
  MEAL_SLOT,
  buildIngestionPayload,
  buildUserCatalogMeal,
  createMealDraft,
  describeDraftImpact,
  findDuplicateName,
  mealNameKey,
  normalizeMealDraft,
  normalizeMealDraftList,
  resolveDraftParts,
  summarizeMealDrafts
} from '../src/lib/userMeals.js';
import { buildIngredientEstimateTool } from '../src/lib/mealIngestService.js';
import { buildCatalogMeal } from '../src/lib/mealDataLayer.js';
import { ingredients } from '../src/data/ingredients.js';
import { mealDatabase } from '../src/data/mealDatabase.js';
import { getRules } from '../src/lib/rules.js';
import { EVENT_DEFINITIONS, EVENT_TYPE, validateEvent } from '../src/lib/feedbackSchema.js';

const chickenRice = [
  { ingredientId: 'chicken_breast', qty: 150, unit: 'g' },
  { ingredientId: 'cooked_rice', qty: 150, unit: 'g' }
];

// ─── The load-bearing guarantee ─────────────────────────────────────────────

test('a draft with no ingredients can never become a catalog meal', () => {
  // The whole reason drafts exist. The optimizer enforces a per-meal protein
  // floor and a weekly protein floor against catalog macros, so a meal with no
  // ingredient rollup is not an incomplete meal — it is a meal that would be
  // planned against numbers nobody computed.
  const { meal, reason } = buildUserCatalogMeal(
    createMealDraft({ name: 'Something I ate', slot: MEAL_SLOT.LUNCH_DINNER })
  );
  assert.equal(meal, null);
  assert.match(reason, /ingredient/i);
});

test('a draft whose ingredients are all unknown is refused, not silently emptied', () => {
  const draft = createMealDraft({
    name: 'Kokum curry',
    slot: MEAL_SLOT.LUNCH_DINNER,
    parts: [{ ingredientId: 'kokum_pulp', qty: 60, unit: 'g' }]
  });

  assert.equal(draft.status, DRAFT_STATUS.PENDING, 'unknown parts do not count as an estimate');
  const { meal } = buildUserCatalogMeal(draft);
  assert.equal(meal, null);
});

test('an unknown ingredient is reported, not dropped in silence', () => {
  // A chicken curry that quietly loses its chicken still reads as a chicken
  // curry, which is why the drop has to travel back to the caller.
  const { parts, dropped } = resolveDraftParts([
    ...chickenRice,
    { ingredientId: 'not_a_real_ingredient', qty: 100, unit: 'g' },
    { ingredientId: 'cooked_rice', qty: 0, unit: 'g' }
  ]);

  assert.equal(parts.length, 2);
  assert.equal(dropped.length, 2);
  assert.match(dropped[0].reason, /unknown/);
  assert.match(dropped[1].reason, /quantity/);
});

test('a status claimed by a stored record never outranks its actual parts', () => {
  // A record synced from an older build, or hand-edited, could claim to be
  // estimated with nothing in it — and would then render an Approve button
  // that cannot work.
  const lying = normalizeMealDraft({
    name: 'Ghost dish',
    status: DRAFT_STATUS.ESTIMATED,
    parts: []
  });
  assert.equal(lying.status, DRAFT_STATUS.UNRESOLVED);

  const honest = normalizeMealDraft({ name: 'Real dish', status: DRAFT_STATUS.PENDING, parts: chickenRice });
  assert.equal(honest.status, DRAFT_STATUS.ESTIMATED);
});

// ─── A user meal is the same kind of object as a shipped one ────────────────

test('an approved user meal comes out of the same pipeline as a shipped dish', () => {
  // Not "looks similar" — identical. Both go through `buildCatalogMeal`, so
  // the derived tags, the attribute keys the learner reads and the rule
  // metadata the optimizer reads are produced by one function, not two.
  const { meal } = buildUserCatalogMeal(
    createMealDraft({
      name: 'Grilled chicken + rice',
      slot: MEAL_SLOT.LUNCH_DINNER,
      cuisine: 'continental',
      parts: chickenRice
    })
  );

  const reference = buildCatalogMeal(
    { name: 'Grilled chicken + rice', canonical_name: 'Grilled chicken + rice', parts: chickenRice },
    'lunch_dinner',
    { cuisine: 'continental' }
  );

  for (const field of ['cal', 'protein', 'carb_type', 'primary_ingredient', 'is_fat_heavy', 'has_fibre', 'meal_weight']) {
    assert.deepEqual(meal[field], reference[field], `${field} must match the shipped pipeline`);
  }
  assert.deepEqual(meal.macros, reference.macros);
  assert.deepEqual(meal.tags, reference.tags);
  assert.deepEqual(meal.rule_metadata, reference.rule_metadata);
});

test('macros are computed, never carried over from the draft', () => {
  // The failure `buildPromotedCustomMeal` used to have, in a different shape:
  // a record arriving with a flattering protein number must not keep it.
  const { meal } = buildUserCatalogMeal(
    normalizeMealDraft({
      name: 'Optimistic bowl',
      slot: MEAL_SLOT.LUNCH_DINNER,
      parts: [{ ingredientId: 'cooked_rice', qty: 100, unit: 'g' }],
      protein: 99,
      cal: 5
    })
  );

  assert.ok(meal.protein < 10, 'protein comes from the rice, not from the record');
  assert.ok(meal.cal > 100);
});

test('a user meal declares that its portions are estimated', () => {
  const { meal } = buildUserCatalogMeal(
    createMealDraft({ name: 'Home dal', slot: MEAL_SLOT.LUNCH_DINNER, parts: chickenRice })
  );
  assert.equal(meal.isUserAdded, true);
  assert.equal(meal.portionsEstimated, true);
  // `inferSourceType` reads "assumption" out of the source string and drops
  // confidence accordingly, which is the honest answer for a portion guess.
  assert.match(meal.nutrition_source, /assumption/i);
  assert.equal(meal.nutrition_metadata.source_type, 'user_assumption');
});

test('cuisine is lowercased into the namespace the rest of the app uses', () => {
  // Finding #5 in the consistency audit: `Continental` vs `continental` made
  // the Indian quick action match 0 of 42 meals. A user meal must not
  // reintroduce a capitalised value.
  const { meal } = buildUserCatalogMeal(
    normalizeMealDraft({ name: 'Rajma', slot: MEAL_SLOT.LUNCH_DINNER, cuisine: 'INDIAN', parts: chickenRice })
  );
  assert.equal(meal.cuisine, 'indian');
  assert.equal(meal.tags.cuisine, 'indian');
});

test('an unrecognised cuisine falls back rather than inventing a bucket', () => {
  const draft = normalizeMealDraft({ name: 'X', cuisine: 'Peruvian-fusion' });
  assert.equal(draft.cuisine, 'general');
});

// ─── Duplicates ─────────────────────────────────────────────────────────────

test('duplicate names are caught against the catalog and the queue alike', () => {
  // Two records for one dish are two independent R1 weekly caps, so "once a
  // week" quietly becomes twice.
  const shipped = mealDatabase.lunchDinner[0].name;
  const drafts = [createMealDraft({ name: 'Paneer thing' })];

  assert.equal(
    findDuplicateName(shipped, { existingNames: [shipped], drafts })?.kind,
    'catalog'
  );
  assert.equal(
    findDuplicateName('paneer  THING!', { existingNames: [], drafts })?.kind,
    'draft'
  );
  assert.equal(findDuplicateName('Genuinely new dish', { existingNames: [shipped], drafts }), null);
});

test('the duplicate key matches how App.jsx already compares meal names', () => {
  assert.equal(mealNameKey('Rajma chawal + raita'), mealNameKey('rajma  chawal +   RAITA'));
  assert.notEqual(mealNameKey('Rajma chawal'), mealNameKey('Rajma masala'));
});

test('the queue de-duplicates by name so two devices do not create two dishes', () => {
  const list = normalizeMealDraftList([
    { id: 'a', name: 'Chicken chettinad' },
    { id: 'b', name: 'chicken chettinad' },
    { id: 'c', name: '' }
  ]);
  assert.equal(list.length, 1);
});

// ─── Warnings shown before approving, not discovered weeks later ────────────

test('a thin lunch/dinner dish is flagged as unplannable before it is added', () => {
  const rules = getRules('high_protein');
  const { meal } = buildUserCatalogMeal(
    createMealDraft({
      name: 'Plain rice',
      slot: MEAL_SLOT.LUNCH_DINNER,
      parts: [{ ingredientId: 'cooked_rice', qty: 150, unit: 'g' }]
    })
  );

  const warnings = describeDraftImpact(meal, MEAL_SLOT.LUNCH_DINNER, rules);
  assert.ok(
    warnings.some((w) => w.includes(`${rules.hard.minMealProtein}g per-meal floor`)),
    'a dish under the floor can never be planned and the screen must say so'
  );

  // The same dish as a snack carries no such warning: the floor is a
  // lunch/dinner rule, and warning about it everywhere would train the user to
  // ignore warnings.
  assert.deepEqual(describeDraftImpact(meal, MEAL_SLOT.SNACK, rules), []);
});

test('impact warnings survive a missing ruleset instead of throwing', () => {
  // `getRules` throws for declared-but-unbuilt goals by design. A display hint
  // is not worth taking the screen down for.
  assert.deepEqual(describeDraftImpact(null, MEAL_SLOT.LUNCH_DINNER, null), []);
  assert.deepEqual(describeDraftImpact({ protein: 5, cal: 100 }, MEAL_SLOT.LUNCH_DINNER, null), []);
});

// ─── The estimator cannot invent an ingredient ─────────────────────────────

test('the estimate tool can only name ingredients the app actually has', () => {
  // The same structural guarantee `planService` gets from per-slot enums, one
  // level down: a plausible-but-absent id like `chicken_thigh_boneless` would
  // resolve to nothing, and a dish quietly missing its protein source still
  // reads as a chicken dish.
  const tool = buildIngredientEstimateTool(ingredients);
  const enumIds = tool.input_schema.properties.parts.items.properties.ingredientId.enum;

  assert.deepEqual(new Set(enumIds), new Set(Object.keys(ingredients)));
  assert.ok(!enumIds.includes('chicken_thigh_boneless'));
  assert.deepEqual(tool.input_schema.required, ['parts', 'cuisine', 'confidence']);
  // No macro fields: the app computes those from the parts. Asking for both is
  // how a meal ends up with a stated protein its ingredients disagree with.
  for (const field of ['protein', 'calories', 'cal', 'macros']) {
    assert.ok(!(field in tool.input_schema.properties), `the model must not supply ${field}`);
  }
});

test('the estimate tool only offers units computeMacros understands', () => {
  const tool = buildIngredientEstimateTool(ingredients);
  const units = tool.input_schema.properties.parts.items.properties.unit.enum;
  const catalogUnits = new Set(
    Object.values(mealDatabase).flat().flatMap((meal) => (meal.parts || []).map((p) => p.unit))
  );
  for (const unit of catalogUnits) assert.ok(units.includes(unit), `${unit} is used by the catalog`);
});

// ─── The event ──────────────────────────────────────────────────────────────

test('meal_added is recorded but teaches the learner nothing', () => {
  // "You added it, so you like it" is true and still wrong to encode: a
  // brand-new dish with a positive prior outranks dishes with a real record
  // behind them, which rewards novelty rather than learning taste. The tier
  // set on the same screen is the deliberate channel for "plan this often".
  const definition = EVENT_DEFINITIONS[EVENT_TYPE.MEAL_ADDED];
  assert.ok(definition, 'meal_added must be in the schema');
  assert.deepEqual(definition.signals, []);
  assert.deepEqual(definition.required, ['mealName', 'mealType']);

  const valid = validateEvent({
    type: 'meal_added',
    mealName: 'Chicken chettinad',
    mealType: 'lunchDinner',
    dateKey: '2026-09-15',
    cuisine: 'indian',
    source: 'ai'
  });
  assert.equal(valid.valid, true, valid.issues.join('; '));
});

// ─── The handover payload ───────────────────────────────────────────────────

test('the export carries approved meals and the unresolved backlog alike', () => {
  const { meal } = buildUserCatalogMeal(
    createMealDraft({ name: 'Chicken chettinad', slot: MEAL_SLOT.LUNCH_DINNER, parts: chickenRice })
  );

  const payload = buildIngestionPayload({
    drafts: [
      createMealDraft({ name: 'Kokum curry', slot: MEAL_SLOT.LUNCH_DINNER }),
      normalizeMealDraft({ name: 'Undhiyu', unmatched: ['surti papdi', 'purple yam'], estimateSource: 'ai' })
    ],
    userCatalog: {
      lunchDinner: [meal, ...mealDatabase.lunchDinner.slice(0, 2)],
      breakfast: [],
      snack: []
    },
    tierMap: { 'Chicken chettinad': { tier: 'staple', rating: 5 } }
  });

  assert.equal(payload.kind, 'meal-planner/user-meals');
  // Shipped dishes in the merged catalog must not travel: they are already in
  // the repo, and re-emitting them would invite duplicate entries.
  assert.equal(payload.approved.length, 1);
  assert.equal(payload.approved[0].tier, 'staple');
  assert.equal(payload.approved[0].rating, 5);
  assert.ok(payload.approved[0].parts.length);
  // The unmatched components are the ingredient backlog — the actual work.
  assert.deepEqual(payload.drafts[1].unmatched, ['surti papdi', 'purple yam']);
  assert.equal(payload.knownIngredientCount, Object.keys(ingredients).length);
});

test('the queue summary separates what the planner can see from what it cannot', () => {
  const summary = summarizeMealDrafts([
    normalizeMealDraft({ name: 'a', parts: chickenRice }),
    normalizeMealDraft({ name: 'b' }),
    normalizeMealDraft({ name: 'c', estimateSource: 'ai' })
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.estimated, 1);
  assert.equal(summary.waiting, 2, 'pending and unresolved are both invisible to the planner');
});

test('a new draft defaults to the slot with the most openings', () => {
  assert.equal(createMealDraft({ name: 'x' }).slot, DEFAULT_MEAL_SLOT);
  assert.equal(DEFAULT_MEAL_SLOT, MEAL_SLOT.LUNCH_DINNER);
});

test('no tier is recorded unless the user chose one', () => {
  // An untouched tier map is what keeps the planner bit-identical for someone
  // with no opinion (see mealTiers.js). Defaulting every added meal to
  // `occasional` would write an entry for every dish and quietly end that.
  assert.equal(createMealDraft({ name: 'x' }).tier, '');
  assert.equal(createMealDraft({ name: 'x', tier: 'nonsense' }).tier, '');
  assert.equal(createMealDraft({ name: 'x', tier: 'staple' }).tier, 'staple');
});
