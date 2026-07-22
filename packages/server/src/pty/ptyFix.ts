import { createRequire } from 'node:module';
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * node-pty-Reparatur (speckit-assistant ptyLoader-Muster): pnpm/npm verlieren
 * beim Entpacken der Prebuilds das Exec-Bit des `spawn-helper` — jeder
 * PTY-Spawn scheitert dann mit `posix_spawnp failed`. Defensiv beheben.
 */
export function ensureSpawnHelperExecutable(): void {
  try {
    const require = createRequire(import.meta.url);
    const pkgDir = dirname(require.resolve('node-pty/package.json'));
    const candidates: string[] = [
      join(pkgDir, 'build', 'Release', 'spawn-helper'),
      join(pkgDir, 'build', 'Debug', 'spawn-helper'),
    ];
    const prebuilds = join(pkgDir, 'prebuilds');
    if (existsSync(prebuilds)) {
      for (const dir of readdirSync(prebuilds)) {
        candidates.push(join(prebuilds, dir, 'spawn-helper'));
      }
    }
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const mode = statSync(path).mode;
      if ((mode & 0o111) === 0) {
        chmodSync(path, 0o755);
        console.log(`[ptyFix] Exec-Bit repariert: ${path}`);
      }
    }
  } catch {
    /* best effort — echter Spawn-Fehler wird ohnehin gemeldet */
  }
}
