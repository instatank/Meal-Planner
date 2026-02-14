import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DB_FILE = path.resolve(process.cwd(), 'data', 'runtime-storage.json');
const DEFAULT_DB = {
  'meal-history': {},
  'meal-preferences': { accepts: {}, avoids: {}, edits: {}, skips: {} },
  'meal-plans': {}
};

const ensureDbFile = () => {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
  }
};

const readDb = () => {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { ...DEFAULT_DB };
  } catch {
    return { ...DEFAULT_DB };
  }
};

const writeDb = (db) => {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
};

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const storageMiddleware = async (req, res, next) => {
  const keyPath = (req.url || '').split('?')[0].replace(/^\/+/, '');
  const key = decodeURIComponent(keyPath);

  if (!key) {
    sendJson(res, 400, { error: 'Missing storage key' });
    return;
  }

  if (req.method === 'GET') {
    const db = readDb();
    sendJson(res, 200, { key, value: db[key] ?? null, updatedAt: db._updatedAt || null });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
        sendJson(res, 400, { error: 'Expected payload with value' });
        return;
      }

      const db = readDb();
      db[key] = payload.value;
      db._updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { ok: true, key, updatedAt: db._updatedAt });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Failed to save value' });
    }
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
};

const mealStorageApiPlugin = () => ({
  name: 'meal-storage-api',
  configureServer(server) {
    ensureDbFile();
    server.middlewares.use('/api/storage', storageMiddleware);
  },
  configurePreviewServer(server) {
    ensureDbFile();
    server.middlewares.use('/api/storage', storageMiddleware);
  }
});

export default defineConfig({
  plugins: [react(), mealStorageApiPlugin()]
});
