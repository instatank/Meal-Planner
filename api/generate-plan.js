// Vercel serverless proxy to the Anthropic Messages API.
// Hides ANTHROPIC_API_KEY on the server so the frontend never sees it.
//
// The client sends `{ system, userMessage, tool?, model?, maxTokens?, effort? }`.
// The proxy forwards to https://api.anthropic.com/v1/messages with prompt
// caching enabled on the system block, and returns `{ text, toolInput, usage,
// stopReason }`.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Sonnet 5. Near-Opus quality on structured selection at Sonnet cost, which is
// what this workload is: pick the best combination out of a constrained enum.
const DEFAULT_MODEL = 'claude-sonnet-5';

// Thinking and the response share one budget, so this has to cover both. The
// tool schema keeps the response itself tiny (three enum picks per day); the
// headroom is for the daily-total arithmetic the prompt now asks for.
const DEFAULT_MAX_TOKENS = 8192;

// Adaptive thinking is on by default on Sonnet 5. `low` effort keeps it — the
// model still checks its arithmetic — while staying inside the Vercel Hobby
// 10s function cap, which is the binding operational constraint here.
// Turning thinking off entirely is the wrong lever: it makes the model less
// tool-eager and saves less than dropping effort does.
const DEFAULT_EFFORT = 'low';

// Sonnet 5 rejects non-default sampling parameters with a 400. Stripped here
// rather than merely omitted, so a stale cached client bundle still sending
// `temperature: 0.7` degrades to a working request instead of breaking the
// endpoint outright.
const REJECTED_SAMPLING_PARAMS = ['temperature', 'top_p', 'top_k', 'topP', 'topK'];

const parseBody = (body) => {
  if (body == null) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
  }
  return body;
};

/**
 * Build the Anthropic request body. Exported so the parameter rules can be
 * tested without a network call or an API key.
 */
export const buildAnthropicRequest = ({
  system,
  userMessage,
  tool = null,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  effort = DEFAULT_EFFORT
} = {}) => {
  const requestBody = {
    model,
    max_tokens: maxTokens,
    output_config: { effort },
    // Ephemeral cache on the system prompt — identical system across calls
    // (same goal/prefs) gets a 90% input-token discount on hits. Note Sonnet 5
    // will not cache a prefix under 1024 tokens; short prompts silently miss.
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
    ],
    messages: [{ role: 'user', content: userMessage }]
  };

  // Optional: force Claude to respond via a tool call against a fixed schema.
  // This is Anthropic's structured-output mechanism — Claude cannot return
  // free-form text if tool_choice is set to a specific tool. Output arrives
  // as a tool_use content block whose `input` matches the tool's schema.
  if (tool && typeof tool === 'object' && tool.name && tool.input_schema) {
    requestBody.tools = [tool];
    requestBody.tool_choice = { type: 'tool', name: tool.name };
  }

  for (const param of REJECTED_SAMPLING_PARAMS) delete requestBody[param];
  return requestBody;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const { system, userMessage, tool, model, maxTokens, effort } = parseBody(req.body);

  if (typeof system !== 'string' || !system.trim()) {
    res.status(400).json({ error: 'Missing required field: `system` (string).' });
    return;
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    res.status(400).json({ error: 'Missing required field: `userMessage` (string).' });
    return;
  }

  const requestBody = buildAnthropicRequest({ system, userMessage, tool, model, maxTokens, effort });

  try {
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const raw = await anthropicRes.text();
    if (!anthropicRes.ok) {
      console.error('[api/generate-plan] Anthropic rejected request', {
        status: anthropicRes.status,
        model: requestBody.model,
        body: raw.slice(0, 2000)
      });
      res.status(anthropicRes.status).json({
        error: 'Anthropic API error',
        status: anthropicRes.status,
        model: requestBody.model,
        body: raw.slice(0, 2000)
      });
      return;
    }

    const data = JSON.parse(raw);
    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const toolUseBlock = contentBlocks.find((b) => b?.type === 'tool_use');
    const textBlock = contentBlocks.find((b) => b?.type === 'text');

    res.status(200).json({
      text: textBlock?.text || '',
      toolInput: toolUseBlock?.input ?? null,
      toolName: toolUseBlock?.name || null,
      stopReason: data?.stop_reason || null,
      stopDetails: data?.stop_details || null,
      usage: data?.usage || null,
      model: data?.model || requestBody.model
    });
  } catch (error) {
    console.error('[api/generate-plan] proxy failure:', error);
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}

export { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_EFFORT };

// Pro-tier: allow up to 60s. Ignored on Hobby (capped at 10s).
export const config = {
  maxDuration: 60
};
