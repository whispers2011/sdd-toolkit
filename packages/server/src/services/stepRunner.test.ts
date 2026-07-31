import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultStepRunner, killProcessGroup } from './stepRunner.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sdd-runner-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(command: string, timeoutMs = 15_000, extraEnv: Record<string, string> = {}) {
  return defaultStepRunner({
    command,
    cwd: dir,
    logPath: join(dir, 'log', 'lauf.log'),
    header: `Test: ${command}`,
    timeoutMs,
    extraEnv,
  });
}

describe('defaultStepRunner: Bewertung über Exit-Code', () => {
  it('meldet exit 0 als Erfolg', async () => {
    const r = await run('true');
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it('reicht einen Fehlschlag-Exit-Code unverändert durch', async () => {
    expect((await run('exit 3')).exitCode).toBe(3);
  });

  /** Ein fehlendes Kommando ist ein regulärer Fehlschlag, nie ein stiller Erfolg. */
  it('meldet ein nicht vorhandenes Kommando als Fehlschlag', async () => {
    expect((await run('gibt-es-garantiert-nicht-xyz')).exitCode).not.toBe(0);
  });

  it('interpretiert die Ausgabe nie — Text auf stderr allein ist kein Fehlschlag', async () => {
    const r = await run('echo "ERROR: sieht schlimm aus" >&2; exit 0');
    expect(r.exitCode).toBe(0);
  });
});

describe('defaultStepRunner: Log und Ausschnitt', () => {
  it('schreibt Kopfzeile und Ausgabe in die Log-Datei', async () => {
    await run('echo hallo-welt');
    const log = readFileSync(join(dir, 'log', 'lauf.log'), 'utf8');
    expect(log).toContain('=== Test: echo hallo-welt ===');
    expect(log).toContain('hallo-welt');
  });

  it('legt das Log-Verzeichnis an, wenn es fehlt', async () => {
    await run('true');
    expect(existsSync(join(dir, 'log', 'lauf.log'))).toBe(true);
  });

  it('nimmt stdout und stderr in den Ausschnitt auf', async () => {
    const r = await run('echo aus-stdout; echo aus-stderr >&2');
    expect(r.tail).toContain('aus-stdout');
    expect(r.tail).toContain('aus-stderr');
  });

  /** Der Ausschnitt ist das, was ohne Log-Suche im Inbox-Item lesbar sein muss. */
  it('kürzt sehr viel Ausgabe auf die letzten Zeilen', async () => {
    const r = await run('for i in $(seq 1 500); do echo "zeile-$i"; done');
    expect(r.tail).toContain('zeile-500');
    expect(r.tail).not.toContain('zeile-1\n');
    expect(r.tail.split('\n').length).toBeLessThanOrEqual(20);
  });
});

describe('defaultStepRunner: Umgebung', () => {
  it('reicht die Kontext-Variablen an das Kommando durch', async () => {
    const r = await run('echo "$SDD_PORT_BASE/$SDD_PROFILE"', 15_000, {
      SDD_PORT_BASE: '21040',
      SDD_PROFILE: 'test',
    });
    expect(r.tail).toContain('21040/test');
  });

  it('läuft im übergebenen Arbeitsverzeichnis', async () => {
    const r = await run('pwd');
    expect(r.tail).toContain(dir.replace('/private', ''));
  });
});

describe('defaultStepRunner: Zeitlimit und Prozessgruppe', () => {
  it('bricht bei Zeitüberschreitung ab und meldet exit 137', async () => {
    const r = await run('sleep 30', 300);
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(137);
  }, 15_000);

  it('vermerkt das Zeitlimit in der Log-Datei', async () => {
    await run('sleep 30', 300);
    expect(readFileSync(join(dir, 'log', 'lauf.log'), 'utf8')).toContain('Zeitlimit überschritten');
  }, 15_000);

  /**
   * Der eigentliche Zweck der eigenen Prozessgruppe (FR-040/FR-041): ein im
   * Kommando gestarteter Hintergrunddienst überlebt das Zeitlimit NICHT. Vorher
   * beendete `child.kill()` nur die Shell — der Enkel hielt das
   * Arbeitsverzeichnis weiter (research E11/E12).
   */
  it('beendet auch Enkelprozesse des Kommandos', async () => {
    const pidFile = join(dir, 'enkel.pid');
    await run(`sh -c 'sleep 30 & echo $! > ${pidFile}; wait'`, 500);

    // Kurz Zeit lassen, bis das Signal wirklich zugestellt ist.
    await new Promise((r) => setTimeout(r, 300));
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(Number.isInteger(pid)).toBe(true);
    expect(alive(pid)).toBe(false);
  }, 20_000);
});

describe('killProcessGroup: nur die eigene Gruppe (FR-041, SC-008)', () => {
  /**
   * Der Nachweis für SC-008: zwei GLEICHNAMIGE Prozesse aus zwei Gruppen — es
   * stirbt genau der, dessen Gruppe beendet wird. Mit Namensmustern (`pkill -f
   * sleep`) wäre das per Konstruktion unmöglich; genau dieser Fehler hat am
   * 28./30.07.2026 fremde Features getroffen.
   */
  it('beendet nur die adressierte Gruppe, nicht den gleichnamigen Nachbarn', async () => {
    const { spawn } = await import('node:child_process');
    const a = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    const b = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    try {
      expect(a.pid).toBeGreaterThan(0);
      expect(b.pid).toBeGreaterThan(0);

      expect(killProcessGroup(a.pid, 'SIGKILL')).toBe(true);
      await new Promise((r) => setTimeout(r, 300));

      expect(alive(a.pid!), 'die adressierte Gruppe muss fort sein').toBe(false);
      expect(alive(b.pid!), 'der gleichnamige Nachbar muss weiterlaufen').toBe(true);
    } finally {
      killProcessGroup(b.pid, 'SIGKILL');
    }
  }, 15_000);

  it('gibt jedem Kind eine eigene Prozessgruppe', async () => {
    const { spawn } = await import('node:child_process');
    const a = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    const b = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    try {
      expect(a.pid).not.toBe(b.pid);
    } finally {
      killProcessGroup(a.pid, 'SIGKILL');
      killProcessGroup(b.pid, 'SIGKILL');
    }
  });
});

describe('killProcessGroup', () => {
  /**
   * `kill(-0, …)` meint die EIGENE Prozessgruppe — also den Toolkit-Server selbst.
   * Diese Prüfung ist der Grund, warum pid > 0 Pflicht ist.
   */
  it('verweigert pid 0, negative Werte und Unsinn', () => {
    expect(killProcessGroup(0, 'SIGTERM')).toBe(false);
    expect(killProcessGroup(-1, 'SIGTERM')).toBe(false);
    expect(killProcessGroup(undefined, 'SIGTERM')).toBe(false);
    expect(killProcessGroup(1.5, 'SIGTERM')).toBe(false);
  });

  it('wirft nicht, wenn es die Gruppe nicht mehr gibt', () => {
    expect(killProcessGroup(2_147_483_600, 'SIGTERM')).toBe(false);
  });
});

/** Läuft der Prozess noch? Signal 0 prüft, ohne zu beenden. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
