import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Prod-Bundle: nur @sdd/shared (reines Quell-TS-Paket ohne eigenes dist) einbündeln.
// Alle echten npm-Deps — native Module (better-sqlite3, node-pty) und Fastify-Plugins —
// bleiben extern und werden zur Laufzeit aus node_modules geladen.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@sdd/shared');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  external,
  // ESM-Output: createRequire bereitstellen, damit extern gehaltene CJS-Deps
  // (better-sqlite3, node-pty) intern require() nutzen können.
  banner: { js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  logLevel: 'info',
});
