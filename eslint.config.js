import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.specify/**', 'packages/web/src/vite-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // Ungenutzte Bezeichner sind ein Fehler; ein führender Unterstrich ist die
      // ausdrückliche Kennzeichnung „absichtlich ungenutzt".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Leere catch-Blöcke sind im Bestand ein bewusstes Muster (Aufräumpfade, die
      // nicht scheitern dürfen); leere Blöcke an anderer Stelle bleiben ein Fehler.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    ...reactHooks.configs['recommended-latest'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // Tests konstruieren bewusst unvollständige Abhängigkeiten und casten über `any`.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
