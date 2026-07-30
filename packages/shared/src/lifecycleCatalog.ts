/**
 * Katalog der fest verdrahteten Lebenszyklus-Schritte (Feature
 * "lebenszyklus-schritte-sichtbar-machen").
 *
 * Beschreibt die ARBEIT, die das Toolkit an fünf Stellen selbst erledigt —
 * Worktree-Anlage, Phasenstart, Phasenende, Integration, Merge: je Schritt was
 * passiert, wodurch er ausgelöst wird und wo das im Code steht (Datei + Symbol,
 * bewusst OHNE Zeilennummern). Bei den heiklen Stellen zusätzlich die zwingende
 * Reihenfolge samt Folge ihrer Umkehrung bzw. die Bedingung, unter der ein
 * Schritt entfällt.
 *
 * Abgrenzung zu workflowModel.ts: dort steht die KONFIGURIERBARE STRUKTUR des
 * Workflows (welche Phasen/Flags/Stufen es gibt, wie die Pipeline aussieht),
 * gerendert gegen die Live-Konfiguration. Hier steht die fest verdrahtete Arbeit
 * — konfigurationsunabhängig, für jedes Projekt identisch und vollständig auch
 * ohne ausgewähltes Feature. Keine der beiden Dateien importiert die andere.
 *
 * Gegen stilles Veralten wirken zwei getypte Bindungen an die Domänen-Unions
 * (PHASE_LIFECYCLE_STAGES über FeaturePhase, INTEGRATION_STAGE_ORIGIN über
 * IntegrationStage) — dasselbe Drift-Guard-Muster wie in workflowModel.ts:
 * eine neue Phase oder Stufe bricht `pnpm typecheck` an genau dieser Stelle.
 * Ergänzend prüfen lifecycleCatalog.test.ts (Vollständigkeit, pure) und
 * lifecycleCatalogPaths.test.ts in @sdd/server (Existenz der Code-Orte).
 *
 * KEINE UI, KEIN IO, kein Import eines Node-Builtins — pure Daten + zwei kleine Helfer.
 */
import type { FeaturePhase, IntegrationStage } from './types.js';

/**
 * Die fünf Stellen im Ablauf, an denen das Toolkit fest verdrahtet arbeitet.
 * Array-Reihenfolge = Reihenfolge im Lebenszyklus.
 */
export const LIFECYCLE_STAGES = [
  'worktree_create',
  'phase_start',
  'phase_end',
  'integration',
  'merge',
] as const;

export type LifecycleStageId = (typeof LIFECYCLE_STAGES)[number];

/** Ort im Code — Datei plus benannte Stelle, bewusst ohne Zeilennummern. */
export interface CodeLocation {
  /** Repo-relativer POSIX-Pfad, z. B. 'packages/server/src/git/worktrees.ts'. */
  file: string;
  /** Benannte Stelle: Funktion, Methode ('Klasse.methode') oder Konstante. */
  symbol: string;
}

/** Eine einzelne Handlung innerhalb einer Lebenszyklus-Stufe. */
export interface LifecycleStep {
  /** kebab-case, eindeutig innerhalb der Stufe, stabil (React-Key). */
  id: string;
  /** Deutscher Name, ≤ 60 Zeichen. */
  name: string;
  /** 1–3 Sätze, ≤ 400 Zeichen. */
  description: string;
  /** Wodurch/wann der Schritt ausgelöst wird. */
  trigger: string;
  location: CodeLocation;
  /** Zwingende Reihenfolge samt Folge ihrer Umkehrung (FR-009). */
  orderNote?: string;
  /** Bedingung, unter der der Schritt läuft bzw. entfällt. */
  condition?: string;
}

/** Eine der fünf Stellen im Ablauf, an denen das Toolkit fest verdrahtet arbeitet. */
export interface LifecycleStage {
  id: LifecycleStageId;
  title: string;
  /** Einordnungssatz: wann in der Reihenfolge. */
  when: string;
  /** ≥ 1 Schritt; Array-Reihenfolge = Ausführungsreihenfolge. */
  steps: readonly LifecycleStep[];
  /** Was das Toolkit hier bewusst NICHT tut (FR-004). */
  notDoneHere?: string;
}

