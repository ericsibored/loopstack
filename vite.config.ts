/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // Both workers are ES modules (they use `import`), so the worker bundle
    // must be too. A classic-format worker would break the rnnoise import.
    format: 'es',
  },
  server: {
    // Phase 0 has to be exercised on real phones, and getUserMedia requires a
    // secure context — so the dev server must be reachable on the LAN. Pair
    // with an HTTPS tunnel; Safari will refuse the mic on a bare http:// IP.
    host: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
