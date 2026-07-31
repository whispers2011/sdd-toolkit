import { describe, expect, it } from 'vitest';
import {
  EMPTY_STACK_CONFIG,
  STACK_PROFILE_META,
  isStackConfigured,
  laneActionBlockReason,
  parseStackConfig,
  primaryService,
  profilesForLaneAction,
  restartDropsData,
  sharedServices,
  validateStackConfig,
} from './stackProfiles.js';
import { STACK_PROFILE_NAMES, type StackConfig, type StackService } from './types.js';

function svc(patch: Partial<StackService> = {}): StackService {
  return { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: false, ...patch };
}

function cfg(patch: Partial<StackConfig> = {}): StackConfig {
  return {
    test: { command: 'up-test', sharedCommand: null, timeoutMs: null },
    full: { command: 'up-full', sharedCommand: null, timeoutMs: null },
    down: { command: 'tear-down', sharedCommand: null, timeoutMs: null },
    stopCommand: 'halt',
    services: [svc({ name: 'web', portOffset: 0, primary: true }), svc({ name: 'api', portOffset: 1 })],
    ...patch,
  };
}

describe('STACK_PROFILE_META', () => {
  it('beantwortet jedes der drei Profile', () => {
    for (const name of STACK_PROFILE_NAMES) {
      expect(STACK_PROFILE_META[name].label, `Beschriftung fehlt für ${name}`).toBeTruthy();
      expect(STACK_PROFILE_META[name].help, `Hilfetext fehlt für ${name}`).toBeTruthy();
    }
  });
});

describe('isStackConfigured', () => {
  it('ist ohne Konfiguration falsch — das Toolkit bringt keine Kommandos mit (FR-012)', () => {
    expect(isStackConfigured(EMPTY_STACK_CONFIG)).toBe(false);
  });

  it('ist mit Kommando und Dienstliste wahr', () => {
    expect(isStackConfigured(cfg())).toBe(true);
  });

  /** Ohne Dienstliste gäbe es weder Port noch Adresse — die Lane hätte nichts zu zeigen. */
  it('ist ohne Dienstliste falsch, auch mit Kommandos', () => {
    expect(isStackConfigured(cfg({ services: [] }))).toBe(false);
  });

  it('ist ohne jedes Kommando falsch, auch mit Dienstliste', () => {
    expect(isStackConfigured(cfg({ test: null, full: null, down: null }))).toBe(false);
  });

  it('wertet ein Kommando aus Leerzeichen als nicht konfiguriert', () => {
    const only = cfg({
      test: { command: '   ', sharedCommand: null, timeoutMs: null },
      full: null,
      down: null,
    });
    expect(isStackConfigured(only)).toBe(false);
  });
});

describe('primaryService / sharedServices', () => {
  it('findet den Haupteingang', () => {
    expect(primaryService(cfg())?.name).toBe('web');
  });

  it('liefert null, wenn keiner gekennzeichnet ist', () => {
    expect(primaryService(cfg({ services: [svc({ name: 'api', portOffset: 1 })] }))).toBeNull();
  });

  it('sammelt die geteilten Dienste', () => {
    const c = cfg({
      services: [svc({ name: 'web', primary: true }), svc({ name: 'mail', portOffset: 5, scope: 'shared' })],
    });
    expect(sharedServices(c).map((s) => s.name)).toEqual(['mail']);
  });
});

