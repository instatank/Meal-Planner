import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlanReviewPayload,
  collectPlanReviews,
  collectWeekDishes,
  summarizePlanReviews,
  toLegacyRejectionRecord
} from '../src/lib/planReview.js';
import { PLAN_VERDICT, validateEvent } from '../src/lib/feedbackSchema.js';
import { createMealEvent } from '../src/lib/mealEvents.js';

const day = (b, l, d) => ({ breakfast: { name: b }, lunch: { name: l }, dinner: { name: d } });

const WEEK = {
  '2026-09-07': day('Eggs + toast', 'Rajma chawal', 'Grilled fish'),
  '2026-09-08': day('Eggs + toast', 'Chole', 'Chicken curry')
};

test('a built review payload is a schema-valid plan_review event', () => {
  // The producer scan in feedbackCapture.producers.test.js cannot see this
  // one: App.jsx passes a variable to appendMealEvent rather than an object
  // literal. So it is checked here instead, against the same schema.
  const payload = buildPlanReviewPayload({
    weekStartKey: '2026-09-07',
    dateKeys: ['2026-09-08', '2026-09-07'],
    verdict: PLAN_VERDICT.ACCEPTED,
    rating: 4,
    reasonIds: ['good_variety'],
    note: 'solid week',
    dishes: collectWeekDishes(WEEK, Object.keys(WEEK))
  });

  const result = validateEvent(createMealEvent(payload));
  assert.ok(result.valid, result.issues.join('; '));
  assert.deepEqual(payload.dateKeys, ['2026-09-07', '2026-09-08'], 'date keys should be sorted');
});

test('collectWeekDishes lists each distinct dish once, in date and slot order', () => {
  const dishes = collectWeekDishes(WEEK, Object.keys(WEEK));
  assert.deepEqual(
    dishes.map((d) => d.name),
    ['Eggs + toast', 'Rajma chawal', 'Grilled fish', 'Chole', 'Chicken curry']
  );
  // "Eggs + toast" appears on both days but is one dish to review.
  assert.equal(dishes.filter((d) => d.name === 'Eggs + toast').length, 1);
});

test('ratings are clamped and rounded; a non-numeric rating becomes null', () => {
  assert.equal(buildPlanReviewPayload({ rating: 9 }).rating, 5);
  assert.equal(buildPlanReviewPayload({ rating: 0 }).rating, 1);
  assert.equal(buildPlanReviewPayload({ rating: 3.4 }).rating, 3);
  assert.equal(buildPlanReviewPayload({ rating: 'good' }).rating, null);
});

test('an unrecognised reason id is dropped rather than stored', () => {
  const payload = buildPlanReviewPayload({ reasonIds: ['too_many_carbs', 'vibes'] });
  assert.deepEqual(payload.reasonIds, ['too_many_carbs']);
});

test('an unknown verdict falls back to rejected, not accepted', () => {
  // Failing closed matters: a corrupted verdict silently counted as an accept
  // would teach the planner that a week the user hated was good.
  assert.equal(buildPlanReviewPayload({ verdict: 'maybe' }).verdict, PLAN_VERDICT.REJECTED);
});

test('reviews are read back from the event log, newest last, undone ones dropped', () => {
  const events = [
    createMealEvent({ id: 'r1', type: 'plan_review', timestamp: '2026-09-01T00:00:00Z', ...buildPlanReviewPayload({ weekStartKey: '2026-08-31', verdict: PLAN_VERDICT.ACCEPTED, rating: 5 }) }),
    createMealEvent({ id: 'r2', type: 'plan_review', timestamp: '2026-09-08T00:00:00Z', ...buildPlanReviewPayload({ weekStartKey: '2026-09-07', verdict: PLAN_VERDICT.REJECTED, rating: 2 }) }),
    createMealEvent({ id: 'u1', type: 'undo', timestamp: '2026-09-09T00:00:00Z', dateKey: '2026-09-07', undoTargets: ['r2'] })
  ];

  const reviews = collectPlanReviews(events);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].id, 'r1');
});

test('legacy rejected-plans entries are folded in without inventing a rating', () => {
  const legacy = [{ timestamp: '2026-08-01T00:00:00Z', plan: WEEK, reason: 'too repetitive' }];
  const reviews = collectPlanReviews([], legacy);

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].verdict, PLAN_VERDICT.REJECTED);
  assert.equal(reviews[0].note, 'too repetitive');
  assert.equal(reviews[0].legacy, true);
  // A fabricated rating would poison the average the dashboard shows.
  assert.equal(reviews[0].rating, null);
  assert.equal(reviews[0].dishes.length, 5);
});

test('the summary counts verdicts over everything but averages only rated weeks', () => {
  const reviews = [
    { verdict: PLAN_VERDICT.ACCEPTED, rating: 4, reasonIds: ['good_variety'], note: '', timestamp: '1' },
    { verdict: PLAN_VERDICT.REJECTED, rating: 2, reasonIds: ['too_many_carbs', 'good_variety'], note: 'meh', timestamp: '2' },
    { verdict: PLAN_VERDICT.REJECTED, rating: null, reasonIds: [], note: 'old one', timestamp: '3' }
  ];

  const summary = summarizePlanReviews(reviews);
  assert.equal(summary.total, 3);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.rejected, 2);
  assert.equal(summary.acceptanceRate, 0.333);
  assert.equal(summary.ratedCount, 2);
  assert.equal(summary.averageRating, 3);
  assert.equal(summary.topReasons[0].id, 'good_variety');
  assert.equal(summary.topReasons[0].count, 2);
  assert.equal(summary.notes.length, 2);
  assert.equal(summary.notes[0].note, 'old one', 'notes come back newest first');
});

test('a rating trend needs enough rated weeks to mean anything', () => {
  const rated = (rating, i) => ({ verdict: PLAN_VERDICT.ACCEPTED, rating, reasonIds: [], note: '', timestamp: String(i) });

  assert.equal(summarizePlanReviews([1, 2, 3].map(rated)).ratingTrend, null, 'three weeks is noise');
  // Four rated but none before the trailing five: still nothing to compare to.
  assert.equal(summarizePlanReviews([1, 2, 3, 4].map(rated)).ratingTrend, null);

  const improving = [1, 1, 2, 4, 4, 4, 4].map(rated);
  const trend = summarizePlanReviews(improving).ratingTrend;
  assert.ok(trend > 0, `expected an upward trend, got ${trend}`);
});

test('the legacy record keeps the shape scorePlan.mjs already reads', () => {
  const review = buildPlanReviewPayload({
    weekStartKey: '2026-09-07',
    verdict: PLAN_VERDICT.REJECTED,
    rating: 2,
    reasonIds: ['too_many_carbs', 'too_repetitive'],
    note: 'same rice twice'
  });

  const record = toLegacyRejectionRecord({ plan: WEEK, review });
  assert.ok(record.timestamp);
  assert.deepEqual(record.plan, WEEK);
  assert.equal(typeof record.reason, 'string');
  assert.ok(record.reason.includes('Too many carbs'));
  assert.ok(record.reason.includes('same rice twice'));
});
