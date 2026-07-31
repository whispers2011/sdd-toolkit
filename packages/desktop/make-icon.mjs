/**
 * assets/icon.svg → build/icon.icns.
 *
 * Braucht `rsvg-convert` (brew install librsvg) und `iconutil` (macOS).
 * Das Ergebnis ist eingecheckt — ein Build läuft damit auch ohne librsvg.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svg = join(here, 'assets', 'icon.svg');
const iconset = join(here, 'assets', 'icon.iconset');
const icns = join(here, 'build', 'icon.icns');

/** [Kantenlänge in pt, Retina?] — die von iconutil erwarteten zehn Varianten. */
const VARIANTS = [16, 32, 128, 256, 512].flatMap((pt) => [
  { name: `icon_${pt}x${pt}.png`, px: pt },
  { name: `icon_${pt}x${pt}@2x.png`, px: pt * 2 },
]);

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
mkdirSync(dirname(icns), { recursive: true });

for (const { name, px } of VARIANTS) {
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), svg, '-o', join(iconset, name)]);
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
rmSync(iconset, { recursive: true, force: true });
console.log(`Icon geschrieben: ${icns}`);
