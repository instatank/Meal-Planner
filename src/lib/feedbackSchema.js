/**
 * The feedback capture schema — what this app records, and what each record
 * is allowed to mean.
 *
 * This file exists for the same reason `rules.js` does: before it, the answer
 * to "what fields does a `custom` event carry?" was "read all six call sites
 * in App.jsx and hope they agree". They did not. `skip` recorded no meal name
 * at all, so a skip taught the system nothing about *what* was skipped, and
 * `custom` never wrote `customMealText` even though the promotion path keyed
 * on it — which is why that path was permanently empty (docs/CONSISTENCY_AUDIT.md
 * finding #6).
 *
 * Every producer now builds events through `createMealEvent`, which validates
 * against this registry. A missing required field is a loud console warning in
 * development rather than a signal that silently goes missing for months.
 *
 * ── Valence ──
 * Each meal-scoped event type declares how it should be read as a preference
 * signal, in one place, rather than being re-derived by each consumer:
 *
 *   subject   — whose reputation this event moves
 *   valence   — sign and magnitude, in units where a plain confirm is 1.0
 *
 * The numbers are deliberately conservative and are shrunk again by evidence
 * count in `preferenceLearning.js`. Nothing here can reject a plan; learned
 * preference is Tier 3 (scored) by construction.
 */

export const FEEDBACK_SCHEMA_VERSION = 2;

/**
 * Upper bound on the retained event log.
 *
 * The log is persisted as a single Firestore document under
 * `users/{uid}/metrics/meal-events` and mirrored into localStorage, so it is
 * bounded by the 1MB document limit and the ~5MB localStorage quota shared
 * across every key. At roughly 200 bytes per event, 4000 events is ~800KB and
 * about three years of normal use at four events a day. Trimming keeps the
 * newest, because recent behaviour is what the learner weights anyway.
 */
export const MAX_RETAINED_EVENTS = 4000;

export const EVENT_SCOPE = Object.freeze({
  MEAL: 'meal',
  PLAN: 'plan',
  META: 'meta'
});

export const EVENT_TYPE = Object.freeze({
  CONFIRM: 'confirm',
  SKIP: 'skip',
  SWAP: 'swap',
  EDIT: 'edit',
  CUSTOM: 'custom',
  CUSTOM_PROMOTED: 'custom_promoted',
  UNDO: 'undo',
  REGEN: 'regen',
  PLAN_REVIEW: 'plan_review',
  LEGACY_IMPORT: 'legacy_import'
});

/**
 * Every field on every event, and how each event reads as a signal.
 *
 * `subject` names the field holding the meal whose reputation moves, and
 * `counterSubject` the one that moves the other way in the same event — a
 * swap away from X to Y is evidence about X, not about Y, so most events
 * have no counter-subject at all. See the notes on each type.
 */
