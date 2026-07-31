import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationSettings, Project } from '@sdd/shared';
import type { SessionRepo } from '../../db/repos.js';
import type { WorktreeManager } from '../../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../../pty/sessionManager.js';
import { SessionCore, type SessionSpec, type SpawnStage } from './sessionCore.js';

/**
 * Session sicherstellen — der gemeinsame Kern beider Pfade (FR-001, FR-004, FR-005,
 * FR-013…FR-016).
 *
 * Der Doppelstart war am 28.07.2026 fünfmal beobachtet worden, zuletzt mit zwei
 * gleichzeitig arbeitenden Claude-Prozessen in derselben Arbeitskopie. Der Schutz
 * existierte danach in beiden Pfaden — aber zweimal, und genau dieses Muster hat das
 * Problem erzeugt.
 *
 * `locateTranscript` zeigt fest auf `~/.claude`; Tests schreiben dort nicht. Der Fund
 * ist darum steuerbar gemacht — nur so ist die Resume-Prüfung überhaupt prüfbar.
 */
const transkript = vi.hoisted(() => ({ gefunden: null as string | null }));

vi.mock('../../pty/transcriptWatcher.js', () => ({
  locateTranscript: () => transkript.gefunden,
}));

const projekt = {
  id: 'p1',
  name: 'Demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
} as unknown as Project;

const automatik = (autoMode: boolean): AutomationSettings =>
  ({ autoProgressUntil: 'off', autoVerify: false, autoMode }) as unknown as AutomationSettings;

function bauen(opts: { worktreeWirft?: boolean; spawnWirft?: boolean; verzoegerung?: number } = {}) {
  let spawns = 0;
  const spawnArgs: { argv: string[]; cwd: string; kind: string }[] = [];
  const setClaudeSessionId = vi.fn();
  const sessionCreate = vi.fn();

  // Verzögert wie die echte Anlage — genau hier klaffte das Zeitfenster.
  const create = vi.fn(async () => {
    if (opts.verzoegerung) await new Promise((r) => setTimeout(r, opts.verzoegerung));
    if (opts.worktreeWirft) throw new Error('cannot lock ref');
    return '/wt/demo';
  });
  const worktrees = { create, remove: vi.fn(async () => {}), pathFor: () => '/wt/demo' } as unknown as WorktreeManager;

  const ptys = {
    spawn: async (a: { argv: string[]; cwd: string; kind: string }) => {
      if (opts.spawnWirft) throw new Error('pty failed');
      spawns += 1;
      spawnArgs.push(a);
      return { id: `s${spawns}`, pty: { pid: 1000 + spawns } } as unknown as LiveSession;
    },
  } as unknown as PtySessionManager;

  const sessions = { setClaudeSessionId, create: sessionCreate } as unknown as SessionRepo;
  const core = new SessionCore({ sessions, ptys, worktrees });
  return { core, worktrees, sessions, setClaudeSessionId, create: sessionCreate, worktreeCreate: create, spawnArgs, zaehler: () => spawns };
}

const featureSpec = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  project: projekt,
  featureId: 'f1',
  conversationId: null,
  kind: 'feature',
  existing: undefined,
  workspace: { project: projekt, name: 'demo', branch: 'feature/demo', recordedPath: null },
  previous: null,
  automation: automatik(true),
  ...over,
});

const chatSpec = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  project: projekt,
  featureId: null,
  conversationId: 'c1',
  kind: 'chat_work',
  existing: undefined,
  workspace: { project: projekt, name: 'chat-c1', branch: 'chat/c1', recordedPath: '/wt/demo' },
  previous: null,
  automation: automatik(true),
  appendSystemPrompt: 'Chat-Systemprompt',
  wrapError: (stage: SpawnStage, err: Error) =>
    new Error(
      stage === 'worktree'
        ? `Arbeitskopie konnte nicht erstellt werden: ${err.message}`
        : `Session konnte nicht gestartet werden: ${err.message}`,
    ),
  ...over,
});

