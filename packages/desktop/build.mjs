/**
 * Baut alles zusammen, was electron-builder anschließend verpackt, in `app/`:
 *
 *   app/main.cjs      Electron-Hauptprozess (gebündelt)
 *   app/splash.html   Startbildschirm bis der Server antwortet
 *   app/server/       Fastify-Server als ein ESM-Bundle
 *   app/web/          gebautes React-Bundle
 *   app/node_modules/ NUR die nativen Module — eigenständig installiert
 *
 * Warum `app/` ein eigenes, mit npm installiertes Verzeichnis ist: pnpm teilt
 * eine physische Kopie von better-sqlite3/node-pty zwischen allen Paketen. Ein
 * Rebuild gegen die Electron-ABI würde damit auch das Modul zerschießen, das
 * `pnpm dev` benutzt („NODE_MODULE_VERSION mismatch"). Die isolierte Kopie hier
 * hält beide Welten sauber getrennt.
 */
import { build } from 'esbuild';
import { rebuild } from '@electron/rebuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const appDir = join(here, 'app');

/** Extern gehaltene Module: nativ, also nicht bündelbar. */
const NATIVE = ['better-sqlite3', 'node-pty'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const step = (msg) => console.log(`\n▸ ${msg}`);

const desktopPkg = readJson(join(here, 'package.json'));
const rootPkg = readJson(join(repo, 'package.json'));
const electronVersion = desktopPkg.devDependencies.electron.replace(/^[^\d]*/, '');

// Die im Monorepo tatsächlich installierten Versionen übernehmen, damit App und
// Dev-Server nie auf unterschiedlichen Schema-/API-Ständen laufen.
const serverRequire = createRequire(join(repo, 'packages/server/package.json'));
const nativeVersions = Object.fromEntries(
  NATIVE.map((name) => [name, readJson(serverRequire.resolve(`${name}/package.json`)).version]),
);

// ------------------------------------------------------ 0. Electron-Binary

// Electron ≥43 bringt kein postinstall-Skript mehr mit; ohne diesen Anstoß
// fehlt die Laufzeit, gegen die gebaut und verpackt wird.
const electronDir = join(here, 'node_modules', 'electron');
if (!existsSync(join(electronDir, 'dist'))) {
  step(`Electron ${electronVersion} herunterladen`);
  execFileSync(process.execPath, [join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit' });
}

// ---------------------------------------------------------------- 1. Web-UI

if (process.env.SDD_SKIP_WEB === '1') {
  step('Web-Bundle übersprungen (SDD_SKIP_WEB=1)');
} else {
  step('Web-Bundle bauen (vite)');
  execFileSync('pnpm', ['--filter', '@sdd/web', 'build'], { cwd: repo, stdio: 'inherit' });
}

// ------------------------------------------------------------- 2. Bündeln

step('Server- und Hauptprozess-Bundle schreiben');
await rm(join(appDir, 'server'), { recursive: true, force: true });
await rm(join(appDir, 'web'), { recursive: true, force: true });
await mkdir(appDir, { recursive: true });

await build({
  entryPoints: [join(repo, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(appDir, 'server', 'index.js'),
  sourcemap: true,
  external: NATIVE,
  // ESM-Ausgabe: `require` bereitstellen, damit die extern gehaltenen
  // CJS-Module (better-sqlite3, node-pty) intern laden können.
  banner: {
    js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: join(appDir, 'main.cjs'),
  external: ['electron'],
  logLevel: 'warning',
});

await cp(join(here, 'src', 'splash.html'), join(appDir, 'splash.html'));
await cp(join(repo, 'packages/web/dist'), join(appDir, 'web'), { recursive: true });

// ------------------------------------------------------- 3. App-Manifest

step('app/package.json schreiben');
await writeFile(
  join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'sdd-toolkit',
      productName: 'SDD Toolkit',
      version: rootPkg.version,
      description: rootPkg.description,
      author: 'IWF',
      license: 'UNLICENSED',
      type: 'module',
      main: 'main.cjs',
      dependencies: nativeVersions,
    },
    null,
    2,
  )}\n`,
);

// ------------------------------------- 4. Native Module: installieren + rebuild

const stampFile = join(appDir, '.native-stamp');
const stamp = createHash('sha256')
  .update(JSON.stringify({ nativeVersions, electronVersion, arch: process.arch }))
  .digest('hex');
const stampCurrent =
  existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === stamp && existsSync(join(appDir, 'node_modules'));

if (stampCurrent) {
  step('Native Module unverändert — Installation und Rebuild übersprungen');
} else {
  step(`Native Module installieren (${Object.entries(nativeVersions).map(([n, v]) => `${n}@${v}`).join(', ')})`);
  await rm(join(appDir, 'node_modules'), { recursive: true, force: true });
  await rm(join(appDir, 'package-lock.json'), { force: true });
  // --ignore-scripts: keine Node-ABI-Prebuilds herunterladen, die der Rebuild
  // gleich darauf ersetzt.
  execFileSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: appDir,
    stdio: 'inherit',
  });

  step(`Gegen Electron ${electronVersion} neu bauen`);
  await rebuild({
    buildPath: appDir,
    projectRootPath: appDir,
    electronVersion,
    arch: process.arch,
    onlyModules: NATIVE,
    force: true,
  });
  await writeFile(stampFile, `${stamp}\n`);
}

console.log(`\n✓ app/ ist bereit — ${appDir}`);