/**
 * Einzige Quelle der Wahrheit für die Beschreibung dieser Schritte (FR-001).
 * Über `Record<LifecycleStageId, …>` getypt ⇒ eine neue Stufe erzwingt hier
 * einen Eintrag (Compile-Fehler sonst).
 */
export const LIFECYCLE_CATALOG: Record<LifecycleStageId, LifecycleStage> = {
  // ---------- Worktree-Anlage ----------
  worktree_create: {
    id: 'worktree_create',
    title: 'Worktree-Anlage',
    when: 'Beim Anlegen eines Features — und erneut beim Aufbau einer Session, falls der gespeicherte Worktree auf der Platte fehlt.',
    notDoneHere:
      'Abhängigkeiten installiert das Toolkit nicht — kein `pnpm install`, kein Build. Der Worktree kommt mit den ausgecheckten Dateien plus gespiegelter Agent-Konfiguration; alles Weitere macht der Agent im Worktree selbst.',
    steps: [
      {
        id: 'serialize-per-repo-and-branch',
        name: 'Anlage je Repo und Branch serialisieren',
        description:
          'Jeder Anlege-Auftrag wird pro (Repo, Branch) in eine Reihe gestellt: der nächste startet erst, wenn der vorige fertig ist. Die eigentliche Arbeit läuft danach im serialisierten Abschnitt.',
        trigger: 'jeder create()-Aufruf',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'WorktreeManager.create',
        },
        orderNote:
          'Die Serialisierung MUSS vor der Prüfung „gibt es den Branch schon?" liegen. Zwei parallele Aufrufe (Boot-Recovery und ein neu verbundener Client) lesen sonst beide „Branch fehlt" und rufen beide `worktree add -b` — der zweite scheitert mit „cannot lock ref … reference already exists".',
      },
      {
        id: 'prune-orphan-registry-entries',
        name: 'Verwaiste Registry-Einträge entfernen',
        description:
          'Vor jedem Anlege-Versuch läuft `git worktree prune`: Verzeichnis gelöscht, Verwaltungseintrag geblieben — ohne dieses Aufräumen scheitert `worktree add` mit „already used by worktree".',
        trigger: 'vor jedem Anlege-Versuch',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'WorktreeManager.createUnlocked',
        },
      },
      {
        id: 'reuse-existing-worktree',
        name: 'Bestehenden Worktree idempotent wiederverwenden',
        description:
          'Liegt am Zielverzeichnis schon ein Worktree, wird seine Git-Verknüpfung geprüft: gesund oder reparierbar → er wird weiterverwendet, ohne neu auszuchecken. Eine unrettbare Hülle wird entfernt und neu angelegt.',
        trigger: 'Zielverzeichnis existiert bereits',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'WorktreeManager.ensureValid',
        },
        condition:
          'nur bei vorhandenem Zielverzeichnis; eine kaputte Verknüpfung wird per `git worktree repair` geheilt',
      },
      {
        id: 'add-worktree-and-branch',
        name: 'Worktree anlegen, Branch bei Bedarf abzweigen',
        description:
          'Ist kein gültiger Worktree vorhanden, wird er unter dem Datenverzeichnis angelegt. Existiert der Feature-Branch bereits, wird er ausgecheckt; sonst zweigt `add -b` ihn vom Default-Branch ab.',
        trigger: 'kein gültiger Worktree vorhanden',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'WorktreeManager.createUnlocked',
        },
      },
      {
        id: 'race-retry',
        name: 'Wettlauf-Wiederholung',
        description:
          'Wurde der Branch oder Worktree zwischen Prüfung und Anlage doch angelegt, wird erneut aufgeräumt und der bestehende Worktree gesucht. Gibt es nur den Branch, setzt ein zweiter Versuch darauf auf.',
        trigger: '`git worktree add` meldet „already exists/already checked out/already used by worktree"',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'WorktreeManager.createUnlocked',
        },
        condition: 'nur nach genau dieser Fehlermeldung; jeder andere Fehler bricht die Anlage ab',
      },
      {
        id: 'mirror-agent-config',
        name: 'Agent-Konfiguration spiegeln',
        description:
          '`.claude`, `CLAUDE.md` und `AGENTS.md` werden aus dem Hauptrepo in den Worktree kopiert — nur was dort fehlt, getrackte Dateien gewinnen. Ohne das fehlen die projektlokalen Skills und ein Phasenstart schickt ein Kommando, das es im Worktree nicht gibt.',
        trigger: 'auf jedem Erfolgspfad der Anlage',
        location: {
          file: 'packages/server/src/git/worktrees.ts',
          symbol: 'mirrorAgentConfig',
        },
      },
    ],
  },

  // ---------- Phasenstart ----------
  phase_start: {
    id: 'phase_start',
    title: 'Phasenstart',
    when: 'Vor jedem Phasen-Lauf — für jede Phase identisch.',
    steps: [
      {
        id: 'before-phase-gate',
        name: '`before_phase`-Gate',
        description:
          'Vor dem Start laufen die Gate-Agents dieses Auslösers sequentiell headless. Der Phasenstart wird bis zum Ergebnis aufgeschoben; die Phase bleibt bis dahin unangetastet.',
        trigger: 'Start einer Phase',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.runBeforePhaseGate',
        },
        condition:
          'nur wenn für diesen Auslöser Agents existieren; ein blockierender FAIL verhindert den Start und meldet sich in „Braucht dich"',
      },
      {
        id: 'ensure-session',
        name: 'Session sicherstellen',
        description:
          'Je Feature läuft genau eine persistente Claude-Session im Worktree; pro Feature sind die Aufrufe serialisiert, damit nicht zwei Sessions entstehen. Eine frühere Session wird nur fortgesetzt, wenn ihr Transkript noch auf der Platte liegt.',
        trigger: 'Phasenstart ohne laufende Session',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.ensureSessionInner',
        },
      },
      {
        id: 'transcript-start-mark',
        name: 'Transkript-Startmarke festhalten',
        description:
          'Pfad und Byte-Offset des Transkripts werden als Startmarke des Laufs notiert. Sie ist später die untere Grenze der Verbrauchsmessung.',
        trigger: 'unmittelbar vor dem Kontext-Reset',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.transcriptMarkFor',
        },
        orderNote:
          'Die Marke MUSS vor dem Kontext-Reset gesetzt werden. Wird sie erst danach genommen, fällt der Verbrauch des Resets (`/compact`, `/clear`) aus der Messung — der optimierte Lauf sähe billiger aus, als er ist, und der Vergleich mit vollem Kontext wäre wertlos.',
      },
      {
        id: 'context-reset',
        name: 'Kontext-Reset gemäß Strategie',
        description:
          'Je nach eingestellter Strategie wird der Verlauf vor dem Phasenprompt zusammengefasst (`/compact`) oder geleert (`/clear`). Session-Prozess und -ID bleiben dabei bestehen.',
        trigger: 'vor dem Phasenprompt, ab der zweiten Phase',
        location: {
          file: 'packages/server/src/services/contextOptimizer.ts',
          symbol: 'prepareForPhase',
        },
        condition:
          'nur bei Strategie `compact` oder `fresh` und nie in der ersten Phase; fehlt `spec.md`, wird auf vollen Kontext zurückgefallen',
      },
      {
        id: 'knowledge-preamble',
        name: 'Wissens-Präambel anhängen',
        description:
          'Das relevante Projektwissen wird in den Worktree materialisiert und als kompakter Verweis an den Phasenprompt gehängt — nicht der ganze Inhalt, nur der Pointer auf die als relevant markierten Einträge.',
        trigger: 'beim Bauen des Phasenprompts',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.knowledgePreambleFor',
        },
        condition:
          'nur bei der ersten Injektion, geändertem Wissen oder nach einem Reset — ohne Reset steht die Präambel noch im Verlauf und wird nicht erneut mitgeschickt',
      },
      {
        id: 'documents-preamble',
        name: 'Dokument-Verweise anhängen',
        description:
          'Beim Anlegen hinterlegte Dokumente werden mit Namen und Fundort genannt, niemals mit Inhalt. Bewusst ohne Dedupe: der Verweis gehört zum Auftrag und steht in jedem Schritt, auch direkt nach einem Reset. Ohne Dokumente ist er leer.',
        trigger: 'beim Bauen des Phasenprompts',
        location: {
          file: 'packages/shared/src/featureDocuments.ts',
          symbol: 'buildDocumentsPreamble',
        },
      },
      {
        id: 'build-and-send-slash-command',
        name: 'Slash-Kommando bauen und senden',
        description:
          'Der Phasenauftrag ist ein Slash-Kommando auf das Spec-Verzeichnis des Features (`specs/<feature>`), das mit den Präambeln in die laufende Session gesendet wird. Das Präfix folgt dem Repo-Stil: `/speckit-` bei Skills, `/speckit.` bei älteren Command-Installationen.',
        trigger: 'nach dem Kontext-Reset',
        location: {
          file: 'packages/server/src/pty/commandBuilder.ts',
          symbol: 'phaseSlashCommand',
        },
      },
    ],
  },

  // ---------- Phasenende ----------
  phase_end: {
    id: 'phase_end',
    title: 'Phasenende',
    when: 'Wenn der Agent-Turn der Phase abgeschlossen ist (Stop-Signal der Session).',
    steps: [
      {
        id: 'discard-reset-turn',
        name: 'Reset-Turn aussortieren',
        description:
          'Endet ein Turn, ohne dass der Phasenprompt zugestellt wurde, gehört er zu einem vorgeschalteten Kommando (dem Reset) und nicht zur Phase. Die Phase bleibt offen und läuft erst danach an.',
        trigger: 'Turn-Ende ohne zugestellten Phasenprompt',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.handleTurnCompleted',
        },
        orderNote:
          'Diese Prüfung MUSS vor jeder Abrechnung stehen. Andernfalls schließt der Reset-Turn die Phase ab: sie meldet Erfolg ohne jede geleistete Arbeit, und der eigentliche Lauf hat keine Phase mehr, zu der er gehört.',
      },
      {
        id: 'meter-usage',
        name: 'Verbrauch messen',
        description:
          'Der Verbrauch kommt vorrangig aus den Meldungen der CLI; liegen keine vor, wird das Transkript-Delta des Turns gemessen. Genau ein Schreibpfad je Lauf — die Zahlen beider Quellen werden nie addiert.',
        trigger: 'Phasenabschluss',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.finishWithMetering',
        },
      },
      {
        id: 'late-reconcile',
        name: 'Zahlen nachtragen',
        description:
          'Meldungen treffen in Intervallen ein, und die Schlusszeilen eines Turns werden erst nach dem Stop geschrieben. Der Lauf wird darum nachgerechnet — jedes Mal das volle Fenster neu summiert, nie addiert.',
        trigger: '8 s nach dem Abschluss und erneut am Ende des Nachlauffensters',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.scheduleLateReconcile',
        },
        condition:
          'nur bis zum Ablauf des Nachlauffensters; danach gilt die Zahl als endgültig und spätere Meldungen verfallen',
      },
      {
        id: 'persist-transcript-range',
        name: 'Transkript-Grenzen festhalten',
        description:
          'Transkriptpfad sowie Start- und End-Offset des Laufs werden gespeichert, damit sein Log auch nach einem Server-Neustart abrufbar bleibt. Wechselte die Datei während der Phase, wird die Startmarke korrigiert.',
        trigger: 'Phasenabschluss',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.persistTranscriptRange',
        },
      },
      {
        id: 'recount-tasks',
        name: 'Aufgaben erneut zählen',
        description:
          'Die Checkboxen in `tasks.md` des Features werden neu gelesen und der Stand „erledigt/gesamt" am Feature aktualisiert.',
        trigger: 'Phasenabschluss mit vorhandenem Worktree',
        location: {
          file: 'packages/server/src/services/artifacts.ts',
          symbol: 'parseTaskProgress',
        },
      },
      {
        id: 'after-phase-gate',
        name: '`after_phase`-Gate',
        description:
          'Nach dem Abschluss und vor jedem automatischen Weiterlaufen prüfen die Gate-Agents dieses Auslösers das Ergebnis.',
        trigger: 'nach dem Phasenabschluss, vor dem Auto-Progress',
        location: {
          file: 'packages/server/src/services/orchestrator.ts',
          symbol: 'Orchestrator.runAfterPhaseGate',
        },
        condition:
          'nur wenn für diesen Auslöser Agents existieren; ein blockierender FAIL hält die Phase auf „wartet auf Review" und verhindert den Auto-Progress',
      },
    ],
  },

  // ---------- Integration ----------
  integration: {
    id: 'integration',
    title: 'Integration',
    when: 'Nach der letzten Phase — automatisch bei Auto-Verify, sonst per Integrieren-Aktion.',
    steps: [
      {
        id: 'preflight-checks',
        name: 'Vorprüfungen',
        description:
          'Vor jeder Zustandsänderung wird geprüft: das Feature ist nicht schon in Integration, ein Worktree ist vorhanden, es gibt ungemergte Änderungen, und mindestens eine Aufgabe ist erledigt. Eine Ablehnung lässt Feature und Arbeitsverzeichnis unverändert.',
        trigger: 'Start der Integration (manuell oder automatisch)',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.beginIntegration',
        },
      },
      {
        id: 'commit-worktree',
        name: 'Worktree festschreiben',
        description:
          'Alle uncommitteten Änderungen im Worktree werden aufgenommen und als Commit des Features festgeschrieben. Ist der Worktree sauber, passiert nichts.',
        trigger: 'direkt nach den Vorprüfungen',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.commitWorktree',
        },
        orderNote:
          'MUSS vor dem Git-Abgleich laufen. Sonst hat der Branch keinen eigenen Commit, gilt trivial als Vorfahre des Ziels, der Abgleich hält ihn für „bereits gemergt" und eskaliert wegen der uncommitteten Dateien — jede Integration eskaliert, ohne dass je committet würde.',
      },
      {
        id: 'reconcile-with-git',
        name: 'Zustand mit Git abgleichen',
        description:
          'Der gespeicherte Zustand wird gegen die Git-Realität geprüft, bevor blind im Worktree gearbeitet wird: bereits im Ziel enthalten → abschließen; Verknüpfung kaputt → reparieren; Worktree weg und nicht gemergt → eskalieren.',
        trigger: 'nach dem Festschreiben',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.reconcile',
        },
      },
      {
        id: 'run-verify-commands',
        name: 'Verify-Kommandos ausführen',
        description:
          'Die im Projekt hinterlegten Test-, Build- und Lint-Kommandos laufen sequentiell im Worktree; der erste Fehlschlag bricht ab.',
        trigger: 'nach erfolgreichem Git-Abgleich',
        location: {
          file: 'packages/server/src/services/verifyService.ts',
          symbol: 'runVerification',
        },
        condition:
          'nur wenn im Projekt Verify-Kommandos konfiguriert sind; ein Fehlschlag eskaliert als „Verifikation fehlgeschlagen"',
      },
      {
        id: 'review-gate-agents',
        name: 'Review-Gate-Agents laufen lassen',
        description:
          'Die Review-Agents laufen sequentiell headless im Worktree. Der erste blockierende FAIL bricht das Gate ab und eskaliert; beratende Befunde werden nur verbucht.',
        trigger: 'nach grüner Verifikation',
        location: {
          file: 'packages/server/src/services/agentGateService.ts',
          symbol: 'AgentGateService.runTrigger',
        },
        condition: 'nur bei eingeschalteten Review-Agents',
      },
      {
        id: 'commit-review-reports',
        name: 'Review-Berichte committen',
        description:
          'Was die Review-Agents im Worktree hinterlassen haben, wird als eigener Commit festgeschrieben — die Berichte gehören versioniert zum Feature.',
        trigger: 'nach dem Gate-Lauf',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.commitWorktree',
        },
        condition: 'nur im Review-Gate-Pfad',
      },
      {
        id: 'handover-queue-or-human',
        name: 'Übergabe: Queue oder Human-Review',
        description:
          'Bei Auto-Merge wandert das Feature in die Merge-Queue des Projekts. Sonst bleibt es auf „wartet auf menschliches Review" stehen und meldet sich mit einem Eintrag in „Braucht dich".',
        trigger: 'Abschluss der Integration',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.enqueue',
        },
        condition: 'Queue nur bei eingeschaltetem Auto-Merge, sonst Halt auf menschlichem Review',
      },
    ],
  },

  // ---------- Merge ----------
  merge: {
    id: 'merge',
    title: 'Merge',
    when: 'Merge-Queue-Worker, je Projekt streng sequentiell.',
    steps: [
      {
        id: 'reconcile-before-merge',
        name: 'Erneuter Git-Abgleich vor dem Merge',
        description:
          'Bevor der Worker mergt, gleicht er den Zustand nochmals mit Git ab: bereits im Ziel enthalten → Item abschließen und weiter; Worktree weg und nicht gemergt → eskalieren und die Queue anhalten.',
        trigger: 'Item wird aus der Queue gezogen',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.processItem',
        },
      },
      {
        id: 'rebase-onto-target',
        name: 'Rebase auf das Ziel',
        description:
          'Der Feature-Branch wird im Worktree auf den Ziel-Branch rebast. Existiert das Ziel noch nicht, ist der Default-Branch die Basis. Ein Worktree mit uncommitteten Änderungen wird abgelehnt.',
        trigger: 'nach dem Git-Abgleich',
        location: {
          file: 'packages/server/src/git/mergeEngine.ts',
          symbol: 'MergeEngine.rebaseOnto',
        },
      },
      {
        id: 'resolve-conflicts-headless',
        name: 'Konflikte headless auflösen',
        description:
          'Bei Rebase-Konflikten löst ein headless laufender Claude sie im Worktree auf; der Diff vor und nach jeder Auflösung wird festgehalten. Danach wird der Rebase fortgesetzt — nie mit noch offenen Konfliktmarkern.',
        trigger: 'Rebase meldet Konflikte',
        location: {
          file: 'packages/server/src/services/conflictResolver.ts',
          symbol: 'resolveConflicts',
        },
        condition:
          'höchstens 3 Versuche; danach wird der Rebase abgebrochen und der Konflikt eskaliert',
      },
      {
        id: 're-verify',
        name: 'Erneut verifizieren',
        description:
          'Nach einer Konfliktauflösung oder nach Korrekturen aus dem Review laufen die Verify-Kommandos erneut. Rote Tests eskalieren, statt zu mergen.',
        trigger: 'nach Konfliktauflösung oder Reviewer-Korrekturen',
        location: {
          file: 'packages/server/src/services/verifyService.ts',
          symbol: 'runVerification',
        },
        condition:
          'nur mit konfigurierten Verify-Kommandos und nur nach Auflösung bzw. erzwungener Re-Verifikation — dafür dann immer, nie blind mergen',
      },
      {
        id: 'merge-into-target',
        name: 'Merge nach eingestellter Strategie',
        description:
          'Der Merge ins Ziel läuft als fast-forward oder squash. Ist das Ziel nicht im Haupt-Checkout ausgecheckt, geschieht er in einem separaten temporären Worktree — der Haupt-Checkout wird nie umgeschaltet.',
        trigger: 'grüne Verifikation',
        location: {
          file: 'packages/server/src/git/mergeEngine.ts',
          symbol: 'MergeEngine.mergeIntoTarget',
        },
        condition:
          'im PR-Modus stattdessen Branch pushen und Pull-Request via `gh pr create` anlegen; der Worktree bleibt dann bestehen',
      },
      {
        id: 'cleanup-after-merge',
        name: 'Abschluss und Aufräumen',
        description:
          'Nach erfolgreichem Merge wird die Session beendet, der Worktree entfernt, der Feature-Branch gelöscht und der gespeicherte Worktree-Pfad am Feature geleert. Das Feature steht danach auf „gemergt".',
        trigger: 'erfolgreicher Merge',
        location: {
          file: 'packages/server/src/services/mergeQueueService.ts',
          symbol: 'MergeQueueService.cleanupMerged',
        },
      },
    ],
  },
};

