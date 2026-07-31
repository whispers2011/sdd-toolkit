import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Der Wächter gegen die Rückkehr des Zwillings (US4, SC-001).
 *
 * Dieses Feature entstand, weil drei Aufgaben zweimal existierten — in zwei Dateien,
 * die niemand gemeinsam liest. Gepflegt wurde über Monate nur eine der beiden
 * Fassungen; jeder am 28.07.2026 gefundene Chat-Fehler war eine Lösung, die im Repo
 * schon existierte, nur nicht im Chat.
 *
 * Es ist das einzige Abnahmekriterium der Spec, das über ABWESENHEIT redet („keine
 * zweite Implementierung"). Abwesenheit kann ein Test prüfen, ein Review-Vorsatz nicht:
 * Beim nächsten Copy-Paste schlägt er sofort fehl — genau bei dem Vorgang, der dieses
 * Feature nötig gemacht hat. Er läuft im bestehenden `pnpm test`, dem Tor, das jede
 * Phase ohnehin passiert.
 *
 * Geprüft wird der Quellcode, nicht die Tests: Attrappen dürfen dieselben Namen
 * beliebig oft nennen.
 */

/** Repo-Wurzel: aufwärts suchen, bis `pnpm-workspace.yaml` gefunden ist. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (readdirSync(dir).includes('pnpm-workspace.yaml')) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Repo-Wurzel (pnpm-workspace.yaml) nicht gefunden');
    dir = parent;
  }
}

const ROOT = repoRoot();
const SRC = join(ROOT, 'packages', 'server', 'src');

/** Alle Quelldateien unter packages/server/src — ohne Tests. */
function quelldateien(dir: string): string[] {
  const out: string[] = [];
  for (const eintrag of readdirSync(dir, { withFileTypes: true })) {
    const pfad = join(dir, eintrag.name);
    if (eintrag.isDirectory()) {
      out.push(...quelldateien(pfad));
    } else if (eintrag.name.endsWith('.ts') && !eintrag.name.includes('.test.')) {
      out.push(pfad);
    }
  }
  return out;
}

const DATEIEN = quelldateien(SRC);

/** Repo-relativ und mit `/` — damit die Fehlermeldung überall gleich aussieht. */
const relPfad = (abs: string) => relative(SRC, abs).split(sep).join('/');

interface Merkmal {
  /** Wonach gesucht wird — der charakteristische Aufruf der Aufgabe. */
  muster: string;
  /** Was diese Aufgabe ist (für die Fehlermeldung). */
  aufgabe: string;
  /** Genau diese Dateien dürfen ihn enthalten, jede mit Grund. */
  erlaubt: Record<string, string>;
}

const MERKMALE: Merkmal[] = [
  {
    muster: 'selectEventsForWindow(',
    aufgabe: 'Turn messen — Auswahl der Meldungen im Lauffenster (FR-002)',
    erlaubt: { 'services/core/runMeter.ts': 'der gemeinsame Kern' },
  },
  {
    muster: 'summarizeEvents(',
    aufgabe: 'Turn messen — Verdichtung der Meldungen (FR-002)',
    erlaubt: { 'services/core/runMeter.ts': 'der gemeinsame Kern' },
  },
  {
    muster: 'buildClaudeArgv(',
    aufgabe: 'Session sicherstellen — Kommandozeile der Claude-Session (FR-001)',
    erlaubt: {
      'services/core/sessionCore.ts': 'der gemeinsame Kern',
      'pty/commandBuilder.ts': 'die Definition selbst',
    },
  },
  {
    muster: 'worktrees.create(',
    aufgabe: 'Arbeitskopie anlegen (FR-003)',
    erlaubt: { 'services/core/workspace.ts': 'der gemeinsame Kern' },
  },
  {
    muster: 'ptys.spawn(',
    aufgabe: 'Session sicherstellen — Prozessstart (FR-001)',
    erlaubt: {
      'services/core/sessionCore.ts': 'der gemeinsame Kern',
      // Das Projekt-Terminal startet eine Shell (`kind: 'shell'`), keine
      // Claude-Session: kein Resume, kein Systemprompt, keine Messung, kein
      // Sessioneintrag. Es teilt mit dem Kern nur den Prozessstart selbst und ist
      // deshalb kein Zwilling der Aufgabe (research.md D9).
      'api/server.ts': 'Projekt-Terminal, kind shell — keine Claude-Session',
    },
  },
];

describe('Jede der drei geteilten Aufgaben existiert genau einmal (SC-001)', () => {
  it('liest überhaupt Quellen (ein leerer Lauf dürfte nicht grün durchgehen)', () => {
    expect(DATEIEN.length).toBeGreaterThan(30);
    expect(DATEIEN.some((f) => relPfad(f) === 'services/core/runMeter.ts')).toBe(true);
  });

  it.each(MERKMALE)('$muster kommt nur an den erlaubten Stellen vor — $aufgabe', ({ muster, aufgabe, erlaubt }) => {
    const gefunden = DATEIEN.filter((f) => readFileSync(f, 'utf8').includes(muster)).map(relPfad);
    const unerlaubt = gefunden.filter((f) => !(f in erlaubt));

    expect(
      unerlaubt,
      `${aufgabe}: '${muster}' steht ausserhalb des Kerns in ${unerlaubt.join(', ')} — ` +
        `zweite Implementierung? Erlaubt sind nur: ${Object.entries(erlaubt)
          .map(([f, grund]) => `${f} (${grund})`)
          .join(', ')}`,
    ).toEqual([]);
  });

  it.each(MERKMALE)('$muster steht im Kern überhaupt noch — sonst prüft der Wächter nichts', ({ muster, erlaubt }) => {
    const gefunden = DATEIEN.filter((f) => readFileSync(f, 'utf8').includes(muster)).map(relPfad);
    expect(gefunden.length, `'${muster}' kommt nirgends mehr vor — umbenannt?`).toBeGreaterThan(0);
    // Jede Erlaubnis muss auch eingelöst werden: eine Liste mit toten Einträgen
    // erlaubt beim nächsten Mal stillschweigend eine echte zweite Fundstelle.
    for (const datei of Object.keys(erlaubt)) {
      expect(gefunden, `Erlaubnis für '${datei}' ist tot — Eintrag entfernen`).toContain(datei);
    }
  });
});
