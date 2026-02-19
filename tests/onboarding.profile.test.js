import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ONBOARDING_GOAL,
  ONBOARDING_MODE,
  ONBOARDING_PROFILE_VERSION,
  buildOnboardingProfile,
  getDefaultOnboardingDraft,
  normalizeOnboardingProfile
} from '../src/lib/onboardingProfile.js';

test('default onboarding draft is deterministic', () => {
  assert.deepEqual(getDefaultOnboardingDraft(), {
    mode: ONBOARDING_MODE.OWNER,
    goal: ONBOARDING_GOAL.HIGH_PROTEIN
  });
});

test('normalizeOnboardingProfile rejects invalid payloads', () => {
  assert.equal(normalizeOnboardingProfile(null), null);
  assert.equal(normalizeOnboardingProfile({}), null);
  assert.equal(
    normalizeOnboardingProfile({
      version: ONBOARDING_PROFILE_VERSION,
      mode: 'invalid',
      goal: ONBOARDING_GOAL.HIGH_PROTEIN,
      completedAt: '2026-02-18T00:00:00.000Z',
      updatedAt: '2026-02-18T00:00:00.000Z'
    }),
    null
  );
});

test('buildOnboardingProfile creates versioned profile and preserves completedAt', () => {
  const first = buildOnboardingProfile({
    mode: ONBOARDING_MODE.OWNER,
    goal: ONBOARDING_GOAL.LOW_CARB,
    now: '2026-02-18T08:00:00.000Z'
  });

  assert.deepEqual(first, {
    version: ONBOARDING_PROFILE_VERSION,
    mode: ONBOARDING_MODE.OWNER,
    goal: ONBOARDING_GOAL.LOW_CARB,
    completedAt: '2026-02-18T08:00:00.000Z',
    updatedAt: '2026-02-18T08:00:00.000Z'
  });

  const updated = buildOnboardingProfile({
    mode: ONBOARDING_MODE.VIEWER,
    goal: ONBOARDING_GOAL.TWO_MEALS_DAY,
    previousProfile: first,
    now: '2026-02-19T09:30:00.000Z'
  });

  assert.deepEqual(updated, {
    version: ONBOARDING_PROFILE_VERSION,
    mode: ONBOARDING_MODE.VIEWER,
    goal: ONBOARDING_GOAL.TWO_MEALS_DAY,
    completedAt: '2026-02-18T08:00:00.000Z',
    updatedAt: '2026-02-19T09:30:00.000Z'
  });
});

