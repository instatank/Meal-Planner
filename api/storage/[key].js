import { Redis } from '@upstash/redis';

const ALLOWED_STORAGE_KEYS = new Set(['meal-history', 'meal-preferences', 'meal-plans']);
const KEY_PREFIX = 'meal-planner:';

const getRedisClient = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;
  return new Redis({ url, token });
};

const namespacedKey = (key) => `${KEY_PREFIX}${key}`;
const updatedAtKey = (key) => `${namespacedKey(key)}:updatedAt`;

const parseIncomingBody = (body) => {
  if (body == null) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body || '{}');
    } catch {
      return {};
    }
  }
  return body;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const rawKey = Array.isArray(req.query?.key) ? req.query.key[0] : req.query?.key;
  const key = decodeURIComponent(String(rawKey || '').trim());

  if (!ALLOWED_STORAGE_KEYS.has(key)) {
    res.status(400).json({ error: 'Invalid storage key' });
    return;
  }

  const redis = getRedisClient();
  if (!redis) {
    res.status(503).json({ error: 'Server storage is not configured' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const value = await redis.get(namespacedKey(key));
      const updatedAt = await redis.get(updatedAtKey(key));

      res.status(200).json({
        key,
        value: value ?? null,
        updatedAt: updatedAt ?? null
      });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const payload = parseIncomingBody(req.body);
      if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
        res.status(400).json({ error: 'Expected payload with `value`' });
        return;
      }

      const updatedAt = new Date().toISOString();
      await redis.set(namespacedKey(key), payload.value);
      await redis.set(updatedAtKey(key), updatedAt);

      res.status(200).json({ ok: true, key, updatedAt });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Storage request failed'
    });
  }
}
