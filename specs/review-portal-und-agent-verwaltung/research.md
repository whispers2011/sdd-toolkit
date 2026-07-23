# Research & Leitentscheidungen: Review-Portal & Agent-Verwaltung

**Phase 0 Output** — konsolidiert aus Code-Exploration (Ist-Zustand), Referenz-Analyse
(`reference/speckit-assistant` Human Audit Portal), Plan-Agent-Reviews und
Nutzer-Entscheidungen (AskUserQuestion, 2026-07-23). Keine offenen NEEDS CLARIFICATION.

## Ist-Zustand (Evidenz aus Exploration)

- **Integration-Lifecycle**: `IntegrationStage` (`packages/shared/src/types.ts:32-43`):
  `none → verifying → verify_failed | review_gate → gate_failed | awaiting_human_review →
  queued → merging → conflict_resolving → conflict_escalated | merged`; orchestriert von
  `mergeQueueService.ts` (`beginIntegration`, Worker, `cleanupMerged`, `reconcile`).
- **Review-Portal heute**: `ReviewPortal.tsx` = Modal mit 3 Tabs (Diff-`<pre>`, Commits,
  Konfliktauflösung), binär Approve/Reject, kein Editor, keine Kommentare, keine Audits.
- **Merge-Ziel heute**: hart `project.defaultBranch`; Branch-Name auto
  `feature/${slugify(name)}` (`orchestrator.ts:96-100`).
- **Personas heute**: Tabelle `personas` (id, project_id NULL=global, name, prompt, sort_order,
  enabled; 2 Seeds). `reviewGateService.ts` führt enabled Personas sequenziell headless aus →
  Markdown-Report `specs/<feature>/reviews/<persona-id>.md`, Verdict-Regex `VERDICT: PASS|FAIL`,
  erster FAIL stoppt. Ergebnisse NICHT strukturiert in DB. API GET/PUT/DELETE `/api/personas`
  hat NULL Web-Konsumenten. `model`-Parameter existiert in jedem `commandBuilder.ts`-Builder,
  wird aber nirgends gesetzt (= sauberste Naht für Agent-Modellwahl).
- **Phasen-Modell**: `FeaturePhase` = specify…implement; review/merge sind IntegrationStage,
  keine Phasen. Einziger Hook-Mechanismus: geschlossene Union `PhaseEffect`
  (`phaseMachine.ts:35-38`). Effekt-Unterdrückungs-Muster existiert (`advanceTo` ruft
  approvePhase mit `{...automation, autoProgressUntil:'off', autoVerify:false}`).
- **Vorlagen-Muster im Repo**: `knowledge_feature_selection` (Per-Feature-Selektion),
  AttentionRepo (Repo-Form), featureArtifacts mtime-409 (Save-Konflikt), ExecutionsView +
  `charts.tsx` (Dashboard), KnowledgePanel/FeatureKnowledgeSelect (Verwaltungs-UI).
- **Referenz speckit-assistant**: 3-Spalten-Portal-Layout, Persona-Gate sequenziell mit
  Stop-on-FAIL, Verdict-via-Report-Datei — deckungsgleich mit unserem Modell. Kritische Lücken
  der Referenz (kein echter Merge, Kommentare nicht persistiert, kein Editor, keine echten
  Testdaten) sind bei uns Net-New; Merge-Infra (MergeEngine/MergeQueue) existiert bereits.

## Entscheidungen

### E1: Portal-Zugang als neue Top-Level-View „Review"

