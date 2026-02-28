import React, { useMemo, useState } from 'react';
import {
  ONBOARDING_GOAL_OPTIONS,
  ONBOARDING_MODE,
  getDefaultOnboardingDraft,
} from '../lib/onboardingProfile';

const getSafeInitialDraft = (initialDraft) => {
  const defaults = getDefaultOnboardingDraft();
  if (!initialDraft || typeof initialDraft !== 'object') return defaults;
  return {
    mode: ONBOARDING_MODE.OWNER,
    goal: initialDraft.goal || defaults.goal
  };
};

const OnboardingFlow = ({ initialDraft, isEditing = false, onComplete, onCancel }) => {
  const safeInitial = useMemo(() => getSafeInitialDraft(initialDraft), [initialDraft]);
  const [goal, setGoal] = useState(safeInitial.goal);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Meal Planner Setup</h1>
              <p className="text-sm text-gray-600 mt-1">
                {isEditing ? 'Update your planning goal.' : 'Choose your primary planning goal.'}
              </p>
            </div>
            <div className="mt-3 text-xs px-2 py-1 rounded-full inline-flex bg-blue-100 text-blue-700 font-semibold">
              Owner mode is enabled by default
            </div>
          </div>

          <div className="space-y-3">
            {ONBOARDING_GOAL_OPTIONS.map((option) => {
              const selected = goal === option.value;
              const disabled = option.disabled;

              let buttonStyle = 'border-gray-200 hover:border-blue-300';
              if (selected) buttonStyle = 'border-blue-500 bg-blue-50';
              if (disabled) buttonStyle = 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed';

              return (
                <button
                  key={option.value}
                  onClick={() => !disabled && setGoal(option.value)}
                  disabled={disabled}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${buttonStyle}`}
                >
                  <div className="font-semibold text-gray-800">{option.title}</div>
                  <div className="text-sm text-gray-600 mt-1">{option.subtitle}</div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 mt-6">
            {isEditing && typeof onCancel === 'function' ? (
              <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={() => onComplete?.({ mode: ONBOARDING_MODE.OWNER, goal })}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              {isEditing ? 'Save Changes' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;
