import React, { useMemo, useState } from 'react';

import { ingredients } from '../data/ingredients.js';
import {
  CUISINE_OPTIONS,
  DEFAULT_MEAL_SLOT,
  DRAFT_STATUS,
  MEAL_SLOT_LABELS,
  MEAL_SLOT_ORDER,
  summarizeMealDrafts
} from '../lib/userMeals.js';
import { FREQUENCY_TIER, TIER_DEFINITIONS, TIER_ORDER } from '../lib/mealTiers';

/**
 * Add a dish of your own.
 *
 * ── What this screen is trying to make obvious ──
 *
 * A meal you add is not immediately a meal the planner uses, and the screen
 * has to say so without making it feel broken. So every draft carries a status
 * line in plain words — "the planner can't see this yet" — and the Approve
 * button only exists once there is something real to approve.
 *
 * The estimate is shown as *ingredients with editable quantities*, not as a
 * protein figure. That is deliberate: the macros are arithmetic over the
 * quantities, so the quantity is the only thing worth correcting, and it is
 * the thing the person who ate the dish actually knows. Showing "34g protein"
 * with an edit box would invite correcting the output instead of the input,
 * and an edited output is exactly the fiction this whole path exists to avoid.
 *
 * Warnings are shown *before* approving rather than discovered three weeks
 * later when the dish never appears — the same lesson the tiering screen
 * learned about thin staples.
 */

const STATUS_COPY = {
  [DRAFT_STATUS.PENDING]: {
    label: 'Not worked out yet',
    tone: 'bg-gray-100 text-gray-600',
    line: 'The planner cannot see this yet — work out its ingredients to add it.'
  },
  [DRAFT_STATUS.ESTIMATED]: {
    label: 'Ready to check',
    tone: 'bg-amber-100 text-amber-800',
    line: 'Check the portions, then add it to your meals.'
  },
  [DRAFT_STATUS.UNRESOLVED]: {
    label: 'Needs a human',
    tone: 'bg-red-100 text-red-700',
    line: 'This could not be built from known ingredients. Export it and it can be added properly in the database.'
  }
};

const CONFIDENCE_COPY = {
  high: { label: 'Confident', tone: 'text-emerald-700' },
  medium: { label: 'Roughly right', tone: 'text-amber-700' },
  low: { label: 'A guess — check it', tone: 'text-red-700' }
};

const EMPTY_FORM = {
  name: '',
  slot: DEFAULT_MEAL_SLOT,
  cuisine: '',
  tier: '',
  note: '',
  recipeUrl: ''
};