beforeEach(() => {
  transkript.gefunden = '/home/x/.claude/projects/demo/uuid.jsonl';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionCore — kein Doppelstart, in beiden Pfaden (SC-005, S1)', () => {
  it('startet in 20 aufeinanderfolgenden Versuchen je Pfad genau einen Prozess', async () => {
    const doppelstarts: string[] = [];

    for (let versuch = 0; versuch < 20; versuch++) {
      for (const [pfad, key, spec] of [
        ['feature', `feature:f${versuch}`, featureSpec()],
        ['chat', `chat:p${versuch}`, chatSpec()],
      ] as const) {
        const { core, zaehler } = bauen({ verzoegerung: 10 });

        const [a, b] = await Promise.all([
          core.ensure(key, () => spec),
          core.ensure(key, () => spec),
        ]);

        if (zaehler() !== 1) doppelstarts.push(`${pfad}#${versuch}: ${zaehler()} Spawns`);
        if (a.id !== b.id) doppelstarts.push(`${pfad}#${versuch}: verschiedene Kennungen`);
      }
    }

    expect(doppelstarts).toEqual([]);
  });

  it('gibt beiden Aufrufern dieselbe Session-Kennung (US2 Szenarien 1+2)', async () => {
    const { core } = bauen({ verzoegerung: 10 });
    const ergebnisse = await Promise.all([
      core.ensure('chat:p1', () => chatSpec()),
      core.ensure('chat:p1', () => chatSpec()),
      core.ensure('chat:p1', () => chatSpec()),
    ]);
    expect(new Set(ergebnisse.map((s) => s.id)).size).toBe(1);
  });

  it('koalesziert nur gleichzeitige Aufrufe desselben Schlüssels', async () => {
    const { core, zaehler } = bauen({ verzoegerung: 10 });
    await Promise.all([
      core.ensure('feature:f1', () => featureSpec()),
      core.ensure('feature:f2', () => featureSpec({ featureId: 'f2' })),
    ]);
    expect(zaehler()).toBe(2); // zwei Bezugsobjekte, zwei Sessions
  });

  it('gibt den Schutz nach Abschluss wieder frei (S2)', async () => {
    const { core, zaehler } = bauen();
    await core.ensure('chat:p1', () => chatSpec());
    await core.ensure('chat:p1', () => chatSpec());
    expect(zaehler()).toBe(2); // Koaleszenz gilt nur währenddessen
  });

  it('löst den Auftrag INNERHALB des Schutzes auf — der zweite Aufrufer bekommt keine veralteten Daten', async () => {
    const { core } = bauen({ verzoegerung: 10 });
    const aufloesungen = vi.fn(() => chatSpec());
    await Promise.all([
      core.ensure('chat:p1', aufloesungen),
      core.ensure('chat:p1', aufloesungen),
    ]);
    expect(aufloesungen).toHaveBeenCalledTimes(1); // der zweite bekommt das laufende Versprechen
  });
});

describe('SessionCore — laufende Session und Fehlerfreigabe', () => {
  it('gibt eine bereits laufende Session unverändert zurück (FR-016, Szenario 4)', async () => {
    const { core, zaehler, create } = bauen();
    const laeuft = { id: 's-live', exited: false } as unknown as LiveSession;

    const ergebnis = await core.ensure('feature:f1', () => featureSpec({ existing: laeuft }));

    expect(ergebnis).toBe(laeuft);
    expect(zaehler()).toBe(0); // kein zweiter Prozess
    expect(create).not.toHaveBeenCalled(); // und keine zweite Zeile in `sessions`
  });

  it('reicht einen Fehler aus resolve() an alle Wartenden und gibt frei (S3)', async () => {
    const { core, zaehler } = bauen();
    const wirft = () => {
      throw new Error('Feature ist abgeschlossen');
    };

    const [a, b] = await Promise.all([
      core.ensure('feature:f1', wirft).catch((e: Error) => e),
      core.ensure('feature:f1', wirft).catch((e: Error) => e),
    ]);

    expect(a).toBeInstanceOf(Error);
    expect(b).toBeInstanceOf(Error);

    // Schutz ist frei: ein späterer Aufruf läuft wieder voll durch.
    await core.ensure('feature:f1', () => featureSpec());
    expect(zaehler()).toBe(1);
  });

  it('gibt den Schutz auch nach einem gescheiterten Spawn frei (S3)', async () => {
    const { core } = bauen({ spawnWirft: true });
    await expect(core.ensure('chat:p1', () => chatSpec())).rejects.toThrow(/nicht gestartet/);
    await expect(core.ensure('chat:p1', () => chatSpec())).rejects.toThrow(/nicht gestartet/);
  });
});

describe('SessionCore — tote Claude-Session-Kennung (FR-014, S5, Szenario 3)', () => {
  it('verwirft die Kennung, nullt sie in der Datenbank und startet ohne --resume', async () => {
    transkript.gefunden = null; // Transkript existiert nicht mehr
    const { core, setClaudeSessionId, spawnArgs } = bauen();

    await core.ensure('feature:f1', () =>
      featureSpec({ previous: { id: 'sess-alt', claude_session_id: 'uuid-tot' } }),
    );

    expect(setClaudeSessionId).toHaveBeenCalledWith('sess-alt', null);
    expect(spawnArgs[0]!.argv).not.toContain('--resume');
  });

  it('setzt eine lebende Kennung fort', async () => {
    const { core, setClaudeSessionId, spawnArgs } = bauen();

    await core.ensure('feature:f1', () =>
      featureSpec({ previous: { id: 'sess-alt', claude_session_id: 'uuid-lebt' } }),
    );

    expect(setClaudeSessionId).not.toHaveBeenCalled();
    expect(spawnArgs[0]!.argv).toContain('--resume');
    expect(spawnArgs[0]!.argv).toContain('uuid-lebt');
  });

  it('versucht kein Fortsetzen, wenn es nie eine echte Claude-Session gab (Edge Case)', async () => {
    const { core, setClaudeSessionId, spawnArgs } = bauen();

    await core.ensure('feature:f1', () =>
      featureSpec({ previous: { id: 'sess-alt', claude_session_id: null } }),
    );

    expect(setClaudeSessionId).not.toHaveBeenCalled();
    expect(spawnArgs[0]!.argv).not.toContain('--resume');
  });
});

