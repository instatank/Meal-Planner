import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Showcase-only Vite config: stubs Firebase so the real UI renders offline with
// seeded demo data. Run: vite --config vite.demo.config.js, open /demo.html
export default defineConfig({
  plugins: [react()],
  define: {
    // Dummy key so the Omnibox renders its real input bar (no network at init).
    'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify('demo-key'),
  },
  resolve: {
    alias: {
      'firebase/app': path.resolve(__dirname, 'showcase/stubs/firebase-app.js'),
      'firebase/firestore': path.resolve(__dirname, 'showcase/stubs/firebase-firestore.js'),
      'firebase/auth': path.resolve(__dirname, 'showcase/stubs/firebase-auth.js'),
    },
  },
});