export const EVENT_DEFINITIONS = Object.freeze({
  [EVENT_TYPE.CONFIRM]: {
    scope: EVENT_SCOPE.MEAL,
    required: ['dateKey', 'mealType', 'mealName'],
    optional: ['protein', 'cal'],
    describes: 'The planned meal was eaten as planned.',
    signals: [{ field: 'mealName', valence: 1.0 }]
  },

  [EVENT_TYPE.SKIP]: {
    scope: EVENT_SCOPE.MEAL,
    // `mealName` is required as of schema v2. Before it, a skip recorded only
    // a date and a slot, which is the single largest capture gap this schema
    // closes: the user told us they would not eat something and we did not
    // write down what it was.
    required: ['dateKey', 'mealType'],
    optional: ['mealName', 'protein', 'cal'],
    describes: 'The planned meal was deliberately not eaten.',
    // Softer than a swap: a skipped lunch is often a skipped lunch, not a
    // rejected dish. It still points the right way.
    signals: [{ field: 'mealName', valence: -0.6 }]
  },

  [EVENT_TYPE.SWAP]: {
    scope: EVENT_SCOPE.MEAL,
    required: ['dateKey', 'mealType', 'fromMealName'],
    optional: ['toMealName'],
    describes: 'The user cycled off the planned meal to the next alternative.',
    // Only `fromMealName` carries information. `handleSwap` advances through
    // an ordered list, so the meal landed on was not chosen — it was next.
    // Crediting it would teach the system that whatever sorts after a
    // disliked dish is liked.
    signals: [{ field: 'fromMealName', valence: -1.0 }]
  },

  [EVENT_TYPE.EDIT]: {
    scope: EVENT_SCOPE.MEAL,
    required: ['dateKey', 'mealType', 'updatedMealName'],
    optional: ['originalMealName'],
    describes: 'The user named a specific replacement for the planned meal.',
    // Both halves are informative here, unlike a swap: the replacement was
    // typed or picked by name, so it is a real choice.
    signals: [
      { field: 'updatedMealName', valence: 1.0 },
      { field: 'originalMealName', valence: -1.0 }
    ]
  },

  [EVENT_TYPE.CUSTOM]: {
    scope: EVENT_SCOPE.MEAL,
    required: ['dateKey', 'mealType'],
    // A custom log has to say what was eaten, but it can say it either way:
    // `mealName` once the text has been matched to a catalog meal, or the raw
    // `customMealText` when it has not. Requiring both would reject every
    // unmatched entry, which is exactly the kind we most want to keep.
    requireOneOf: [['mealName', 'customMealText']],
    // `customMealText` is what the user actually typed, before it was matched
    // to a catalog meal. `getCustomMealCandidates` keys on it.
    optional: ['previousMealName', 'customMealText', 'source', 'protein', 'cal'],
    describes: 'The user logged something other than the planned meal.',
    signals: [
      { field: 'mealName', valence: 1.0 },
      // Only fires when the slot actually held a plan. An empty
      // `previousMealName` means there was nothing to reject.
      { field: 'previousMealName', valence: -0.6 }
    ]
  },

  [EVENT_TYPE.CUSTOM_PROMOTED]: {
    scope: EVENT_SCOPE.META,
    required: ['customMealText', 'promotedMealName'],
    optional: ['dateKey', 'mealType'],
    describes: 'A repeatedly-logged custom meal was added to the catalog.',
    signals: []
  },

  [EVENT_TYPE.UNDO]: {
    scope: EVENT_SCOPE.META,
    required: ['dateKey', 'undoTargets'],
    optional: ['mealType', 'affectedSlots'],
    describes: 'Earlier events are retracted and must not be learned from.',
    signals: []
  },

  [EVENT_TYPE.REGEN]: {
    scope: EVENT_SCOPE.META,
    required: ['dateKey'],
    optional: [
      'mealType', 'regeneratedDays', 'keptLockedDays', 'repaired',
      'violationCodes', 'contextMeals'
    ],
    describes: 'A week (or run of days) was regenerated.',
    signals: []
  },

  [EVENT_TYPE.PLAN_REVIEW]: {
    scope: EVENT_SCOPE.PLAN,
    required: ['weekStartKey', 'verdict'],
    optional: [
      'mealType', 'dateKey', 'rating', 'reasonIds', 'note',
      'dishes', 'dateKeys', 'dislikedDishes'
    ],
    describes: 'The user accepted, rejected or rated a whole week.',
    // Plan-level verdicts reach dishes through `preferenceLearning.js`, which
    // spreads them thinly across the week rather than through a single field.
    signals: []
  },

  [EVENT_TYPE.LEGACY_IMPORT]: {
    scope: EVENT_SCOPE.META,
    required: [],
    optional: ['dateKey', 'mealType', 'importedPreferences'],
    describes: 'One-time import of pre-event-log preference counters.',
    signals: []
  }
});

export const KNOWN_EVENT_TYPES = Object.freeze(Object.keys(EVENT_DEFINITIONS));

/** Every event carries these, whatever its type. */
const UNIVERSAL_FIELDS = Object.freeze(['id', 'type', 'timestamp', 'v']);

export const getEventDefinition = (type) => EVENT_DEFINITIONS[type] || null;

/**
 * Check one event against its definition.
 *
 * Returns issues rather than throwing: a malformed event should still be
 * stored (losing data is worse than storing it oddly) and should still be
 * loudly visible. Unknown types are reported but not rejected, so a log
 * written by a newer build can still be read by an older one.
 */