const AddMealPanel = ({
  drafts = [],
  userMeals = [],
  onAddDraft,
  onEstimateDraft,
  onUpdateDraft,
  onApproveDraft,
  onDiscardDraft,
  onRemoveUserMeal,
  onExport,
  previewDraft,
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const summary = useMemo(() => summarizeMealDrafts(drafts), [drafts]);

  const setField = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (disabled) return;
    const name = form.name.trim();
    if (!name) {
      setError('Give the meal a name.');
      return;
    }
    const result = await onAddDraft({ ...form, name });
    if (result?.error) {
      setError(result.error);
      return;
    }
    setError('');
    setForm(EMPTY_FORM);
  };

  const runEstimate = async (draft) => {
    setBusyId(draft.id);
    setError('');
    try {
      const result = await onEstimateDraft(draft);
      if (result?.error) setError(result.error);
    } finally {
      setBusyId('');
    }
  };

  const changeQty = (draft, index, value) => {
    const qty = Number(value);
    const parts = draft.parts.map((part, i) => (i === index ? { ...part, qty } : part));
    onUpdateDraft(draft.id, { parts, estimateSource: 'manual' });
  };

  const removePart = (draft, index) => {
    onUpdateDraft(draft.id, {
      parts: draft.parts.filter((_, i) => i !== index),
      estimateSource: 'manual'
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-md mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <h3 className="font-bold text-gray-800">➕ Add your own meals</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {userMeals.length} added
            {summary.total > 0 && (
              <span className="text-amber-700 font-semibold">
                {' '}· {summary.total} waiting
              </span>
            )}
          </p>
        </div>
        <span className="text-gray-400 text-sm shrink-0 ml-3">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
          {/* ── The form ── */}
          <form onSubmit={submit} className="space-y-2 mb-5">
            <input
              value={form.name}
              onChange={setField('name')}
              placeholder="Meal name — e.g. Chicken chettinad + rice"
              disabled={disabled}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
            />

            <div className="flex gap-2">
              <select
                value={form.slot}
                onChange={setField('slot')}
                disabled={disabled}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-xs text-gray-700 focus:outline-none"
              >
                {MEAL_SLOT_ORDER.map((slot) => (
                  <option key={slot} value={slot}>{MEAL_SLOT_LABELS[slot]}</option>
                ))}
              </select>
              <select
                value={form.cuisine}
                onChange={setField('cuisine')}
                disabled={disabled}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-xs text-gray-700 focus:outline-none"
              >
                <option value="">Cuisine (auto)</option>
                {CUISINE_OPTIONS.map((cuisine) => (
                  <option key={cuisine} value={cuisine}>
                    {cuisine.charAt(0).toUpperCase() + cuisine.slice(1)}
                  </option>
                ))}
              </select>
              <select
                value={form.tier}
                onChange={setField('tier')}
                disabled={disabled}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-xs text-gray-700 focus:outline-none"
              >
                <option value="">How often?</option>
                {/* Retired is absent on purpose: "never plan this" is not a
                    thing to say about a dish you are in the middle of adding. */}
                {TIER_ORDER.filter((tier) => tier !== FREQUENCY_TIER.RETIRED).map((tier) => (
                  <option key={tier} value={tier}>{TIER_DEFINITIONS[tier].label}</option>
                ))}
              </select>
            </div>

            <input
              value={form.note}
              onChange={setField('note')}
              placeholder="Note (optional) — how you make it, where it's from"
              disabled={disabled}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
            />
            <input
              value={form.recipeUrl}
              onChange={setField('recipeUrl')}
              placeholder="Recipe link (optional)"
              disabled={disabled}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
            />

            <button
              type="submit"
              disabled={disabled || !form.name.trim()}
              className="w-full bg-gray-800 text-white rounded-lg py-2 text-sm font-semibold hover:bg-gray-900 disabled:opacity-40"
            >
              Add to the queue
            </button>
          </form>

          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</p>
          )}

          {/* ── The queue ── */}
          {drafts.length > 0 && (
            <div className="mb-5">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                Waiting to be added ({drafts.length})
              </h4>
              <div className="space-y-2.5">
                {drafts.map((draft) => {
                  const status = STATUS_COPY[draft.status] || STATUS_COPY[DRAFT_STATUS.PENDING];
                  const preview = draft.parts.length ? previewDraft(draft) : null;
                  const meal = preview?.meal;
                  const busy = busyId === draft.id;

                  return (
                    <div key={draft.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 truncate">{draft.name}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            {MEAL_SLOT_LABELS[draft.slot]} · {draft.cuisine}
                            {draft.tier && ` · ${TIER_DEFINITIONS[draft.tier]?.label}`}
                          </div>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${status.tone}`}>
                          {status.label}
                        </span>
                      </div>

                      <p className="text-[10px] text-gray-500 mt-1.5">{status.line}</p>

                      {draft.note && (
                        <p className="text-[10px] text-gray-500 italic mt-1">“{draft.note}”</p>
                      )}

                      {/* Ingredients, editable where it matters */}
                      {draft.parts.length > 0 && (
                        <div className="mt-2.5 space-y-1">
                          {draft.parts.map((part, index) => (
                            <div key={`${part.ingredientId}-${index}`} className="flex items-center gap-1.5">
                              <span className="text-[11px] text-gray-700 flex-1 min-w-0 truncate">
                                {ingredients[part.ingredientId]?.name || part.ingredientId}
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={part.qty}
                                onChange={(e) => changeQty(draft, index, e.target.value)}
                                disabled={disabled}
                                className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] text-right focus:outline-none focus:border-blue-400"
                              />
                              <span className="text-[10px] text-gray-400 w-9">{part.unit}</span>
                              <button
                                onClick={() => removePart(draft, index)}
                                disabled={disabled}
                                aria-label={`Remove ${part.ingredientId}`}
                                className="text-gray-300 hover:text-red-500 text-xs px-1 disabled:opacity-40"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* What those quantities come to */}
                      {meal && (
                        <div className="mt-2 text-[11px] text-gray-700 bg-white border border-gray-200 rounded px-2 py-1.5">
                          <strong>{meal.protein}g protein</strong> · {meal.cal} kcal ·{' '}
                          {meal.macros.c}g carbs · {meal.macros.f}g fat · {meal.macros.fibre}g fibre
                          {draft.confidence && (
                            <span className={`ml-1.5 font-semibold ${CONFIDENCE_COPY[draft.confidence]?.tone || ''}`}>
                              ({CONFIDENCE_COPY[draft.confidence]?.label})
                            </span>
                          )}
                        </div>
                      )}

                      {preview?.reason && (
                        <p className="text-[10px] text-red-700 mt-1.5">{preview.reason}</p>
                      )}

                      {preview?.warnings?.map((warning) => (
                        <p key={warning} className="text-[10px] text-amber-700 mt-1.5">⚠ {warning}</p>
                      ))}

                      {draft.unmatched.length > 0 && (
                        <p className="text-[10px] text-gray-500 mt-1.5">
                          Not in the ingredient list: {draft.unmatched.join(', ')}. Left out rather than
                          substituted, so the macros are of what remains.
                        </p>
                      )}

                      {draft.estimateNote && (
                        <p className="text-[10px] text-gray-500 mt-1">{draft.estimateNote}</p>
                      )}

                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        <button
                          onClick={() => runEstimate(draft)}
                          disabled={disabled || busy}
                          className="px-3 py-1 rounded-full bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busy
                            ? 'Working it out…'
                            : draft.parts.length
                              ? 'Work it out again'
                              : 'Work out ingredients'}
                        </button>
                        {meal && (
                          <button
                            onClick={() => onApproveDraft(draft)}
                            disabled={disabled}
                            className="px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Add to my meals
                          </button>
                        )}
                        <button
                          onClick={() => onDiscardDraft(draft.id)}
                          disabled={disabled}
                          className="px-3 py-1 rounded-full bg-white border border-gray-300 text-gray-600 text-[11px] font-semibold hover:bg-gray-100 disabled:opacity-50"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Meals already added ── */}
          {userMeals.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                Your meals, now in the rotation ({userMeals.length})
              </h4>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {userMeals.map((meal) => (
                  <div
                    key={meal.name}
                    className="flex justify-between items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5"
                  >
                    <span className="text-[11px] text-gray-800 truncate">{meal.name}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">
                      {meal.protein}g · {meal.cal} kcal
                    </span>
                    <button
                      onClick={() => onRemoveUserMeal(meal.name)}
                      disabled={disabled}
                      aria-label={`Remove ${meal.name}`}
                      className="text-gray-300 hover:text-red-500 text-xs px-1 shrink-0 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Tier and rate these on the screen below, the same as any other meal.
              </p>
            </div>
          )}

          <button
            onClick={onExport}
            disabled={disabled || (drafts.length === 0 && userMeals.length === 0)}
            className="w-full bg-gray-100 text-gray-700 rounded-lg py-2 text-xs font-semibold hover:bg-gray-200 disabled:opacity-40"
          >
            📋 Copy for the database
          </button>

          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2.5 mt-3">
            Meals you add work straight away on this device and sync with everything else. “Copy for the
            database” hands the whole list over so they can be folded into the shipped meal database
            properly — with sourced nutrition figures instead of estimated portions.
          </p>
        </div>
      )}
    </div>
  );
};

export default AddMealPanel;