- **Decision**: Eigene View in App.tsx-Nav (Muster ExecutionsView), projekt-gescoped, mit
  Badge (# awaiting_human_review); Kanban-Button öffnet dasselbe Portal-Modal.
- **Rationale**: Zielbild „alle integrationsbereiten Features auf einen Blick"; Modal-only
  skaliert nicht über Features hinweg.
- **Alternatives considered**: Nur Modal aufbohren (kein Überblick); eigener Route-Split
  (Overhead, SPA hat View-Union im Store).

### E2: Diff-Rendering ohne neue Dependency

- **Decision**: Eigener `parseUnifiedDiff()` in shared (pur, getestet) + Renderer mit
  Zeilennummern und Kommentar-Gutter.
- **Rationale**: Zeilennummern (alt/neu) brauchen wir ohnehin als Kommentar-Anker; Referenz
  zeigt, dass handgerollt reicht; keine Diff-Lib nötig.
- **Alternatives considered**: `diff2html`/`react-diff-view` (neue Deps, Styling-Zwang,
  Anker-Zugriff umständlicher).

### E3: Editor als Textarea + Markdown-Preview

- **Decision**: Monospace-Textarea + vorhandenes react-markdown für Preview;
  mtime-Konfliktschutz nach featureArtifacts/SaveConflictError-Muster; PUT nur bei
  `awaiting_human_review`; Traversal-Guard, Binär-Erkennung, 2-MB-Limit.
- **Rationale**: Trivial-Korrekturen sind der Use-Case; CodeMirror wäre neue schwere Dep.
- **Alternatives considered**: CodeMirror/Monaco (abgelehnt: Gewicht), kein Editor
  (abgelehnt: Zurückweisungs-Schleife für Tippfehler).

### E4: Merge-Ziel-Persistenz & idempotente Branch-Anlage

- **Decision**: `features.integration_target` (NULL = defaultBranch) +
  `merge_queue.force_verify`. `createBranch` wird NICHT persistiert — Semantik ist idempotent
  „Ziel-Branch sicherstellen (`ensureBranch`), dann mergen".
- **Rationale**: Resume-sicher nach Crash/Retry; kein Zusatzzustand, der divergieren kann.
- **Alternatives considered**: createBranch-Flag persistieren (Retry nach teilweisem Erfolg
  würde „Branch existiert schon" fehlschlagen).

### E5: Nicht-Default-Ziel via ephemerem Worktree

- **Decision**: `mergeIntoTarget`: ist das Ziel im Haupt-Checkout ausgecheckt → heutiger Pfad
  byte-identisch; sonst ephemerer `git worktree add <dataDir>/merge-tmp/<id> <target>` →
  ff/squash darin → `worktree remove` (finally; prune bei Fehler). Ziel in fremdem Worktree
  ausgecheckt → sauberer Fehler.
- **Rationale**: Haupt-Checkout darf nie umgeschaltet werden (läuft parallel als Dev-Umgebung);
  Default-Pfad bleibt unverändert → autoMerge-Regression ausgeschlossen.
- **Alternatives considered**: `git checkout <target>` im Haupt-Checkout (verboten, stört
  laufende Prozesse); Plumbing-Merge ohne Worktree via `commit-tree` (squash/ff-Semantik +
  Hooks schwer korrekt nachzubauen).

### E6: Kommentare flach, datei-/zeilenverankert (Nutzer-Entscheidung)

- **Decision**: `review_comments` (feature_id, file_path|NULL, line|NULL, side old/new, text,
  status open/resolved); beim Zurückweisen kompiliert `compileReviewPrompt()` offene Kommentare
  + Freitext zu strukturiertem deutschem Prompt an die Feature-Konsole. Anker-Drift v1
  akzeptiert (Hinweis-Badge).
- **Rationale**: Nutzer will präzise Zurückweisungen ohne Thread-Komplexität; Konsole ist der
  bestehende Rückkanal.
- **Alternatives considered**: Threads (abgelehnt vom Nutzer), Anker-Recompute via
  Diff-Tracking (v2, Aufwand).

### E7: Test-Dashboard = aufbereitete Verify-Executions (Nutzer-Entscheidung)

- **Decision**: TestsPane zeigt Verify-Läufe (Status/Dauer/Exit-Code/Logs + Token/Kosten via
  vorhandener executions-Daten + charts.tsx). Keine Test-Report-Parser (kein JUnit/TAP).
- **Rationale**: Verify ist bereits die Wahrheit über „läuft es"; Parser wären
  projekt-spezifisch und fragil.
- **Alternatives considered**: JUnit-XML/JSON-Reporter-Integration (v2, pro Projekt-Ökosystem).

### E8: Branch-Zielwahl nur im Portal (Nutzer-Entscheidung)

- **Decision**: Zielwahl (bestehend/neu + Namensvorschlag `integration/<slug>` mit
  Kollisions-Suffix, Validierung als check-ref-format-Subset) ausschließlich im
  Human-in-the-loop-Pfad; autoMerge bleibt defaultBranch; reject setzt Ziel zurück.
- **Rationale**: Automatik soll deterministisch bleiben; Zielwahl ist eine bewusste
  menschliche Entscheidung.
- **Alternatives considered**: Projekt-Setting „Default-Ziel" (verwässert Automatik-Garantien).

### E9: personas → agents via RENAME + ADD COLUMN

- **Decision**: `ALTER TABLE personas RENAME TO agents` + Spalten description, model,
  trigger_kind (Default 'review_gate'), trigger_phase, blocking (Default 1). Defaults bilden
  heutiges Verhalten exakt ab. PersonaRepo entfällt; neue Datei `db/agentRepo.ts`.
- **Rationale**: Verlustfrei; keine FK-Referenzen auf personas; /api/personas hat null
  Web-Konsumenten → API-Bruch folgenlos.
- **Alternatives considered**: Neue Tabelle + Copy (mehr MigrationScode, kein Vorteil);
  personas behalten + agents daneben (zwei Wahrheiten).

### E10: Union-Semantik global ∪ Projekt (statt Fallback)

- **Decision**: `AgentRepo.forProject` = globale UND projektspezifische Agents zusammen;
  Per-Feature-Exclude als Escape-Hatch (exclude gewinnt; explizites Include aktiviert auch
  disabled Agents).
- **Rationale**: Mit Gates wäre Fallback gefährlich: EIN Projekt-Agent würde still alle
  globalen Gates abschalten. Semantikänderung ggü. PersonaRepo.forProject ist bewusst.
- **Alternatives considered**: Fallback wie bisher (Sicherheitsrisiko für Gates),
  Projekt-Flag „globale erben" (Konfigurations-Komplexität).

### E11: Trigger-Verdrahtung im Orchestrator, phaseMachine unangetastet

- **Decision**: 4 Trigger-Arten (manual | review_gate | after_phase:<p> | before_phase:<p>).
  after_phase-Hook in `handleTurnCompleted` (nach finishPhase/savePhases, VOR Auto-Progress;
  FAIL ⇒ Phase bleibt awaiting_review + Attention `phase_gate_failed`, Human-Override möglich).
  before_phase: Deferral in `startPhaseRun` (Gates vorhanden && !skipGates ⇒ Phase bleibt idle,
  async Gate, bei PASS `startPhaseRun({skipGates:true})`), Auto-Progress-Umleitung in `approve`
  mit vorhandenem Effekt-Unterdrückungs-Muster; runningGates-Map gegen Doppelstart;
  Bus-Event `agent_gate {featureId, projectId, trigger, status running|pass|fail}`.
- **Rationale**: PhaseEffect-Union erweitern bräuchte Agent-Wissen in der pure Machine und
  bricht alle toEqual-Assertions; Orchestrator führt Effekte ohnehin aus. Deferral ist
  crash-sicher (nichts zu heilen — Phase ist schlicht nicht gestartet).
- **Alternatives considered**: PhaseEffect erweitern (abgelehnt, dokumentiert); Gate synchron
  im HTTP-Handler (Timeout-Risiko, 20-min-Läufe); eigener Gate-Worker-Prozess (Overkill).

### E12: Strukturierte Ergebnisse in `agent_runs` (nicht auf executions)

- **Decision**: Eigene Tabelle mit 1:1-Link `execution_id` (Kosten/Token bleiben in
  executions); Felder verdict/decision_label/summary/report_path/trigger/Zeitpunkte +
  agent_name-Snapshot. Lesequelle fürs Portal (runs-first, Markdown-Fallback nur für
  Alt-Reviews vor Migration).
- **Rationale**: executions ist Prozess-Protokoll; Urteil/Zusammenfassung sind Domänen-Daten
  mit eigener Lebensdauer (Agent kann gelöscht werden → SET NULL + Name-Snapshot).
- **Alternatives considered**: Spalten auf executions (Schema-Vermischung); nur
  Markdown-Dateien parsen (kein latestPerAgent, keine Kosten-Zuordnung, langsam).

### E13: Verdict-Konvention beibehalten + erweitern

- **Decision**: `VERDICT: PASS|FAIL` bleibt Pflicht-Konvention; optionale Zusatzzeilen
  `GESAMTENTSCHEIDUNG:`, `ZUSAMMENFASSUNG:`, `FREIGABE ERFORDERLICH: <thema>` (je Zeile ein
  Item ⇒ Attention `approval_required` auch bei PASS). Plan-Quality-Dreiwege-Mapping:
  FREIGEGEBEN [MIT ÄNDERUNGEN] → PASS, PLAN ÜBERARBEITEN → FAIL. Bericht ohne auswertbares
  Urteil ⇒ FAIL/unklar, nie PASS.
- **Rationale**: Kompatibel mit allen Bestands-Personas und der Report-Datei-Konvention;
  Human-in-the-loop braucht expliziten Freigabebedarf-Kanal.
- **Alternatives considered**: JSON-Output erzwingen (bricht Bestands-Prompts, LLM-fragiler
  in langen Berichten).

### E14: Neue AttentionKinds statt Wiederverwendung

- **Decision**: `phase_gate_failed` und `approval_required` als NEUE AttentionKinds.
- **Rationale**: Bestehendes `gate_failed` ist via STAGE_FOR_KIND
  (`attentionReconciler.ts:22`) an integration==='gate_failed' gekoppelt — Wiederverwendung
  würde Phasen-Gate-Attention sofort wegresolven.
- **Alternatives considered**: gate_failed mitbenutzen (nachweislich fehlerhaft).

### E15: Quality-Gates als ausgelieferte Agent-Definitionen (Nutzer-Entscheidung)

- **Decision**: 3 Seeds in der Migration (global, deutsch): `default-dor-gate`
  (before_phase:implement, blocking), `default-plan-quality` (after_phase:plan, blocking;
  eingedampfte ~80–100-Zeilen-Fassung von `docs/solution-plan-quality-review.md`, eingebettet
  in die Migration — Datei-Referenz scheidet aus, Agents laufen in fremden Worktrees),
  `default-doku-policy` (review_gate, **advisory**, sort_order 2). Alt-Personas behalten
  id/project_id/enabled/sort_order; Defaults ⇒ review_gate + blocking.
- **Rationale**: Meeting-Beschlüsse als Daten statt Code — abschalt-, editier- und
  duplizierbar; Doku-Policy advisory, damit False Positives keine Merges stoppen (im UI
  umschaltbar).
- **Alternatives considered**: Hart verdrahtete Gates (vom Nutzer explizit abgelehnt);
  Seeds als Dateien im Repo (Worktree-Problem, Versionierung ungeklärt).

### E16: AuditSource-Vereinfachung (Schnittstellen-Abgleich A↔B)

- **Decision**: Kein eigenes AuditSource-Interface; der audits-Endpoint liest runs-first aus
  `agent_runs` + inline Markdown-Fallback (specs/<f>/reviews/*.md + parseVerdict) für
  Vor-Migrations-Features. Eine Audit-Fläche: AuditSidebar gruppiert nach Trigger.
- **Rationale**: Teil B liefert die strukturierte Quelle sofort mit — die Abstraktionsschicht
  hätte genau eine zweite Implementierung für Legacy-Daten.
- **Alternatives considered**: Interface + zwei Implementierungen (Overhead ohne zweiten
  echten Konsumenten).

### E17: Reviewer-Edits ⇒ Commit + forceVerify

- **Decision**: approveForMerge committet Portal-Edits als
  `review(<name>): reviewer-korrekturen`; wenn committed ⇒ enqueue mit forceVerify=1;
  processItem re-verifiziert bei `attempts>0 || forceVerify`.
- **Rationale**: Reviewer-Änderungen sind ungeprüfter Code; Re-Verify vor Merge fängt
  Build-Brüche (setzt verifyCommands voraus — dokumentiertes Restrisiko).
- **Alternatives considered**: Edits nur im Worktree lassen (gehen beim cleanup verloren);
  immer re-verifizieren (unnötige Latenz im Normalfall).

### E18: executions.kind bleibt 'review'

- **Decision**: Alle Agent-Läufe schreiben weiterhin executions kind='review';
  Differenzierung über `agent_runs.trigger_kind`.
- **Rationale**: Kein Migrationsbedarf in Metering/Run-Summaries; agent_runs trägt die
  Semantik.
- **Alternatives considered**: Neue kinds pro Trigger (Ripple durch runSummary/Charts).

## Offene Punkte

Keine. Alle Entscheidungen sind getroffen; Restrisiken mit Gegenmaßnahmen stehen in
[plan.md](./plan.md#risiken--gegenmaßnahmen).