export const validateEvent = (event = {}) => {
  const issues = [];
  const definition = getEventDefinition(event?.type);

  if (!definition) {
    return { valid: false, unknownType: true, issues: [`unknown event type "${event?.type}"`] };
  }

  for (const field of definition.required) {
    const value = event[field];
    const missing =
      value === undefined
      || value === null
      || (typeof value === 'string' && value.trim() === '')
      || (Array.isArray(value) && value.length === 0);
    if (missing) issues.push(`missing required field "${field}"`);
  }

  for (const group of definition.requireOneOf || []) {
    const satisfied = group.some((field) => {
      const value = event[field];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
    if (!satisfied) issues.push(`needs at least one of ${group.map((f) => `"${f}"`).join(', ')}`);
  }

  const allowed = new Set([
    ...UNIVERSAL_FIELDS,
    ...definition.required,
    ...definition.optional,
    ...(definition.requireOneOf || []).flat()
  ]);
  for (const field of Object.keys(event)) {
    if (!allowed.has(field)) issues.push(`unexpected field "${field}"`);
  }

  return { valid: issues.length === 0, unknownType: false, issues };
};

// ─── Plan review vocabulary ─────────────────────────────────────────────────

export const PLAN_VERDICT = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
});

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * The rating a week must reach before it counts as a positive signal.
 *
 * 3 is "fine", so it is deliberately neutral — the learner reads
 * `(rating - RATING_NEUTRAL)` and a 3 therefore moves nothing at all.
 */
export const RATING_NEUTRAL = 3;

/**
 * Structured reasons, and what each one is evidence *about*.
 *
 * Free text is where the real nuance lives, but free text cannot be learned
 * from without another model call on every read. These tags exist so the
 * common cases become numbers immediately, while the note beside them keeps
 * the nuance for a human — and for a later pass that can afford to read it.
 *
 * `attribute` reasons name a key in the same vocabulary that
 * `preferenceLearning.js` extracts from meals, so a reason and an observed
 * behaviour land in the same bucket and reinforce each other.
 */
export const PLAN_REVIEW_REASONS = Object.freeze([
  {
    id: 'too_repetitive',
    label: 'Too repetitive',
    polarity: 'negative',
    signal: { kind: 'structure', key: 'variety', direction: 'more' }
  },
  {
    id: 'too_much_indian',
    label: 'Too much Indian food',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'cuisine:indian', direction: 'less' }
  },
  {
    id: 'not_enough_indian',
    label: 'Not enough Indian food',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'cuisine:indian', direction: 'more' }
  },
  {
    id: 'too_much_flatbread',
    label: 'Too much roti / paratha / pasta',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'carb:flatbread_pasta', direction: 'less' }
  },
  {
    id: 'too_many_carbs',
    label: 'Too many carbs',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'carbLevel:high', direction: 'less' }
  },
  {
    id: 'meals_too_heavy',
    label: 'Meals too heavy',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'weight:heavy', direction: 'less' }
  },
  {
    id: 'meals_too_light',
    label: 'Meals too light / not filling',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'weight:light', direction: 'less' }
  },
  {
    id: 'too_much_effort',
    label: 'Too much cooking effort',
    polarity: 'negative',
    signal: { kind: 'attribute', key: 'effort:high', direction: 'less' }
  },
  {
    id: 'protein_too_low',
    label: 'Protein too low',
    polarity: 'negative',
    signal: { kind: 'macro', key: 'protein', direction: 'more' }
  },
  {
    id: 'disliked_dishes',
    label: 'Specific dishes I do not want',
    polarity: 'negative',
    // Reaches the named dishes in `dislikedDishes`, not the whole week.
    signal: { kind: 'dish', direction: 'less' }
  },
  {
    id: 'good_variety',
    label: 'Good variety',
    polarity: 'positive',
    signal: { kind: 'structure', key: 'variety', direction: 'keep' }
  },
  {
    id: 'easy_to_cook',
    label: 'Easy to cook',
    polarity: 'positive',
    signal: { kind: 'attribute', key: 'effort:low', direction: 'more' }
  },
  {
    id: 'other',
    label: 'Something else (see note)',
    polarity: 'neutral',
    signal: { kind: 'none' }
  }
]);

export const PLAN_REVIEW_REASON_BY_ID = Object.freeze(
  Object.fromEntries(PLAN_REVIEW_REASONS.map((reason) => [reason.id, reason]))
);

export const getReviewReason = (id) => PLAN_REVIEW_REASON_BY_ID[id] || null;
