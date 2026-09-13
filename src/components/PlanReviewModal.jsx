import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import {
  PLAN_REVIEW_REASONS,
  PLAN_VERDICT,
  RATING_MAX,
  RATING_MIN
} from '../lib/feedbackSchema';

/**
 * The week review sheet: one verdict, one rating, structured reasons, free text.
 *
 * The ordering here is a deliberate bet about what people actually do. The
 * rating is first and is the only thing that is ever pre-filled, because it is
 * the one field someone will always answer; reasons are chips rather than a
 * text box because a chip is one tap and a sentence is a decision to type; and
 * the note sits last and is never required, because making it required is how
 * you get "ok" typed a hundred times.
 *
 * The reason chips shown are filtered by verdict. Offering "good variety" on a
 * rejection is noise, and — worse — a stray tap on it would file a positive
 * signal inside a negative verdict, which nothing downstream could
 * disentangle.
 */
const PlanReviewModal = ({ weekStartKey, dateKeys = [], dishes = [], onSubmit, onClose }) => {
  const [verdict, setVerdict] = useState(PLAN_VERDICT.ACCEPTED);
  const [rating, setRating] = useState(4);
  const [reasonIds, setReasonIds] = useState([]);
  const [dislikedDishes, setDislikedDishes] = useState([]);
  const [note, setNote] = useState('');

  const isRejection = verdict === PLAN_VERDICT.REJECTED;

  const visibleReasons = useMemo(
    () => PLAN_REVIEW_REASONS.filter((reason) =>
      isRejection ? reason.polarity !== 'positive' : reason.polarity !== 'negative'
    ),
    [isRejection]
  );

  const dishPickerOpen = reasonIds.includes('disliked_dishes');

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const selectVerdict = (nextVerdict) => {
    setVerdict(nextVerdict);
    // Reasons are verdict-specific, so carrying them across a switch would
    // silently keep a chip the user can no longer see.
    setReasonIds([]);
    setDislikedDishes([]);
    setRating(nextVerdict === PLAN_VERDICT.REJECTED ? 2 : 4);
  };

  const submit = () => {
    onSubmit({
      weekStartKey,
      dateKeys,
      verdict,
      rating,
      reasonIds,
      note,
      dishes,
      dislikedDishes: dishPickerOpen ? dislikedDishes : []
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Review this week</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Week of {weekStartKey} · {dishes.length} dishes
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 bg-gray-100 p-1 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-2 mb-5">
          <button
            onClick={() => selectVerdict(PLAN_VERDICT.ACCEPTED)}
            className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
              !isRejection ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            ✓ Accept week
          </button>
          <button
            onClick={() => selectVerdict(PLAN_VERDICT.REJECTED)}
            className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
              isRejection ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            🚫 Reject week
          </button>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            How good was it?
          </label>
          <div className="flex gap-1.5">
            {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i).map((value) => (
              <button
                key={value}
                onClick={() => setRating(value)}
                aria-label={`Rate ${value} out of ${RATING_MAX}`}
                className={`flex-1 py-2.5 rounded-lg font-bold text-sm border-2 transition-colors ${
                  rating === value
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            3 is neutral — it moves nothing. Above and below is what teaches the planner.
          </p>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            {isRejection ? 'What was wrong?' : 'What worked?'}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {visibleReasons.map((reason) => (
              <button
                key={reason.id}
                onClick={() => toggle(reasonIds, setReasonIds, reason.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  reasonIds.includes(reason.id)
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'
                }`}
              >
                {reason.label}
              </button>
            ))}
          </div>
        </div>

        {dishPickerOpen && dishes.length > 0 && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Which dishes?
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {dishes.map((dish) => (
                <button
                  key={dish.name}
                  onClick={() => toggle(dislikedDishes, setDislikedDishes, dish.name)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors text-left ${
                    dislikedDishes.includes(dish.name)
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'
                  }`}
                >
                  {dish.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Anything else? <span className="normal-case font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="In your own words — this is kept verbatim."
            className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-400 resize-none"
          />
        </div>

        <button
          onClick={submit}
          className={`w-full py-3 rounded-lg font-semibold text-white transition-colors ${
            isRejection ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          Save review
        </button>
      </div>
    </div>
  );
};

export default PlanReviewModal;
