import React, { useMemo, useState } from 'react';

import {
  FREQUENCY_TIER,
  RATING_MAX,
  RATING_MIN,
  TIER_DEFINITIONS,
  TIER_ORDER,
  summarizeTierCoverage
} from '../lib/mealTiers';

/**
 * Rate and tier the meal database.
 *
 * The panel is built around one asymmetry: setting a tier is cheap and
 * reversible, but *retiring* a dish removes it from planning entirely, and
 * enough retirements make the rules unsatisfiable. So retirement is styled as
 * the destructive action it is, and the coverage bar is always visible rather
 * than tucked behind a warning that only appears once generation has already
 * started failing.
 *
 * The proposals at the top are the point of the whole screen. Hand-tiering 110
 * meals is work nobody does; accepting six suggestions drawn from what you
 * actually ate is work anybody does. The manual controls exist so you can
 * disagree.
 */

const TIER_STYLES = {
  [FREQUENCY_TIER.STAPLE]: 'bg-emerald-600 border-emerald-600 text-white',
  [FREQUENCY_TIER.REGULAR]: 'bg-blue-600 border-blue-600 text-white',
  [FREQUENCY_TIER.OCCASIONAL]: 'bg-gray-500 border-gray-500 text-white',
  [FREQUENCY_TIER.RARE]: 'bg-amber-500 border-amber-500 text-white',
  [FREQUENCY_TIER.RETIRED]: 'bg-red-600 border-red-600 text-white'
};

const DIRECTION_STYLES = {
  promote: 'border-emerald-200 bg-emerald-50',
  demote: 'border-amber-200 bg-amber-50',
  retire: 'border-red-200 bg-red-50'
};