describe('SessionCore — der Kern schreibt keinem Pfad sein Fehlerbild vor (FR-005)', () => {
  it('lässt ohne wrapError den rohen Fehler fliegen (S4, Phasen-Pfad)', async () => {
    const { core } = bauen({ worktreeWirft: true });
    await expect(core.ensure('feature:f1', () => featureSpec())).rejects.toThrow('cannot lock ref');
  });

  it('kleidet den Worktree-Fehler ein, wenn der Pfad es verlangt (Chat, US3 Szenario 3)', async () => {
    const { core } = bauen({ worktreeWirft: true });
    await expect(core.ensure('chat:p1', () => chatSpec())).rejects.toThrow(
      'Arbeitskopie konnte nicht erstellt werden: cannot lock ref',
    );
  });

  it('kleidet den Spawn-Fehler ein (Chat, US2 Szenario 5)', async () => {
    const { core } = bauen({ spawnWirft: true });
    await expect(core.ensure('chat:p1', () => chatSpec())).rejects.toThrow(
      'Session konnte nicht gestartet werden: pty failed',
    );
  });
});

/**
 * Der Phasen-Pfad klammert die Anlage in seine Lebenszyklus-Auslöser und gibt darum
 * eine Funktion statt eines Auftrags mit (FR-004). Die Anlage-Regel selbst bleibt eine
 * einzige Implementierung — die Funktion ruft `ensureWorkspace`.
 */
describe('SessionCore — Arbeitskopie als Auftrag ODER als Funktion', () => {
  it('führt eine mitgegebene Funktion aus, statt selbst anzulegen', async () => {
    const { core, worktreeCreate, spawnArgs } = bauen();
    const vorbereitet = vi.fn(async () => '/wt/vorbereitet');

    await core.ensure('feature:f1', () => featureSpec({ workspace: vorbereitet }));

    expect(vorbereitet).toHaveBeenCalledTimes(1);
    expect(worktreeCreate).not.toHaveBeenCalled(); // der Kern hat nicht selbst angelegt
    expect(spawnArgs[0]!.cwd).toBe('/wt/vorbereitet');
  });

  it('kleidet auch den Fehler der mitgegebenen Funktion als Worktree-Stufe ein', async () => {
    const { core } = bauen();
    const vorbereitet = async () => {
      throw new Error('Lebenszyklus-Schritt fehlgeschlagen');
    };

    await expect(core.ensure('chat:p1', () => chatSpec({ workspace: vorbereitet }))).rejects.toThrow(
      'Arbeitskopie konnte nicht erstellt werden: Lebenszyklus-Schritt fehlgeschlagen',
    );
  });
});

describe('SessionCore — Berechtigungsmodus und Auftragsfelder (FR-004, FR-015, S6)', () => {
  it('folgt allein der aufgelösten Automatisierung', async () => {
    const an = bauen();
    await an.core.ensure('feature:f1', () => featureSpec({ automation: automatik(true) }));
    expect(an.spawnArgs[0]!.argv.join(' ')).toContain('bypassPermissions');

    const aus = bauen();
    await aus.core.ensure('feature:f1', () => featureSpec({ automation: automatik(false) }));
    expect(aus.spawnArgs[0]!.argv.join(' ')).toContain('acceptEdits');
  });

  it('nimmt System-Prompt und Modell nur mit, wenn der Pfad sie mitgibt', async () => {
    const chat = bauen();
    await chat.core.ensure('chat:p1', () => chatSpec({ model: 'claude-opus-5' }));
    const chatArgv = chat.spawnArgs[0]!.argv.join(' ');
    expect(chatArgv).toContain('Chat-Systemprompt');
    expect(chatArgv).toContain('claude-opus-5');

    const phase = bauen();
    await phase.core.ensure('feature:f1', () => featureSpec());
    const phaseArgv = phase.spawnArgs[0]!.argv.join(' ');
    expect(phaseArgv).not.toContain('--append-system-prompt');
    expect(phaseArgv).not.toContain('--model');
  });

  it('meldet den Pfad der Arbeitskopie zurück und schreibt die Session-Zeile mit Bezugsobjekt', async () => {
    const { core, create } = bauen();
    const gemeldet: string[] = [];

    await core.ensure('chat:p1', () =>
      chatSpec({ onWorktreeReady: (pfad: string) => gemeldet.push(pfad) }),
    );

    expect(gemeldet).toEqual(['/wt/demo']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', featureId: null, kind: 'chat_work' }),
    );
  });
});