// ---------- Drift-Guard: Bindung an die bestehende Domäne (FR-010) ----------

/** Stufen, die an einer Phase nach dem Standard-Schema hängen. */
const STANDARD_PHASE_STAGES = ['phase_start', 'phase_end'] as const;

/**
 * Welche Lebenszyklus-Stufen an einer Feature-Phase hängen. Über
 * `Record<FeaturePhase, …>` getypt ⇒ eine neue Phase in FEATURE_PHASES ohne
 * Eintrag ist ein Compile-Fehler an dieser Stelle.
 *
 * Alle Phasen zeigen auf dieselbe Konstante: kein duplizierter Text, aber eine
 * bewusste Entscheidung je Phase — eine künftige Phase mit abweichendem Ablauf
 * hinterlegt ihre Abweichung hier, statt die Übersicht still falsch werden zu lassen.
 */
export const PHASE_LIFECYCLE_STAGES = {
  specify: STANDARD_PHASE_STAGES,
  clarify: STANDARD_PHASE_STAGES,
  plan: STANDARD_PHASE_STAGES,
  checklist: STANDARD_PHASE_STAGES,
  analyze: STANDARD_PHASE_STAGES,
  tasks: STANDARD_PHASE_STAGES,
  implement: STANDARD_PHASE_STAGES,
} satisfies Record<FeaturePhase, readonly LifecycleStageId[]>;

