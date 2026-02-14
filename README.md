# Meal Planner

Standalone React + Vite app for daily meal planning, tracking, and adaptive suggestions.

## Local Run

```bash
cd /Users/ankitanand/Projects/meal-planner
npm install
npm run dev
```

## Storage Behavior

- Local development uses a file-backed storage API in `vite.config.js`:
  - `data/runtime-storage.json`
- Production uses `/api/storage/[key]` backed by Upstash Redis (via Vercel).

## Deploy To Vercel (Production)

1. Push this folder to a GitHub repository.
2. In Vercel, import that GitHub repo.
3. Add a Redis integration in Vercel (Upstash Redis).
4. Confirm these env vars are present in Vercel project settings:
   - `UPSTASH_REDIS_REST_URL` (or `KV_REST_API_URL`)
   - `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_TOKEN`)
5. Deploy.

After deploy, app data (`meal-history`, `meal-preferences`, `meal-plans`) persists server-side across reloads/devices.
