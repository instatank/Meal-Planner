import React, { useMemo, useState } from 'react';

import {
  describeAttributeKey,
  describeReadiness,
  getMostRejectedDishes,
  summarizeAdherence
} from '../lib/feedbackAnalytics';
import {
  getAppliedSignals,
  getUnderexploredAttributes
} from '../lib/preferenceLearning';
import { collectPlanReviews, summarizePlanReviews } from '../lib/planReview';

/**
 * What the system has learned, and what it has not.
 *
 * This exists because the founder works entirely in a browser: a learning
 * system whose state is only inspectable by running a script with admin
 * credentials is, for this user, a system with no readout at all. That was the
 * previous situation, and it is why rejection data sat unread for months.
 *
 * Two editorial rules shape what is shown:
 *
 * 1. **Every number comes with its evidence.** A preference the system has
 *    seen three times and one it has seen thirty are not the same claim, and
 *    a bare bar chart makes them look identical.
 * 2. **What it does not know is shown too.** The "not steering yet" and
 *    "barely seen" sections are not filler — exposure bias means the planner
 *    stops serving what it thinks you dislike, so the gaps are where the
 *    model is most likely to be wrong, and hiding them would make a confident
 *    display of a thin model.
 */

const Bar = ({ value, tone }) => (
  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
    <div
      className={`h-full rounded-full ${tone}`}
      style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
    />
  </div>
);