/**
 * Welche Lebenszyklus-Stufe beschreibt den Ablauf, der zu dieser
 * Integrations-Stufe führt? `null` = Ruhezustand, den kein Ablauf erzeugt.
 *
 * Über `Record<IntegrationStage, …>` getypt ⇒ eine neue Stufe ohne Eintrag ist
 * ein Compile-Fehler an dieser Stelle: wer eine Stufe ergänzt, muss beantworten,
 * welcher Ablauf sie erzeugt.
 */
export const INTEGRATION_STAGE_ORIGIN = {
  none: null,
  verifying: 'integration',
  verify_failed: 'integration',
  review_gate: 'integration',
  gate_failed: 'integration',
  awaiting_human_review: 'integration',
  queued: 'integration',
  merging: 'merge',
  conflict_resolving: 'merge',
  conflict_escalated: 'merge',
  merged: 'merge',
} satisfies Record<IntegrationStage, LifecycleStageId | null>;

// ---------- Helfer (rein abgeleitet, kein Zustand) ----------

/** Zugriff auf eine Stufe. Total-Funktion: wirft nie, liefert nie `undefined`. */
export function lifecycleStage(id: LifecycleStageId): LifecycleStage {
  return LIFECYCLE_CATALOG[id];
}

/** Alle Stufen in Lebenszyklus-Reihenfolge (Tests, mögliche Sammelansichten). */
export function orderedLifecycleStages(): readonly LifecycleStage[] {
  return LIFECYCLE_STAGES.map((id) => LIFECYCLE_CATALOG[id]);
}
