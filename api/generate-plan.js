// Vercel serverless proxy to the Anthropic Messages API.
// Hides ANTHROPIC_API_KEY on the server so the frontend never sees it.
//
// The client sends `{ system, userMessage, model?, temperature?, maxTokens? }`.
// The proxy forwards to https://api.anthropic.com/v1/messages with prompt
// caching enabled on the system block, and returns `{ text, usage, stopReason }`.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

const parseBody = (body) => {
  if (body == null) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
  }
  return body;
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

  const {
    system,
    userMessage,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS
  } = parseBody(req.body);

  if (typeof system !== 'string' || !system.trim()) {
    res.status(400).json({ error: 'Missing required field: `system` (string).' });
    return;
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    res.status(400).json({ error: 'Missing required field: `userMessage` (string).' });
    return;
  }

  try {
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        // Ephemeral cache on the system prompt — identical system across
        // calls (same goal/prefs) gets a 90% input-token discount on hits.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
        ],
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const raw = await anthropicRes.text();
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({
        error: 'Anthropic API error',
        status: anthropicRes.status,
        body: raw.slice(0, 2000)
      });
      return;
    }

    const data = JSON.parse(raw);
    const text = data?.content?.[0]?.text || '';

    res.status(200).json({
      text,
      stopReason: data?.stop_reason || null,
      usage: data?.usage || null,
      model: data?.model || model
    });
  } catch (error) {
    console.error('[api/generate-plan] proxy failure:', error);
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}

// Pro-tier: allow up to 60s. Ignored on Hobby (capped at 10s).
export const config = {
  maxDuration: 60
};