const Stat = ({ label, value, sub }) => (
  <div className="bg-gray-50 rounded-lg p-3">
    <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
    <p className="text-xl font-bold text-gray-800 leading-tight mt-0.5">{value}</p>
    {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
  </div>
);

const Section = ({ title, hint, children }) => (
  <div className="mb-5">
    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">{title}</h4>
    {hint && <p className="text-[11px] text-gray-500 mb-2 mt-0.5">{hint}</p>}
    <div className={hint ? '' : 'mt-2'}>{children}</div>
  </div>
);

const pct = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const InsightsPanel = ({ events = [], learned = {}, mealDatabase = {}, legacyRejections = [] }) => {
  const [open, setOpen] = useState(false);

  const reviews = useMemo(() => collectPlanReviews(events, legacyRejections), [events, legacyRejections]);
  const reviewSummary = useMemo(() => summarizePlanReviews(reviews), [reviews]);
  const adherence = useMemo(() => summarizeAdherence(events), [events]);
  const rejected = useMemo(() => getMostRejectedDishes(events), [events]);
  const signals = useMemo(() => getAppliedSignals(learned, { limit: 8 }), [learned]);
  const gaps = useMemo(
    () => getUnderexploredAttributes({ learned, mealDatabase, limit: 12 }),
    [learned, mealDatabase]
  );
  const readiness = useMemo(() => describeReadiness(learned, reviewSummary), [learned, reviewSummary]);

  // Buckets with evidence that has not yet crossed the floor. Shown on
  // purpose: "forming an opinion" and "has no opinion" look identical
  // otherwise, and only one of them is about to change your plans.
  const forming = useMemo(
    () =>
      Object.entries(learned.attributes || {})
        .filter(([, b]) => !b.applied && b.exposure > 0)
        .sort((a, b) => b[1].evidence - a[1].evidence)
        .slice(0, 4),
    [learned]
  );

  // An attribute listed as "forming an opinion" would otherwise also appear
  // under "barely tried" — the same fact stated twice, in two different
  // framings, which reads as a contradiction rather than as detail.
  const unseenGaps = useMemo(() => {
    const claimed = new Set(forming.map(([key]) => key));
    return gaps.filter((gap) => !claimed.has(gap.key)).slice(0, 5);
  }, [gaps, forming]);

  const toneFor = (score) => (score > 0 ? 'bg-emerald-500' : 'bg-red-500');

  return (
    <div className="bg-white rounded-lg shadow-md mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">📊 What the planner has learned</h3>
          <p className="text-xs text-gray-500 mt-0.5">{readiness.headline} · {readiness.detail}</p>
        </div>
        <span className="text-gray-400 text-sm shrink-0 ml-3">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
          <Section
            title="What you actually did"
            hint="One meal counts once, however many times you adjusted it before eating."
          >
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Stat
                label="Ate as planned"
                value={pct(adherence.overall.adherenceRate)}
                sub={`${adherence.overall.followed} of ${plural(adherence.overall.total, 'meal')}`}
              />
              <Stat
                label="Ate something else"
                value={pct(adherence.overall.overrideRate)}
                sub={plural(adherence.overall.overridden, 'meal')}
              />
              <Stat
                label="Skipped"
                value={pct(adherence.overall.skipRate)}
                sub={plural(adherence.overall.skipped, 'meal')}
              />
            </div>
            {adherence.overall.total > 0 && (
              <p className="text-[11px] text-gray-500">
                {adherence.overall.adjustedFirst > 0 && (
                  <>
                    {pct(adherence.overall.adjustedFirstRate)} needed a swap first
                    {' · '}
                  </>
                )}
                {adherence.proteinDelivered}g protein delivered
                {adherence.proteinLostToSkips > 0 && `, ${adherence.proteinLostToSkips}g lost to skips`}
              </p>
            )}
          </Section>

          <Section title="What you said" hint="Your own verdicts on whole weeks.">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Stat
                label="Weeks reviewed"
                value={reviewSummary.total}
                sub={`${reviewSummary.accepted} accepted`}
              />
              <Stat
                label="Average rating"
                value={reviewSummary.averageRating ?? '—'}
                sub={reviewSummary.ratedCount ? `${reviewSummary.ratedCount} rated` : 'none rated yet'}
              />
              <Stat
                label="Trend"
                value={
                  reviewSummary.ratingTrend === null
                    ? '—'
                    : `${reviewSummary.ratingTrend > 0 ? '+' : ''}${reviewSummary.ratingTrend}`
                }
                sub={reviewSummary.ratingTrend === null ? 'needs more weeks' : 'vs earlier weeks'}
              />
            </div>

            {reviewSummary.topReasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {reviewSummary.topReasons.slice(0, 6).map((reason) => (
                  <span
                    key={reason.id}
                    className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                      reason.polarity === 'positive'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {reason.label} · {reason.count}
                  </span>
                ))}
              </div>
            )}

            {reviewSummary.notes.length > 0 && (
              <div className="space-y-1.5">
                {reviewSummary.notes.slice(0, 3).map((note) => (
                  <p key={`${note.timestamp}`} className="text-[11px] text-gray-600 bg-gray-50 rounded p-2 border-l-2 border-gray-300">
                    <span className="text-gray-400">{String(note.timestamp).slice(0, 10)}</span>
                    {note.rating ? <span className="text-gray-400"> · {note.rating}/5</span> : null}
                    {' — '}
                    “{note.note}”
                  </p>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="What is steering your plans"
            hint="Patterns with enough evidence to act on. A wide pattern covering most of the catalog is damped, because it cannot tell two plans apart."
          >
            {signals.length === 0 ? (
              <p className="text-[11px] text-gray-500 bg-gray-50 rounded p-2.5">
                Nothing yet. Until a pattern crosses the evidence floor, plans are generated exactly as they were before any of this existed.
              </p>
            ) : (
              <div className="space-y-2">
                {signals.map((signal) => (
                  <div key={signal.key}>
                    <div className="flex justify-between items-baseline text-[11px] mb-0.5">
                      <span className="font-medium text-gray-700">
                        {signal.score > 0 ? '▲' : '▼'} {describeAttributeKey(signal.key)}
                      </span>
                      <span className="text-gray-400 shrink-0 ml-2">
                        seen {signal.exposure}× · {Math.round((signal.coverage || 0) * 100)}% of catalog
                      </span>
                    </div>
                    <Bar value={Math.abs(signal.effect) * 3} tone={toneFor(signal.score)} />
                  </div>
                ))}
              </div>
            )}
          </Section>

          {forming.length > 0 && (
            <Section
              title="Not steering yet"
              hint="Seen, but not enough times to act on. Shown so you can tell “forming an opinion” from “has no opinion”."
            >
              <div className="flex flex-wrap gap-1.5">
                {forming.map(([key, bucket]) => (
                  <span key={key} className="px-2 py-1 rounded-full text-[11px] bg-amber-50 text-amber-800">
                    {bucket.score > 0 ? '▲' : '▼'} {describeAttributeKey(key)} · {bucket.exposure}×
                  </span>
                ))}
              </div>
            </Section>
          )}

          {rejected.length > 0 && (
            <Section title="Dishes you keep turning down" hint="Ranked by how often, not by rate — two rejections out of two is thin evidence.">
              <div className="space-y-1">
                {rejected.slice(0, 5).map((dish) => (
                  <div key={dish.name} className="flex justify-between items-baseline text-[11px]">
                    <span className="text-gray-700 truncate pr-2">{dish.name}</span>
                    <span className="text-gray-400 shrink-0">
                      {dish.rejected} of {dish.seen}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {unseenGaps.length > 0 && (
            <Section
              title="Barely tried"
              hint="The planner shows what it already thinks you like, so these never got a fair test. This is the known blind spot, not a bug."
            >
              <div className="flex flex-wrap gap-1.5">
                {unseenGaps.map((gap) => (
                  <span key={gap.key} className="px-2 py-1 rounded-full text-[11px] bg-gray-100 text-gray-600">
                    {describeAttributeKey(gap.key)} · seen {gap.exposure}×, {gap.mealCount} meals
                  </span>
                ))}
              </div>
            </Section>
          )}

          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2.5">
            Learned preference only ever re-ranks plans that are already legal. It cannot override the protein floor,
            the repeat caps or any other hard rule, however confident it becomes.
          </p>
        </div>
      )}
    </div>
  );
};

export default InsightsPanel;
