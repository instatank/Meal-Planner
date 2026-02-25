import React, { useMemo, useState } from 'react';
import {
  ONBOARDING_GOAL_OPTIONS,
  ONBOARDING_ROLE_OPTIONS,
  buildOnboardingProfile,
  normalizeOnboardingProfile
} from './profileModel.js';

const STEP_KEYS = ['mode', 'goal', 'review'];

const OnboardingFlow = ({ initialProfile, mode = 'setup', onSubmit, onCancel }) => {
  const normalizedInitial = useMemo(() => normalizeOnboardingProfile(initialProfile || {}), [initialProfile]);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState({
    roleMode: normalizedInitial.roleMode,
    primaryGoal: normalizedInitial.primaryGoal
  });

  const isEditMode = mode === 'edit';
  const currentStep = STEP_KEYS[stepIndex] || STEP_KEYS[0];

  const selectedRole = ONBOARDING_ROLE_OPTIONS.find((option) => option.id === draft.roleMode) || ONBOARDING_ROLE_OPTIONS[0];
  const selectedGoal = ONBOARDING_GOAL_OPTIONS.find((option) => option.id === draft.primaryGoal) || ONBOARDING_GOAL_OPTIONS[0];

  const canMoveForward =
    currentStep === 'mode'
      ? Boolean(draft.roleMode)
      : currentStep === 'goal'
        ? Boolean(draft.primaryGoal)
        : true;

  const stepTitle = isEditMode ? 'Edit Preferences' : 'Set Up Meal Planner';
  const stepSubtitle = isEditMode
    ? 'Update your role and planning goal. Changes apply immediately.'
    : 'Choose your role and primary goal before entering the planner.';

  const handleConfirm = () => {
    const profile = buildOnboardingProfile({
      roleMode: draft.roleMode,
      primaryGoal: draft.primaryGoal
    });
    onSubmit?.(profile);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-md">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">{stepTitle}</h1>
          <p className="mt-1 text-sm text-gray-600">{stepSubtitle}</p>
        </div>

        <div className="mb-5 flex items-center gap-2">
          {STEP_KEYS.map((key, idx) => (
            <div key={key} className={`h-1.5 flex-1 rounded-full ${idx <= stepIndex ? 'bg-blue-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {currentStep === 'mode' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">Choose profile mode</p>
            {ONBOARDING_ROLE_OPTIONS.map((option) => {
              const selected = draft.roleMode === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setDraft((prev) => ({ ...prev, roleMode: option.id }))}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                  <div className="mt-0.5 text-xs text-gray-600">{option.description}</div>
                </button>
              );
            })}
          </div>
        )}

        {currentStep === 'goal' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">Choose your primary goal</p>
            {ONBOARDING_GOAL_OPTIONS.map((option) => {
              const selected = draft.primaryGoal === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setDraft((prev) => ({ ...prev, primaryGoal: option.id }))}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                  <div className="mt-0.5 text-xs text-gray-600">{option.description}</div>
                </button>
              );
            })}
          </div>
        )}

        {currentStep === 'review' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">Review your selections</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-gray-600">Profile mode</span>
                <span className="font-semibold text-gray-900">{selectedRole.label}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-gray-600">Primary goal</span>
                <span className="font-semibold text-gray-900">{selectedGoal.label}</span>
              </div>
            </div>
            {selectedRole.id === 'viewer' && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Viewer mode is read-only. Editing, swapping, confirming, undo, and regeneration will be disabled.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
          {stepIndex > 0 ? (
            <button
              onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          ) : (
            isEditMode && (
              <button
                onClick={onCancel}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            )
          )}

          {currentStep !== 'review' ? (
            <button
              onClick={() => canMoveForward && setStepIndex((prev) => Math.min(STEP_KEYS.length - 1, prev + 1))}
              disabled={!canMoveForward}
              className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <button onClick={handleConfirm} className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              {isEditMode ? 'Save Preferences' : 'Enter Planner'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;
