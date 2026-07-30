/**
 * Pure Domäne der Stack-Profile: Auslesen und Prüfen der Projekt-Konfiguration,
 * Ableitung der Kommandofolge je Lane-Aktion, Bestimmung des Haupteingangs.
 *
 * KEIN IO, keine Node-Importe. Server und Oberfläche nutzen dieselben Funktionen,
 * damit es für dieselbe Frage nicht zwei Antworten gibt — insbesondere bei den
 * Validierungssätzen, die beide Seiten wortgleich anzeigen.
 *
 * Das Toolkit bringt KEINE Vorgabekommandos mit (FR-012): ein Projekt ohne
 * Konfiguration hat keinen Stack — sichtbar, aber nicht blockierend (FR-013).
 */
import type { StackConfig, StackProfile, StackProfileName, StackService } from './types.js';

/** Kein Stack: alle Profile leer, keine Dienste. Ergebnis von `parseStackConfig('{}')`. */
export const EMPTY_STACK_CONFIG: StackConfig = {
  test: null,
  full: null,
  down: null,
  stopCommand: null,
  services: [],
};

/** Beschriftungen der drei Profile — einzige Textquelle der Oberfläche. */
export const STACK_PROFILE_META: Record<StackProfileName, { label: string; help: string }> = {
  test: {
    label: 'Test-Stack',
    help: 'Läuft ab Beginn der Phase „implement" und bleibt stehen. Genau die Dienste, die die Testsuite braucht.',
  },
  full: {
    label: 'Voller Stack',
    help: 'Fährt nur auf Anforderung aus der Testing-Lane hoch — der vollständige Stack des Features.',
  },
  down: {
    label: 'Abbau',
    help: 'Läuft bei Session-Ende, Merge und Entfernen des Worktrees. Baut einschließlich der Datenablagen ab.',
  },
};

/**
 * Hat das Projekt überhaupt einen Stack? Verlangt mindestens ein Profil mit
 * Kommando UND mindestens einen Dienst — ohne Dienstliste gäbe es weder Port
 * noch Adresse, die Lane hätte nichts zu zeigen (FR-013/FR-033).
 */
export function isStackConfigured(cfg: StackConfig): boolean {
  const anyCommand = [cfg.test, cfg.full, cfg.down].some((p) => (p?.command ?? '').trim() !== '');
  return anyCommand && cfg.services.length > 0;
}

/** Der als Haupteingang gekennzeichnete Dienst; null, wenn keiner gesetzt ist. */
export function primaryService(cfg: StackConfig): StackService | null {
  return cfg.services.find((s) => s.primary) ?? null;
}

/** Alle projektweit geteilten Dienste. */
export function sharedServices(cfg: StackConfig): StackService[] {
  return cfg.services.filter((s) => s.scope === 'shared');
}

export type LaneAction = 'up' | 'stop' | 'restart' | 'down';

/** Ein auszuführendes Kommando mit dem Profil, das dem Lauf mitgeteilt wird. */
export interface StackCommandStep {
  /** Wert von $SDD_PROFILE für diesen Lauf (FR-018). */
  profile: StackProfileName;
  /** Feature-eigenes Kommando. */
  command: string;
  /** Geteiltes Kommando dieses Schrittes; null = keines hinterlegt. */
  sharedCommand: string | null;
  timeoutMs: number | null;
}

/**
 * Welche Kommandos gehören zu einer Lane-Aktion? Reine Auswahl — OB das geteilte
 * Kommando wirklich läuft, entscheidet das Toolkit erst zur Laufzeit anhand der
 * übrigen Features und der Erreichbarkeit (FR-022, research E7).
 *
 * `null` bedeutet: die Aktion ist nicht möglich; der Grund steht in
 * {@link laneActionBlockReason}.
 */
export function profilesForLaneAction(
  cfg: StackConfig,
  action: LaneAction,
  upProfile: Extract<StackProfileName, 'test' | 'full'> = 'full',
): StackCommandStep[] | null {
  const step = (name: StackProfileName, p: StackProfile | null): StackCommandStep | null =>
    p && p.command.trim() !== ''
      ? { profile: name, command: p.command, sharedCommand: p.sharedCommand, timeoutMs: p.timeoutMs }
      : null;

  const up = step(upProfile, cfg[upProfile]);
  const down = step('down', cfg.down);
  const stop: StackCommandStep | null =
    cfg.stopCommand && cfg.stopCommand.trim() !== ''
      ? { profile: 'down', command: cfg.stopCommand, sharedCommand: null, timeoutMs: null }
      : null;

  switch (action) {
    case 'up':
      return up ? [up] : null;
    case 'stop':
      return stop ? [stop] : null;
    case 'down':
      return down ? [down] : null;
    case 'restart': {
      // Ohne Anhalte-Kommando ist ein Neustart Abbau + Aufbau — das entfernt die
      // Datenablagen. Die Oberfläche muss das vorher ausdrücklich nennen.
      const first = stop ?? down;
      return first && up ? [first, up] : null;
    }
  }
}

