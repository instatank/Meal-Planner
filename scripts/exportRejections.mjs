/**
 * exportRejections.mjs
 * Dumps the rejected-plans array from Firestore as individual JSON files
 * under docs/rejections/, one file per rejection.
 * Run: node scripts/exportRejections.mjs
 */

import { createRequire } from 'module';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

// ── Config ───────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = './meal-planner-fa6ee-firebase-adminsdk-fbsvc-c136fcb9e0.json';
const USER_UID = 'ke8DbcbcOiYj5X4dWULhRZ4g8Ix2';
const OUTPUT_DIR = path.resolve('./docs/rejections');

// ── Initialize Firebase Admin ─────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const sanitizeForFilename = (isoTimestamp) => isoTimestamp.replace(/[:.]/g, '-');

const exportRejections = async () => {
  const docRef = db.collection('users').doc(USER_UID).collection('metrics').doc('rejected-plans');
  const snap = await docRef.get();
  const rejections = snap.exists ? (snap.data()?.value || []) : [];

  if (!Array.isArray(rejections) || rejections.length === 0) {
    console.log('No rejected plans found.');
    process.exit(0);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  rejections.forEach((rejection, index) => {
    const timestamp = rejection?.timestamp || `unknown-${index}`;
    const filename = `${String(index).padStart(3, '0')}-${sanitizeForFilename(timestamp)}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    writeFileSync(filePath, JSON.stringify(rejection, null, 2));
    console.log(`Wrote ${filePath}`);
  });

  console.log(`\n✅ Exported ${rejections.length} rejection(s) to ${OUTPUT_DIR}`);
  process.exit(0);
};

exportRejections().catch(err => {
  console.error('❌ Export failed:', err.message);
  process.exit(1);
});
