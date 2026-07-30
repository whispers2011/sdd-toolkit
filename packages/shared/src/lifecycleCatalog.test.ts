import { describe, expect, it } from 'vitest';
import { FEATURE_PHASES } from './types.js';
import type { FeaturePhase, IntegrationStage } from './types.js';
import {
  INTEGRATION_STAGE_ORIGIN,
  LIFECYCLE_CATALOG,
  LIFECYCLE_STAGES,
  PHASE_LIFECYCLE_STAGES,
  lifecycleStage,
  orderedLifecycleStages,
  type LifecycleCatalogStageId,
} from './lifecycleCatalog.js';

/**
 * Vollständigkeits- und Drift-Guard des Lebenszyklus-Katalogs (FR-011).
 *
 * Der Katalog ist reine Prosa über Code — kein Test kann prüfen, dass eine
 * Beschreibung STIMMT. Prüfbar ist aber, dass sie da ist, nicht leer ist, in
 * der Länge bleibt, dass keine Stufe und keine Domänen-Aufzählung fehlt und
 * dass die fragile Reihenfolge der Integration erhalten bleibt. Die Existenz
 * der genannten Code-Orte prüft lifecycleCatalogPaths.test.ts in @sdd/server
 * (dort ist Dateisystem-Zugriff zu Hause — @sdd/shared bleibt node-frei).
 */

const NAME_MAX = 60;
const DESCRIPTION_MAX = 400;

/** Jeder Schritt mit seiner Stufe — Basis der meisten Prüfungen. */
const allSteps = orderedLifecycleStages().flatMap((stage) =>
  stage.steps.map((step) => ({ stage, step, where: `${stage.title} → ${step.name}` })),
);

describe('LIFECYCLE_CATALOG deckt alle Stufen ab', () => {
  it('hat für jede LifecycleCatalogStageId einen Eintrag, dessen id dem Schlüssel entspricht', () => {
    for (const id of LIFECYCLE_STAGES) {
      const stage = LIFECYCLE_CATALOG[id];
      expect(stage, `Katalogeintrag fehlt für ${id}`).toBeDefined();
      expect(stage.id, `id des Eintrags '${id}' weicht vom Schlüssel ab`).toBe(id);
    }
  });

  it('kennt genau die fünf Stufen des Lebenszyklus in ihrer Reihenfolge', () => {
    expect([...LIFECYCLE_STAGES]).toEqual([
      'worktree_create',
      'phase_start',
      'phase_end',
      'integration',
      'merge',
    ]);
    expect(Object.keys(LIFECYCLE_CATALOG).sort()).toEqual([...LIFECYCLE_STAGES].sort());
  });

  it('hat je Stufe mindestens einen Schritt (eine leere Stufe ist ein Fehler, kein Leerzustand)', () => {
    for (const stage of orderedLifecycleStages()) {
      expect(stage.steps.length, `Stufe '${stage.title}' hat keinen Schritt`).toBeGreaterThan(0);
    }
  });

  it('trägt je Stufe nicht-leeren Titel und Einordnungssatz', () => {
    for (const stage of orderedLifecycleStages()) {
      expect(stage.title.trim().length, `title leer bei '${stage.id}'`).toBeGreaterThan(0);
      expect(stage.when.trim().length, `when leer bei '${stage.id}'`).toBeGreaterThan(0);
    }
  });
});