describe('profilesForLaneAction', () => {
  it('Starten führt das full-Kommando aus und meldet Profil `full`', () => {
    const steps = profilesForLaneAction(cfg(), 'up');
    expect(steps).toEqual([
      { profile: 'full', command: 'up-full', sharedCommand: null, timeoutMs: null },
    ]);
  });

  it('Starten kann ausdrücklich das test-Profil meinen (Beginn von implement)', () => {
    expect(profilesForLaneAction(cfg(), 'up', 'test')?.[0]).toMatchObject({
      profile: 'test',
      command: 'up-test',
    });
  });

  /** Anhalten behält die Daten, meldet dem Kommando aber `down` (contracts §1). */
  it('Stoppen führt das Anhalte-Kommando mit Profil `down` aus', () => {
    expect(profilesForLaneAction(cfg(), 'stop')).toEqual([
      { profile: 'down', command: 'halt', sharedCommand: null, timeoutMs: null },
    ]);
  });

  it('Abbauen führt das down-Kommando aus', () => {
    expect(profilesForLaneAction(cfg(), 'down')?.[0]).toMatchObject({ profile: 'down', command: 'tear-down' });
  });

  it('Neustarten ist Anhalten, dann Starten', () => {
    expect(profilesForLaneAction(cfg(), 'restart')?.map((s) => s.command)).toEqual(['halt', 'up-full']);
  });

  /** Ohne Anhalte-Kommando wird der Neustart zu Abbau + Aufbau — die Daten sind weg. */
  it('Neustarten ohne Anhalte-Kommando wird zu Abbau und Aufbau', () => {
    const c = cfg({ stopCommand: null });
    expect(profilesForLaneAction(c, 'restart')?.map((s) => s.command)).toEqual(['tear-down', 'up-full']);
    expect(restartDropsData(c)).toBe(true);
  });

  it('meldet mit Anhalte-Kommando keinen Datenverlust beim Neustart', () => {
    expect(restartDropsData(cfg())).toBe(false);
  });

  it('reicht das geteilte Kommando und das Zeitlimit des Profils durch', () => {
    const c = cfg({ full: { command: 'up-full', sharedCommand: 'up-shared', timeoutMs: 60_000 } });
    expect(profilesForLaneAction(c, 'up')?.[0]).toMatchObject({
      sharedCommand: 'up-shared',
      timeoutMs: 60_000,
    });
  });

  it('liefert null, wenn das Profil kein Kommando hat', () => {
    expect(profilesForLaneAction(cfg({ full: null }), 'up')).toBeNull();
    expect(profilesForLaneAction(cfg({ down: null }), 'down')).toBeNull();
    expect(profilesForLaneAction(cfg({ stopCommand: null }), 'stop')).toBeNull();
  });
});

describe('laneActionBlockReason', () => {
  it('nennt ohne Konfiguration die fehlenden Profile (FR-013/FR-033)', () => {
    for (const action of ['up', 'stop', 'restart', 'down'] as const) {
      expect(laneActionBlockReason(EMPTY_STACK_CONFIG, action)).toBe(
        'Kein Stack konfiguriert — Profile in den Projekt-Einstellungen hinterlegen.',
      );
    }
  });

  it('nennt beim Stoppen das fehlende Anhalte-Kommando', () => {
    expect(laneActionBlockReason(cfg({ stopCommand: null }), 'stop')).toBe(
      'Kein Kommando zum Anhalten hinterlegt — nur Abbauen ist möglich.',
    );
  });

  it('nennt ein fehlendes Profilkommando', () => {
    expect(laneActionBlockReason(cfg({ full: null }), 'up')).toBe(
      'Für dieses Profil ist kein Kommando hinterlegt.',
    );
  });

  it('gibt die Aktion frei, wenn alles hinterlegt ist', () => {
    for (const action of ['up', 'stop', 'restart', 'down'] as const) {
      expect(laneActionBlockReason(cfg(), action)).toBeNull();
    }
  });
});

