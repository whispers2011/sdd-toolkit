import { HEARTBEAT_INTERVAL_MS, detectOutage, outageMessage } from '@sdd/shared';
import type { ExecutionRecord, OperationsEntry, OutageRecord } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo } from '../db/repos.js';
import type { HeartbeatStore } from './heartbeatStore.js';
import type { OperationsLog } from './operationsLog.js';

/**
 * So viele Protokollzeilen werden beim Start gelesen. Bei 2–4 Einträgen je Serverlauf
 * reicht das weit zurück — gebraucht werden nur der Abgang der Vorinstanz und der
 * jüngste Ausfall.
 */
const TAIL_LOOKBACK = 200;

export interface OutageMonitorDeps {
  executions: ExecutionRepo;
  attention: AttentionRepo;
  features: FeatureRepo;
  operationsLog: OperationsLog;
  heartbeatStore: HeartbeatStore;
  /** Kennung dieses Serverlaufs; verbindet `startup` mit seinem Abgang. */
  instanceId: string;
  /** Startzeitpunkt dieses Serverlaufs. */
  startedAt: number;
  /** Uhr — in Tests gesetzt, damit kein echter Absturz nötig ist (FR-025, D16). */
  now?: () => number;
}

/**
 * Hält das Lebenszeichen aktuell und wertet beim Start die Lücke aus.
 *
 * Der Dienst entscheidet selbst nichts über „Ausfall ja/nein" — das tut die reine
 * Funktion `detectOutage` in `@sdd/shared`. Hier liegen nur die Nebenwirkungen:
 * Datei lesen, Protokoll schreiben, Meldungen anlegen, Takt halten (D16).
 */
export class OutageMonitor {
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private last: OutageRecord | null = null;

  constructor(private readonly deps: OutageMonitorDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Der letzte registrierte Ausfall — auch einer aus einem früheren Lauf und auch
   * einer, der folgenlos war. Er überlebt damit das Erledigen der Meldung, was die
   * Attention-Tabelle nicht leisten kann (FR-023, D13).
   */
  get lastOutage(): OutageRecord | null {
    return this.last;
  }

  /**
   * Startarbeit in der verbindlichen Reihenfolge aus Contract C4. Wird sie vertauscht —
   * insbesondere gegenüber `orchestrator.reapOnBoot()` — zählt der Ausfall null betroffene
   * Läufe; das ist der wahrscheinlichste Regressionsfehler dieses Features (D3).
   */
  detectOnBoot(): void {
    const { operationsLog, heartbeatStore, executions, instanceId, startedAt } = this.deps;
    const now = this.now();

    operationsLog.rotateIfNeeded();
    operationsLog.append({ ts: now, instanceId, kind: 'startup', pid: process.pid });

    // Solange `status='running'` gilt: nach `reapOrphans()` sammelt `orphaned` auch
    // Altlasten früherer Starts und die Zuordnung ist zerstört.
    const running = executions.listRunning();
    const recent = operationsLog.tail(TAIL_LOOKBACK);

    const heartbeat = heartbeatStore.read();
    const detection = detectOutage({ heartbeat, now });

    let recorded: OutageRecord | null = null;
    if (detection.kind === 'outage' || detection.kind === 'undetermined') {
      const bestimmbar = detection.kind === 'outage';
      recorded = {
        from: bestimmbar ? detection.from : null,
        to: now,
        durationMs: bestimmbar ? detection.durationMs : null,
        affectedRuns: running.length,
        silent: this.warStillerAbgang(recent, heartbeat?.instanceId ?? null),
        undetermined: !bestimmbar,
      };
      operationsLog.append({ ts: now, instanceId, kind: 'outage', outage: recorded });
    }

    // Nur ein bestimmbares Fenster wird gemeldet: eine Meldung ohne Zeitfenster wäre
    // für den Nutzer wertlos und verrauschte die Inbox (D15).
    if (detection.kind === 'outage') {
      this.raisePerProject(detection.from, detection.to, detection.durationMs, running);
    }

    this.last = recorded ?? letzterAusfall(recent);

    // Zuletzt: das frische Lebenszeichen macht die Lücke unwiederholbar — ein weiterer
    // Start ohne zwischenzeitlichen Absturz meldet nichts mehr (D4, FR-009).
    heartbeatStore.write({ ts: now, instanceId, startedAt });
  }

  /** Takt starten. `unref()`, damit der Timer den Prozess nicht am Beenden hindert. */
  startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.writeHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  /**
   * Geordneter Abgang: Takt anhalten und `clean: true` vermerken. Danach ist eine Lücke
   * beliebiger Länge kein Ausfall mehr (FR-002).
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.deps.heartbeatStore.markClean();
  }

  private writeHeartbeat(): void {
    const { heartbeatStore, instanceId, startedAt } = this.deps;
    heartbeatStore.write({ ts: this.now(), instanceId, startedAt });
  }

  /**
   * Je Projekt mit mindestens einem betroffenen Lauf genau eine Meldung, mit den Zahlen
   * DIESES Projekts (C4.1). Projekte ohne betroffene Läufe bekommen keine — dort gibt es
   * nichts nachzuschauen; der Ausfall steht trotzdem im Protokoll (C4.2).
   */
  private raisePerProject(from: number, to: number, durationMs: number, running: ExecutionRecord[]): void {
    const perProject = new Map<string, ExecutionRecord[]>();
    for (const run of running) {
      const runs = perProject.get(run.projectId);
      if (runs) runs.push(run);
      else perProject.set(run.projectId, [run]);
    }

    for (const [projectId, runs] of perProject) {
      this.deps.attention.raise({
        kind: 'server_outage',
        projectId,
        // Ein Ausfall gehört keinem einzelnen Feature und keiner Session (C4.5).
        featureId: null,
        sessionId: null,
        conversationId: null,
        message: outageMessage({
          from,
          to,
          durationMs,
          runCount: runs.length,
          featureNames: runs.map((r) => this.featureName(r)),
        }),
      });
    }
  }

  /** `null` = Lauf ohne Feature (Chat). Ist das Feature verschwunden, bleibt die Kennung. */
  private featureName(run: ExecutionRecord): string | null {
    if (run.featureId === null) return null;
    return this.deps.features.get(run.featureId)?.name ?? run.featureId;
  }

  /**
   * Stiller Abgang (FR-014): existiert zum letzten Lauf kein `shutdown`- oder
   * `exit`-Eintrag, ist der Server gegangen, ohne etwas hinterlassen zu können — genau
   * der Zustand vom 30.07.2026. Die `instanceId` verbindet Start und Abgang (C2.4).
   */
  private warStillerAbgang(recent: OperationsEntry[], vorigeInstanz: string | null): boolean {
    if (vorigeInstanz === null) return true;
    return !recent.some(
      (e) => e.instanceId === vorigeInstanz && (e.kind === 'shutdown' || e.kind === 'exit'),
    );
  }
}

/** Der jüngste `outage`-Eintrag im gelesenen Protokollende. */
function letzterAusfall(entries: OperationsEntry[]): OutageRecord | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.kind === 'outage' && entry.outage) return entry.outage;
  }
  return null;
}
