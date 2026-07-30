import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { orderedLifecycleStages } from '@sdd/shared';

/**
 * Existenz-Prüfung der Code-Orte des Lebenszyklus-Katalogs (FR-012, SC-004).
 *
 * Der geprüfte Katalog liegt in `packages/shared/src/lifecycleCatalog.ts` — der
 * Test aber bewusst HIER: `@sdd/shared` ist ein pures, isomorphes Paket ohne
 * Node-Builtins und ohne `@types/node`; ein Dateisystem-Test dort würde diese
 * Eigenschaft für einen einzigen Test aufweichen (research.md D5). `@sdd/server`
 * führt `@types/node` bereits und beherbergt alle dateisystemnahen Tests — und
 * die geprüften Dateien liegen ganz überwiegend genau hier.
 *
 * Geprüft wird zweierlei: die Datei existiert (fängt Verschiebungen) und das
 * letzte Glied des Symbols kommt als Text darin vor (fängt Umbenennungen). Nur
 * das Endglied und nur per Textsuche: die interessantesten Schritte liegen in
 * `private`-Methoden, die nicht exportiert sind und es dieses Features wegen
 * auch nicht werden sollen.
 */

/** Repo-Wurzel: aufwärts suchen, bis `pnpm-workspace.yaml` gefunden ist. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Repo-Wurzel (pnpm-workspace.yaml) nicht gefunden');
    dir = parent;
  }
}

const ROOT = repoRoot();

/** Letztes Glied eines Symbols: 'WorktreeManager.createUnlocked' → 'createUnlocked'. */
function symbolLeaf(symbol: string): string {
  return symbol.split('.').at(-1) ?? symbol;
}

const entries = orderedLifecycleStages().flatMap((stage) =>
  stage.steps.map((step) => ({
    where: `${stage.title} → ${step.name}`,
    file: step.location.file,
    symbol: step.location.symbol,
  })),
);

describe('Code-Orte des Lebenszyklus-Katalogs existieren im Repository', () => {
  it('findet die Repo-Wurzel über pnpm-workspace.yaml', () => {
    expect(existsSync(join(ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(existsSync(join(ROOT, 'packages', 'shared', 'src', 'lifecycleCatalog.ts'))).toBe(true);
  });

  it('prüft überhaupt Einträge (ein leerer Katalog dürfte nicht grün durchlaufen)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('$where: $file existiert und enthält $symbol', ({ where, file, symbol }) => {
    const abs = join(ROOT, file);
    expect(existsSync(abs), `${where}: Datei '${file}' existiert nicht (mehr)`).toBe(true);

    const leaf = symbolLeaf(symbol);
    const content = readFileSync(abs, 'utf8');
    expect(
      content.includes(leaf),
      `${where}: Symbol '${symbol}' kommt in '${file}' nicht vor — umbenannt oder verschoben?`,
    ).toBe(true);
  });
});
