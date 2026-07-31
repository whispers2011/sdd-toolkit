import {
  METERING_CONFLICT_MIN_FACTOR,
  decideFinding,
  falseStartMessage,
  isPhaseFalseStart,
  isProjectWithoutRuns,
  isUnpricedRun,
  meteringConflictMessage,
  projectWithoutRunsMessage,
  unpricedMessage,
  type AttentionItem,
  type AttentionKind,
  type ExecutionRecord,
  type FalseStartExample,
  type UnpricedExample,
} from '@sdd/shared';
import type {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  TelemetryUpdateOutcome,
} from '../db/repos.js';
import type { PlausibilityRepo } from '../db/plausibilityRepo.js';
import { TELEMETRY_GRACE_MS } from '../telemetry/telemetryStore.js';
import { bus } from '../events.js';

export interface PlausibilityDeps {
  executions: ExecutionRepo;
  features: FeatureRepo;
  projects: ProjectRepo;
  attention: AttentionRepo;
  state: PlausibilityRepo;
  /** Endgültigkeitsfenster; Default `TELEMETRY_GRACE_MS`. Test-Naht. */
  graceMs?: number;
}

/**
 * Plausibilitätsprüfung gemessener Läufe — beurteilt, greift NIE ein.
 *
 * Geschrieben wird ausschliesslich in `attention` und `plausibility_state`;
 * `executions`, `features` und `projects` werden nur gelesen (SC-007).
 *
 * `check()` ist der EINZIGE Prüfpfad: Laufabschluss (FR-001), Serverstart und
 * Minutentakt (FR-002) rufen dieselbe vollständige Beurteilung. Damit ist
 * „zehn Prüfungen ⇒ nicht mehr Meldungen als eine" (SC-004) eine strukturelle
 * Eigenschaft und keine Regel, die zwei Pfade unabhängig einhalten müssten.
 *
 * Die öffentlichen Methoden werfen unter keinen Umständen (FR-003, SC-006):
 * eine Beurteilung darf einen Laufabschluss nicht zum Scheitern bringen.
 */
export class PlausibilityService {
  private readonly graceMs: number;

  constructor(private deps: PlausibilityDeps) {
    this.graceMs = deps.graceMs ?? TELEMETRY_GRACE_MS;
  }

  check(now: number = Date.now()): void {
    try {
      const runs = this.deps.executions.listAll();
      const open = this.deps.attention.listOpen();
      this.checkUnpriced(runs, open, now);
      this.checkFalseStarts(runs, open, now);
      this.checkProjectsWithoutRuns(open, now);
    } catch (err) {
      console.warn('[plausibility] Prüfung fehlgeschlagen:', (err as Error).message);
    }
  }

  /**
   * Befund D — ereignisgetrieben aus dem Ablehnungspfad von `updateTelemetry` (FR-010).
   *
   * KEIN Wasserstand: D ist ein Ereignis, kein Bestand. Es gibt keine Anzahl, die
   * wachsen könnte, und die Ablehnung ist aus den Daten nicht rekonstruierbar. Nach
   * dem Auflösen meldet der nächste abgelehnte Nachtrag wieder — richtig, denn das
   * ist ein neues Ereignis (research.md D10).
   */
  reportMeteringConflict(
    run: { id: string; projectId: string; featureId: string | null },
    outcome: Extract<TelemetryUpdateOutcome, { applied: false }>,
  ): void {
    try {
      if (outcome.rejection !== 'lowered') return;
      if (outcome.factor < METERING_CONFLICT_MIN_FACTOR) return;

      // FR-013: höchstens eine offene Meldung je Befund und Bezugsobjekt. `raise()`
      // dedupliziert ohnehin — diese Prüfung verhindert zusätzlich das Bus-Ereignis.
      const schonOffen = this.deps.attention
        .listOpen()
        .some(
          (i) =>
            i.kind === 'metering_conflict' &&
            i.projectId === run.projectId &&
            (i.featureId ?? null) === run.featureId,
        );
      if (schonOffen) return;

      const item = this.deps.attention.raise({
        kind: 'metering_conflict',
        projectId: run.projectId,
        featureId: run.featureId,
        message: meteringConflictMessage(run.id, outcome.existingTokens, outcome.rejectedTokens, outcome.factor),
      });
      bus.emitEvent('attention_raised', item);
    } catch (err) {
      console.warn('[plausibility] Meldung des Mess-Widerspruchs fehlgeschlagen:', (err as Error).message);
    }
  }

  // ---------- Befund A: gemessen, aber nicht bepreist ----------

  /**
   * Bezugsobjekt ist das PROJEKT: Läufe archivierter und gelöschter Features zählen
   * mit — ein unbekannter Preis bleibt unbekannt, auch wenn das Feature abgeschlossen
   * ist (research.md D6). Iteriert wird über ALLE Projekte, damit ein verschwundener
   * Befund seine Marke verliert (`clear`) statt sie dauerhaft sperren zu lassen.
   */
  private checkUnpriced(runs: ExecutionRecord[], open: AttentionItem[], now: number): void {
    const betroffen = new Map<string, ExecutionRecord[]>();
    for (const r of runs) {
      if (!isUnpricedRun(r, now, this.graceMs)) continue;
      const liste = betroffen.get(r.projectId);
      if (liste) liste.push(r);
      else betroffen.set(r.projectId, [r]);
    }

    const featureName = this.featureNames();
    for (const project of this.deps.projects.list()) {
      const treffer = betroffen.get(project.id) ?? [];
      this.applyFinding('run_unpriced', project.id, null, treffer.length, open, now, () => {
        // Beispiel = der Lauf mit der grössten Tokenzahl: deterministisch (FR-015)
        // und zugleich der auffälligste Fall des Bündels.
        const auffaellig = treffer.reduce((a, b) => ((b.tokens ?? 0) > (a.tokens ?? 0) ? b : a));
        const beispiel: UnpricedExample = {
          featureName: auffaellig.featureId ? (featureName.get(auffaellig.featureId) ?? null) : null,
          phase: auffaellig.phase,
          kind: auffaellig.kind,
          tokens: auffaellig.tokens ?? 0,
        };
        return unpricedMessage(treffer.length, beispiel);
      });
    }
  }