describe('Schritte des Katalogs sind vollständig beschrieben', () => {
  it('hat je Schritt nicht-leeren Namen, Beschreibung, Auslöser und Code-Ort', () => {
    for (const { step, where } of allSteps) {
      expect(step.id.trim().length, `id leer bei '${where}'`).toBeGreaterThan(0);
      expect(step.name.trim().length, `name leer bei '${where}'`).toBeGreaterThan(0);
      expect(step.description.trim().length, `description leer bei '${where}'`).toBeGreaterThan(0);
      expect(step.trigger.trim().length, `trigger leer bei '${where}'`).toBeGreaterThan(0);
      expect(step.location.file.trim().length, `location.file leer bei '${where}'`).toBeGreaterThan(0);
      expect(step.location.symbol.trim().length, `location.symbol leer bei '${where}'`).toBeGreaterThan(0);
    }
  });

  it('hält Name und Beschreibung in der Längengrenze (Lesbarkeits-Guard)', () => {
    for (const { step, where } of allSteps) {
      expect(step.name.length, `name zu lang bei '${where}' (${step.name.length} > ${NAME_MAX})`).toBeLessThanOrEqual(
        NAME_MAX,
      );
      expect(
        step.description.length,
        `description zu lang bei '${where}' (${step.description.length} > ${DESCRIPTION_MAX})`,
      ).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it('lässt gesetzte optionale Felder nie leer', () => {
    for (const { stage, step, where } of allSteps) {
      if (step.orderNote !== undefined) {
        expect(step.orderNote.trim().length, `orderNote leer bei '${where}'`).toBeGreaterThan(0);
      }
      if (step.condition !== undefined) {
        expect(step.condition.trim().length, `condition leer bei '${where}'`).toBeGreaterThan(0);
      }
      if (stage.notDoneHere !== undefined) {
        expect(stage.notDoneHere.trim().length, `notDoneHere leer bei '${stage.title}'`).toBeGreaterThan(0);
      }
    }
  });

  it('hat je Stufe eindeutige Schritt-ids (sie sind React-Keys)', () => {
    for (const stage of orderedLifecycleStages()) {
      const ids = stage.steps.map((s) => s.id);
      expect(new Set(ids).size, `doppelte Schritt-id in '${stage.title}': ${ids.join(', ')}`).toBe(ids.length);
    }
  });

  it('führt Code-Orte als repo-relativen Pfad ohne Zeilenangabe (FR-012)', () => {
    for (const { step, where } of allSteps) {
      const file = step.location.file;
      expect(file.startsWith('packages/'), `'${where}': Pfad beginnt nicht mit packages/ (${file})`).toBe(true);
      expect(/\.tsx?$/.test(file), `'${where}': Pfad endet nicht auf .ts/.tsx (${file})`).toBe(true);
      expect(/:\d/.test(file), `'${where}': Pfad enthält eine Zeilenangabe (${file})`).toBe(false);
    }
  });
});

describe('Katalog bleibt an die Domäne gebunden (Drift-Guard, FR-010)', () => {
  it('kennt jede Feature-Phase mit existierenden, nicht-leeren Stufen', () => {
    for (const phase of FEATURE_PHASES) {
      const stages: readonly LifecycleCatalogStageId[] = PHASE_LIFECYCLE_STAGES[phase satisfies FeaturePhase];
      expect(stages, `PHASE_LIFECYCLE_STAGES fehlt für '${phase}'`).toBeDefined();
      expect(stages.length, `keine Stufe für Phase '${phase}'`).toBeGreaterThan(0);
      for (const id of stages) {
        expect(LIFECYCLE_CATALOG[id], `Phase '${phase}' verweist auf unbekannte Stufe '${id}'`).toBeDefined();
        expect(LIFECYCLE_CATALOG[id].steps.length, `Stufe '${id}' (Phase '${phase}') hat keinen Schritt`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('ordnet jede Integrations-Stufe einer beschreibenden Lebenszyklus-Stufe zu (oder ausdrücklich keiner)', () => {
    const stages = Object.keys(INTEGRATION_STAGE_ORIGIN) as IntegrationStage[];
    for (const stage of stages) {
      const origin = INTEGRATION_STAGE_ORIGIN[stage];
      expect(origin !== undefined, `INTEGRATION_STAGE_ORIGIN fehlt für '${stage}'`).toBe(true);
      if (origin !== null) {
        expect(LIFECYCLE_CATALOG[origin], `'${stage}' verweist auf unbekannte Stufe '${origin}'`).toBeDefined();
      }
    }
    // Der Ruhezustand entsteht durch keinen Ablauf — bewusst null.
    expect(INTEGRATION_STAGE_ORIGIN.none).toBeNull();
    expect(INTEGRATION_STAGE_ORIGIN.merged).toBe('merge');
  });
});

describe('Stufe „Integration" hält die geforderte Schrittfolge (FR-007)', () => {
  const steps = lifecycleStage('integration').steps;
  const indexOf = (fragment: string): number => {
    const i = steps.findIndex((s) => s.name.toLowerCase().includes(fragment.toLowerCase()));
    expect(i, `Integrations-Schritt mit '${fragment}' im Namen fehlt`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it('bildet Vorprüfungen → Festschreiben → Abgleich → Verify → Review-Gate → Berichte → Übergabe ab', () => {
    const order = [
      indexOf('Vorprüfungen'),
      indexOf('Worktree festschreiben'),
      indexOf('Zustand mit Git abgleichen'),
      indexOf('Verify-Kommandos'),
      indexOf('Review-Gate-Agents'),
      indexOf('Review-Berichte committen'),
      indexOf('Übergabe'),
    ];
    expect(order, `Reihenfolge weicht ab: ${steps.map((s) => s.name).join(' → ')}`).toEqual(
      [...order].sort((a, b) => a - b),
    );
  });

  it('stellt „Worktree festschreiben" VOR den Git-Abgleich', () => {
    expect(indexOf('Worktree festschreiben')).toBeLessThan(indexOf('Zustand mit Git abgleichen'));
  });
});

describe('Fragiles Wissen bleibt festgehalten (FR-009, FR-004)', () => {
  it('begründet am Schritt „Worktree festschreiben" die Voranstellung und die Folge ihrer Umkehrung', () => {
    const step = lifecycleStage('integration').steps.find((s) => s.name === 'Worktree festschreiben');
    expect(step, 'Integrations-Schritt „Worktree festschreiben" fehlt').toBeDefined();
    const note = step?.orderNote ?? '';
    expect(note.trim().length, 'orderNote an „Worktree festschreiben" fehlt oder ist leer').toBeGreaterThan(0);
    // Voranstellung UND Konsequenz — die Zahl allein verhindert den Rückschritt nicht.
    expect(/vor dem git-abgleich/i.test(note), `orderNote nennt den Git-Abgleich nicht: ${note}`).toBe(true);
    expect(/eskali/i.test(note), `orderNote nennt die Eskalations-Folge nicht: ${note}`).toBe(true);
    expect(/gemergt/i.test(note), `orderNote nennt das falsche „bereits gemergt" nicht: ${note}`).toBe(true);
  });

  it('hält an der Stufe „Worktree-Anlage" fest, dass Abhängigkeiten nicht installiert werden', () => {
    const notDoneHere = lifecycleStage('worktree_create').notDoneHere ?? '';
    expect(notDoneHere.trim().length, 'notDoneHere an der Worktree-Anlage fehlt oder ist leer').toBeGreaterThan(0);
    expect(
      /abhängigkeit/i.test(notDoneHere),
      `notDoneHere nennt die Abhängigkeiten nicht: ${notDoneHere}`,
    ).toBe(true);
  });

  it('begründet die serialisierte Anlage und die Startmarke vor dem Reset', () => {
    const serialize = lifecycleStage('worktree_create').steps[0];
    expect(serialize?.orderNote?.trim().length ?? 0, 'orderNote an der Serialisierung fehlt').toBeGreaterThan(0);

    const mark = lifecycleStage('phase_start').steps.find((s) => s.id === 'transcript-start-mark');
    expect(mark?.orderNote?.trim().length ?? 0, 'orderNote an der Transkript-Startmarke fehlt').toBeGreaterThan(0);

    const resetTurn = lifecycleStage('phase_end').steps[0];
    expect(resetTurn?.orderNote?.trim().length ?? 0, 'orderNote am Reset-Turn fehlt').toBeGreaterThan(0);
  });
});

describe('Helfer', () => {
  it('lifecycleStage ist total — jede Stufen-id liefert ihren Eintrag', () => {
    for (const id of LIFECYCLE_STAGES) {
      expect(lifecycleStage(id).id).toBe(id);
    }
  });

  it('orderedLifecycleStages liefert alle Stufen in Lebenszyklus-Reihenfolge', () => {
    expect(orderedLifecycleStages().map((s) => s.id)).toEqual([...LIFECYCLE_STAGES]);
  });
});
