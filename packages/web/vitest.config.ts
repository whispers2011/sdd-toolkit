import { defineConfig } from 'vitest/config';

/**
 * Eigene Konfiguration statt `vite.config.ts` (research D11): die Tests prüfen
 * web-eigene Artefakte (CSS-Schlüsselsätze, Konsolen-Paletten, FOUC-Guard,
 * Warteschlange) als reine Module — dafür sollen weder das React- noch das
 * Tailwind-Plugin laden.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