  // ---------- Befund B: Fehlstart statt Fehlschlag ----------

  /**
   * Bezugsobjekt ist das FEATURE, und zwar nur ein nicht archiviertes: ein Fehlstart
   * eines abgeschlossenen Features ist nichts, was noch jemand tun kann (research.md
   * D6 — bewusste Verengung von FR-006, umkehrbar über `listByProject(id, true)`).
   */
  private checkFalseStarts(runs: ExecutionRecord[], open: AttentionItem[], now: number): void {
    const aktiv = this.deps.features.listAll();
    const betroffen = new Map<string, ExecutionRecord[]>();
    for (const r of runs) {
      if (!r.featureId || !isPhaseFalseStart(r)) continue;
      const liste = betroffen.get(r.featureId);
      if (liste) liste.push(r);
      else betroffen.set(r.featureId, [r]);
    }

    for (const feature of aktiv) {
      const treffer = betroffen.get(feature.id) ?? [];
      this.applyFinding('phase_false_start', feature.projectId, feature.id, treffer.length, open, now, () => {
        const dauern = treffer.map((r) => (r.finishedAt ?? r.startedAt) - r.startedAt);
        // Beispiel = der KÜRZESTE Fehlstart: der Fall, der am deutlichsten zeigt,
        // dass die Phase nie anlief.
        const kuerzester = treffer.reduce((a, b) =>
          (b.finishedAt ?? b.startedAt) - b.startedAt < (a.finishedAt ?? a.startedAt) - a.startedAt ? b : a,
        );
        const beispiel: FalseStartExample = {
          phase: kuerzester.phase,
          minMs: Math.min(...dauern),
          maxMs: Math.max(...dauern),
          exitCode: kuerzester.exitCode ?? 0,
        };
        return falseStartMessage(treffer.length, feature.name, beispiel);
      });
    }
  }

  // ---------- Befund C: Projekt mit Features, aber ohne Lauf ----------

  /**
   * Der einzige Befund, der sich NICHT am Abschluss eines Laufs aufhängen lässt:
   * in einem solchen Projekt endet per Definition nie ein Lauf. Er lebt allein von
   * der regelmässigen Bestandsprüfung (FR-002).
   *
   * Wasserstand ist die Anzahl aktiver Features — kommt ein weiteres hinzu, ohne
   * dass je etwas lief, meldet der Befund erneut.
   */
  private checkProjectsWithoutRuns(open: AttentionItem[], now: number): void {
    const name = new Map(this.deps.projects.list().map((p) => [p.id, p.name]));
    for (const stats of this.deps.state.listProjectStats()) {
      const betroffen = isProjectWithoutRuns(stats, now);
      this.applyFinding(
        'project_without_runs',
        stats.projectId,
        null,
        betroffen ? stats.activeFeatures : 0,
        open,
        now,
        () =>
          projectWithoutRunsMessage(
            name.get(stats.projectId) ?? stats.projectId,
            stats.activeFeatures,
            now - (stats.newestFeatureAt ?? now),
          ),
      );
    }
  }

  // ---------- Wasserstand ----------

  /**
   * Ein Befund, ein Bezugsobjekt: melden, Marke nachziehen, schweigen oder Marke
   * löschen. Der Meldungstext wird erst gebaut, wenn wirklich gemeldet wird.
   */
  private applyFinding(
    kind: AttentionKind,
    projectId: string,
    featureId: string | null,
    count: number,
    open: AttentionItem[],
    now: number,
    message: () => string,
  ): void {
    const markKey = featureId ?? ''; // '' = projektweiter Befund
    const mark = this.deps.state.getMark(kind, projectId, markKey);
    const hasOpen = open.some(
      (i) => i.kind === kind && i.projectId === projectId && (i.featureId ?? null) === featureId,
    );

    switch (decideFinding(count, mark, hasOpen)) {
      case 'raise': {
        const item = this.deps.attention.raise({ kind, projectId, featureId, message: message() });
        bus.emitEvent('attention_raised', item);
        this.deps.state.setMark(kind, projectId, markKey, count, now);
        break;
      }
      case 'refresh':
        // Offene Meldung bleibt unverändert (kein stilles Text-Update — eine sich
        // ändernde Meldung wäre nicht quittierbar); nur die Marke wandert mit, damit
        // die Auflösung den Stand IN DIESEM MOMENT quittiert (FR-014).
        this.deps.state.setMark(kind, projectId, markKey, count, now);
        break;
      case 'clear':
        // Befund weg ⇒ Marke weg. Eine offene Meldung bleibt bestehen: der
        // Widerspruch war real und wird von einem Menschen quittiert.
        this.deps.state.clearMark(kind, projectId, markKey);
        break;
      case 'suppress':
        break;
    }
  }

  /** featureId → Name, nur nicht archivierte Features (dieselbe Quelle wie Befund B). */
  private featureNames(): Map<string, string> {
    return new Map(this.deps.features.listAll().map((f) => [f.id, f.name]));
  }
}
