import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EFFORT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  buildAnthropicRequest
} from '../api/generate-plan.js';

const base = { system: 'You are a meal planner.', userMessage: '{"targetDateKeys":[]}' };

test('the proxy targets Sonnet 5', () => {
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5');
  assert.equal(buildAnthropicRequest(base).model, 'claude-sonnet-5');
});

test('no sampling parameter reaches Anthropic — Sonnet 5 rejects them with a 400', () => {
  const body = buildAnthropicRequest(base);
  for (const param of ['temperature', 'top_p', 'top_k']) {
    assert.equal(param in body, false, `${param} must not be sent`);
  }
});

test('a stale client still sending temperature does not break the endpoint', () => {
  // The old bundle sent `temperature: 0.7` on every call. A cached copy of it
  // must degrade to a working request, not a 400.
  const body = buildAnthropicRequest({ ...base, temperature: 0.7, top_p: 0.9, top_k: 40 });
  assert.equal('temperature' in body, false);
  assert.equal('top_p' in body, false);
  assert.equal('top_k' in body, false);
});

test('effort replaces temperature as the quality/cost dial', () => {
  assert.equal(DEFAULT_EFFORT, 'low');
  assert.deepEqual(buildAnthropicRequest(base).output_config, { effort: 'low' });
  assert.deepEqual(buildAnthropicRequest({ ...base, effort: 'high' }).output_config, { effort: 'high' });
});

test('max_tokens leaves room for thinking, which now shares the budget', () => {
  // Thinking is on by default on Sonnet 5 and counts against max_tokens, so a
  // budget sized for the response alone would truncate mid-answer.
  assert.ok(DEFAULT_MAX_TOKENS >= 8192, `max_tokens is only ${DEFAULT_MAX_TOKENS}`);
  assert.equal(buildAnthropicRequest(base).max_tokens, DEFAULT_MAX_TOKENS);
  assert.equal(buildAnthropicRequest({ ...base, maxTokens: 2048 }).max_tokens, 2048);
});

test('the system block keeps its ephemeral cache breakpoint', () => {
  const body = buildAnthropicRequest(base);
  assert.deepEqual(body.system, [
    { type: 'text', text: base.system, cache_control: { type: 'ephemeral' } }
  ]);
  assert.deepEqual(body.messages, [{ role: 'user', content: base.userMessage }]);
});

test('a supplied tool is forced via tool_choice', () => {
  const tool = { name: 'submit_weekly_plan', input_schema: { type: 'object', properties: {} } };
  const body = buildAnthropicRequest({ ...base, tool });

  assert.deepEqual(body.tools, [tool]);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_weekly_plan' });
});

test('a malformed tool is ignored rather than sent', () => {
  for (const tool of [null, {}, { name: 'x' }, { input_schema: {} }, 'nope']) {
    const body = buildAnthropicRequest({ ...base, tool });
    assert.equal('tools' in body, false);
    assert.equal('tool_choice' in body, false);
  }
});