/** Warum ist eine Lane-Aktion nicht möglich? null = sie ist möglich. */
export function laneActionBlockReason(cfg: StackConfig, action: LaneAction): string | null {
  if (!isStackConfigured(cfg)) {
    return 'Kein Stack konfiguriert — Profile in den Projekt-Einstellungen hinterlegen.';
  }
  if (action === 'stop' && !(cfg.stopCommand ?? '').trim()) {
    return 'Kein Kommando zum Anhalten hinterlegt — nur Abbauen ist möglich.';
  }
  return profilesForLaneAction(cfg, action) === null
    ? 'Für dieses Profil ist kein Kommando hinterlegt.'
    : null;
}

/** Entfernt ein Neustart die Datenablagen, weil kein Anhalte-Kommando hinterlegt ist? */
export function restartDropsData(cfg: StackConfig): boolean {
  return !(cfg.stopCommand ?? '').trim();
}

/**
 * Prüft eine Konfiguration. Die Sätze sind der Vertrag zwischen Route (400) und
 * Oberfläche (Feldfehler) — sie werden wortgleich angezeigt.
 */
export function validateStackConfig(cfg: StackConfig, span: number): string[] {
  const errors: string[] = [];

  for (const name of ['test', 'full', 'down'] as const) {
    const p = cfg[name];
    if (p !== null && p.command.trim() === '') errors.push('Kommando darf nicht leer sein.');
  }

  for (const s of cfg.services) {
    if (!Number.isInteger(s.portOffset) || s.portOffset < 0 || s.portOffset >= span) {
      errors.push(`Abstand muss zwischen 0 und ${span - 1} liegen.`);
      break;
    }
  }

  const offsets = cfg.services.map((s) => s.portOffset);
  if (new Set(offsets).size !== offsets.length) {
    errors.push('Zwei Dienste können nicht denselben Abstand haben.');
  }

  if (cfg.services.filter((s) => s.primary).length > 1) {
    errors.push('Genau ein Dienst ist der Haupteingang.');
  }

  if (cfg.services.some((s) => s.stateful && s.scope === 'shared')) {
    errors.push('Ein zustandsbehafteter Dienst muss feature-eigen laufen.');
  }

  const hasShared = cfg.services.some((s) => s.scope === 'shared');
  const anySharedCommand = [cfg.test, cfg.full, cfg.down].some((p) => (p?.sharedCommand ?? '').trim() !== '');
  if (anySharedCommand && !hasShared) {
    errors.push('Kein Dienst ist als geteilt gekennzeichnet.');
  }

  return errors;
}

/**
 * Liest die in `projects.stack` abgelegte JSON-Konfiguration. Unbekannte oder
 * kaputte Werte ergeben „kein Stack" statt eines Wurfs: eine fehlerhafte
 * Konfiguration darf den Server nicht am Starten hindern (FR-013).
 */
export function parseStackConfig(raw: unknown): StackConfig {
  const o = typeof raw === 'string' ? safeJson(raw) : raw;
  if (o === null || typeof o !== 'object') return EMPTY_STACK_CONFIG;
  const rec = o as Record<string, unknown>;
  return {
    test: parseProfile(rec.test),
    full: parseProfile(rec.full),
    down: parseProfile(rec.down),
    stopCommand: typeof rec.stopCommand === 'string' && rec.stopCommand !== '' ? rec.stopCommand : null,
    services: Array.isArray(rec.services) ? rec.services.map(parseService).filter((s): s is StackService => s !== null) : [],
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseProfile(raw: unknown): StackProfile | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.command !== 'string') return null;
  return {
    command: r.command,
    sharedCommand: typeof r.sharedCommand === 'string' && r.sharedCommand !== '' ? r.sharedCommand : null,
    timeoutMs: typeof r.timeoutMs === 'number' && r.timeoutMs > 0 ? r.timeoutMs : null,
  };
}

function parseService(raw: unknown): StackService | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.trim() === '') return null;
  return {
    name: r.name,
    portOffset: typeof r.portOffset === 'number' ? r.portOffset : 0,
    scope: r.scope === 'shared' ? 'shared' : 'feature',
    stateful: r.stateful === true,
    primary: r.primary === true,
  };
}
