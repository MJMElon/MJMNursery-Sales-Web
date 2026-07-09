import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Multi-page app — one HTML entry per migrated page so the public URLs
// (www.mjmnursery.com/auth.html, /admin.html, …) stay identical and no
// existing links/bookmarks break.
//
// Strangler rule: a page lives EITHER here as a React entry at the repo
// root OR as the original static file in public/ — never both (Vite
// errors on the collision). Unmigrated pages in public/ are copied into
// dist/ verbatim, so the whole site keeps working during the migration.
//
// payment.html, payment-callback.html (Billplz redirect target) and
// payment-proof.html stay in public/ permanently — do not migrate them.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        dev: resolve(__dirname, 'dev.html'),
      },
    },
  },
});