describe('validateStackConfig', () => {
  it('nimmt eine gültige Konfiguration ohne Beanstandung an', () => {
    expect(validateStackConfig(cfg(), 20)).toEqual([]);
  });

  it('weist einen Abstand außerhalb der Blockbreite zurück', () => {
    const c = cfg({ services: [svc({ portOffset: 20 })] });
    expect(validateStackConfig(c, 20)).toContain('Abstand muss zwischen 0 und 19 liegen.');
  });

  it('weist einen negativen Abstand zurück', () => {
    expect(validateStackConfig(cfg({ services: [svc({ portOffset: -1 })] }), 20)).toContain(
      'Abstand muss zwischen 0 und 19 liegen.',
    );
  });

  it('weist doppelte Abstände zurück', () => {
    const c = cfg({ services: [svc({ name: 'a', portOffset: 1 }), svc({ name: 'b', portOffset: 1 })] });
    expect(validateStackConfig(c, 20)).toContain('Zwei Dienste können nicht denselben Abstand haben.');
  });

  it('lässt höchstens einen Haupteingang zu', () => {
    const c = cfg({
      services: [svc({ name: 'a', portOffset: 0, primary: true }), svc({ name: 'b', portOffset: 1, primary: true })],
    });
    expect(validateStackConfig(c, 20)).toContain('Genau ein Dienst ist der Haupteingang.');
  });

  /** FR-021: zwei Features müssen unabhängige Datenbestände haben. */
  it('verbietet einen zustandsbehafteten geteilten Dienst (FR-021)', () => {
    const c = cfg({ services: [svc({ name: 'db', portOffset: 2, scope: 'shared', stateful: true })] });
    expect(validateStackConfig(c, 20)).toContain('Ein zustandsbehafteter Dienst muss feature-eigen laufen.');
  });

  it('verlangt zu einem geteilten Kommando mindestens einen geteilten Dienst', () => {
    const c = cfg({ full: { command: 'up-full', sharedCommand: 'up-shared', timeoutMs: null } });
    expect(validateStackConfig(c, 20)).toContain('Kein Dienst ist als geteilt gekennzeichnet.');
  });

  it('nimmt ein geteiltes Kommando mit geteiltem Dienst an', () => {
    const c = cfg({
      full: { command: 'up-full', sharedCommand: 'up-shared', timeoutMs: null },
      services: [svc({ name: 'web', primary: true }), svc({ name: 'mail', portOffset: 5, scope: 'shared' })],
    });
    expect(validateStackConfig(c, 20)).toEqual([]);
  });

  it('weist ein leeres Kommando eines gesetzten Profils zurück', () => {
    const c = cfg({ test: { command: '  ', sharedCommand: null, timeoutMs: null } });
    expect(validateStackConfig(c, 20)).toContain('Kommando darf nicht leer sein.');
  });

  it('nimmt die leere Konfiguration an — sie bedeutet „kein Stack" (FR-013)', () => {
    expect(validateStackConfig(EMPTY_STACK_CONFIG, 20)).toEqual([]);
  });
});

describe('parseStackConfig', () => {
  it("liest '{}' als „kein Stack\"", () => {
    expect(parseStackConfig('{}')).toEqual(EMPTY_STACK_CONFIG);
  });

  it('liest eine vollständige Konfiguration', () => {
    const raw = JSON.stringify(cfg());
    expect(parseStackConfig(raw)).toEqual(cfg());
  });

  /** Eine kaputte Konfiguration darf den Server nicht am Starten hindern. */
  it('ergibt bei kaputtem JSON „kein Stack" statt eines Wurfs', () => {
    expect(parseStackConfig('{nicht json')).toEqual(EMPTY_STACK_CONFIG);
    expect(parseStackConfig(null)).toEqual(EMPTY_STACK_CONFIG);
    expect(parseStackConfig(42)).toEqual(EMPTY_STACK_CONFIG);
  });

  it('verwirft einen Dienst ohne Namen statt ihn halb zu übernehmen', () => {
    const parsed = parseStackConfig(JSON.stringify({ services: [{ portOffset: 1 }, { name: 'api', portOffset: 2 }] }));
    expect(parsed.services.map((s) => s.name)).toEqual(['api']);
  });

  it('setzt fehlende Dienstangaben auf die sichere Vorgabe', () => {
    const parsed = parseStackConfig(JSON.stringify({ services: [{ name: 'api' }] }));
    expect(parsed.services[0]).toEqual({
      name: 'api',
      portOffset: 0,
      scope: 'feature',
      stateful: false,
      primary: false,
    });
  });

  it('behandelt ein leeres geteiltes Kommando wie keines', () => {
    const parsed = parseStackConfig(JSON.stringify({ test: { command: 'x', sharedCommand: '' } }));
    expect(parsed.test?.sharedCommand).toBeNull();
  });
});
