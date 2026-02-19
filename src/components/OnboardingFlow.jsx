import React, { useMemo, useState } from 'react';
import {
  ONBOARDING_GOAL_OPTIONS,
  ONBOARDING_MODE_OPTIONS,
  getDefaultOnboardingDraft,
  getOnboardingGoalLabel,
  getOnboardingModeLabel
} from '../lib/onboardingProfile';

const STEP_KEYS = ['mode', 'goal', 'review'];

const stepTitleByKey = {
  mode: 'Choose your access mode',
  goal: 'Choose your primary goal',
  review: 'Review before entering planner'
};

const getSafeInitialDraft = (initialDraft) => {
  const defaults = getDefaultOnboardingDraft();
  if (!initialDraft || typeof initialDraft !== 'object') return defaults;
  return {
    mode: initialDraft.mode || defaults.mode,
    goal: initialDraft.goal || defaults.goal
  };
};

const OnboardingFlow = ({ initialDraft, isEditing = false, onComplete, onCancel }) => {
  const safeInitial = useMemo(() => getSafeInitialDraft(initialDraft), [initialDraft]);
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState(safeInitial.mode);
  const [goal, setGoal] = useState(safeInitial.goal);

  const stepKey = STEP_KEYS[stepIndex];
  const canProceed = Boolean(mode && goal);

  const next = () => {
    if (!canProceed) return;
    setStepIndex((prev) => Math.min(prev + 1, STEP_KEYS.length - 1));
  };

  const back = () => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Meal Planner Setup</h1>
              <p className="text-sm text-gray-600 mt-1">
                {isEditing ? 'Update your profile mode and planning goal.' : 'Set your profile before entering the planner.'}
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold">Step {stepIndex + 1}/3</span>
          </div>

          <div className="mb-4">
            <div className="text-sm font-semibold text-gray-800">{stepTitleByKey[stepKey]}</div>
            <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-2 bg-blue-500 transition-all" style={{ width: `${((stepIndex + 1) / STEP_KEYS.length) * 100}%` }} />
            </div>
          </div>

          {stepKey === 'mode' && (
            <div className="space-y-3">
              {ONBOARDING_MODE_OPTIONS.map((option) => {
                const selected = mode === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setMode(option.value)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">{option.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{option.subtitle}</div>
                  </button>
                );
              })}
            </div>
          )}

          {stepKey === 'goal' && (
            <div className="space-y-3">
              {ONBOARDING_GOAL_OPTIONS.map((option) => {
                const selected = goal === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setGoal(option.value)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">{option.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{option.subtitle}</div>
                  </button>
                );
              })}
            </div>
          )}

          {stepKey === 'review' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Profile mode</div>
                <div className="text-lg font-semibold text-gray-800 mt-1">{getOnboardingModeLabel(mode)}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Primary goal</div>
                <div className="text-lg font-semibold text-gray-800 mt-1">{getOnboardingGoalLabel(goal)}</div>
              </div>
              {mode === 'viewer' && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Viewer mode is read-only. Planner actions such as edit, swap, confirm, undo, and regenerate are disabled.
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-6">
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button onClick={back} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  Back
                </button>
              )}
              {isEditing && typeof onCancel === 'function' && (
                <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>

            {stepIndex < STEP_KEYS.length - 1 ? (
              <button
                onClick={next}
                disabled={!canProceed}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => onComplete?.({ mode, goal })}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
              >
                {isEditing ? 'Save Changes' : 'Save & Continue'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;