const MealTieringPanel = ({
  meals = [],
  tierMap = {},
  proposals = { ready: false, reason: '', proposals: [] },
  dailyProteinTarget = 120,
  onSetTier,
  onSetRating,
  onAcceptProposal,
  onDismissProposal,
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');

  const mealNames = useMemo(() => meals.map((m) => m.name), [meals]);
  const coverage = useMemo(() => summarizeTierCoverage(tierMap, mealNames), [tierMap, mealNames]);

  // A week needs 21 slots filled from distinct dishes per day. If the tiers
  // permit fewer appearances than that, no legal week exists — worth saying
  // before the planner starts failing rather than after.
  const capacityShort = coverage.weeklyCapacity < 21;

  /**
   * A staple has to be able to carry its share of the day's protein.
   *
   * Measured: 18 of 75 lunch/dinner dishes never appear even when marked
   * staple, because they lose to the Tier-2 budgets — Rajma chawal is 21g
   * against a 120g daily target. The tier is not being ignored; it is being
   * outranked by a rule it cannot override. Saying so beats leaving someone to
   * conclude the feature is broken.
   */
  const proteinShareNeeded = Math.round((dailyProteinTarget / 3) * 0.75);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return meals
      .filter((meal) => {
        if (q && !meal.name.toLowerCase().includes(q)) return false;
        if (tierFilter === 'all') return true;
        if (tierFilter === 'rated') return Number.isFinite(tierMap[meal.name]?.rating);
        return (tierMap[meal.name]?.tier || FREQUENCY_TIER.OCCASIONAL) === tierFilter;
      })
      .slice(0, 60);
  }, [meals, query, tierFilter, tierMap]);

  const visibleProposals = proposals.proposals || [];

  return (
    <div className="bg-white rounded-lg shadow-md mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <h3 className="font-bold text-gray-800">🍽️ Meal tiers &amp; ratings</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {coverage.counts.staple} staple · {coverage.counts.retired} retired · {coverage.rated} rated
            {visibleProposals.length > 0 && (
              <span className="text-emerald-700 font-semibold"> · {visibleProposals.length} suggestion{visibleProposals.length === 1 ? '' : 's'}</span>
            )}
          </p>
        </div>
        <span className="text-gray-400 text-sm shrink-0 ml-3">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
          {capacityShort && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-800">Too much retired</p>
              <p className="text-[11px] text-red-700 mt-0.5">
                Your tiers allow {coverage.weeklyCapacity} meal slots a week, and a week needs 21.
                Un-retire something or the planner cannot build a legal week.
              </p>
            </div>
          )}

          {/* ── What your behaviour suggests ── */}
          <div className="mb-5">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
              Suggested from what you ate
            </h4>

            {!proposals.ready ? (
              <p className="text-[11px] text-gray-500 bg-gray-50 rounded p-2.5">
                {proposals.reason || 'Not enough history yet.'}
              </p>
            ) : visibleProposals.length === 0 ? (
              <p className="text-[11px] text-gray-500 bg-gray-50 rounded p-2.5">
                Nothing to suggest — your tiers match how you have been eating.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleProposals.slice(0, 6).map((proposal) => (
                  <div
                    key={proposal.mealName}
                    className={`rounded-lg border p-2.5 ${DIRECTION_STYLES[proposal.direction] || 'border-gray-200 bg-gray-50'}`}
                  >
                    <div className="text-sm font-semibold text-gray-800 truncate">{proposal.mealName}</div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      {TIER_DEFINITIONS[proposal.currentTier].label} → <strong>{TIER_DEFINITIONS[proposal.proposedTier].label}</strong>
                      {' · '}{proposal.why}
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        onClick={() => onAcceptProposal(proposal)}
                        disabled={disabled}
                        className="px-3 py-1 rounded-full bg-gray-800 text-white text-[11px] font-semibold hover:bg-gray-900 disabled:opacity-50"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => onDismissProposal(proposal)}
                        disabled={disabled}
                        className="px-3 py-1 rounded-full bg-white border border-gray-300 text-gray-600 text-[11px] font-semibold hover:bg-gray-100 disabled:opacity-50"
                      >
                        No thanks
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Manual controls ── */}
          <div className="mb-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search meals…"
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="rated">Rated</option>
              {TIER_ORDER.map((tier) => (
                <option key={tier} value={tier}>{TIER_DEFINITIONS[tier].label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {filtered.map((meal) => {
              const entry = tierMap[meal.name];
              const tier = entry?.tier || FREQUENCY_TIER.OCCASIONAL;
              const rating = entry?.rating;
              const thinForStaple = tier === FREQUENCY_TIER.STAPLE && Number(meal.protein || 0) < proteinShareNeeded;

              return (
                <div key={meal.name} className="rounded-lg border border-gray-150 bg-gray-50 p-2.5">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{meal.name}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{meal.protein}g · {meal.cal} kcal</span>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2">
                    {TIER_ORDER.map((option) => (
                      <button
                        key={option}
                        onClick={() => onSetTier(meal.name, option)}
                        disabled={disabled}
                        title={TIER_DEFINITIONS[option].hint}
                        className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition-colors disabled:opacity-50 ${
                          tier === option
                            ? TIER_STYLES[option]
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                      >
                        {TIER_DEFINITIONS[option].label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 mt-2">
                    <span className="text-[10px] text-gray-400 mr-1">Rate</span>
                    {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i).map((value) => (
                      <button
                        key={value}
                        onClick={() => onSetRating(meal.name, rating === value ? null : value)}
                        disabled={disabled}
                        aria-label={`Rate ${meal.name} ${value} of ${RATING_MAX}`}
                        className={`w-6 h-6 rounded text-[10px] font-bold border transition-colors disabled:opacity-50 ${
                          rating === value
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                    {Number.isFinite(rating) && (
                      <span className="text-[10px] text-gray-400 ml-1">tap again to clear</span>
                    )}
                  </div>

                  {thinForStaple && (
                    <p className="text-[10px] text-amber-700 mt-1.5">
                      Only {meal.protein}g protein — a staple needs roughly {proteinShareNeeded}g to earn a slot
                      against your {dailyProteinTarget}g target, so this may still be planned rarely.
                    </p>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-[11px] text-gray-500 py-4 text-center">No meals match.</p>
            )}
          </div>

          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2.5 mt-3">
            Tiers change how often a dish may appear; ratings change how much it is preferred. Neither can
            override the protein floor or any other hard rule — a dish that keeps missing your macro targets
            will still be planned rarely however you tier it.
          </p>
        </div>
      )}
    </div>
  );
};

export default MealTieringPanel;
