# Specification Quality Checklist: Lebenszyklus-Schritte sichtbar machen

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-30
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Bewusste Ausnahmen bei „no implementation details"**: FR-010 nennt `pnpm typecheck`, die
  Assumptions nennen `shared/` und `workflowModel.ts`, FR-006 nennt `tasks.md`. Diese Bezeichner
  sind Vorgabe der Anforderung (harte Randbedingungen des Auftraggebers) und machen die
  Abnahmekriterien überhaupt nachprüfbar — sie sind keine im Nachhinein eingesickerten
  Designentscheidungen. Alles Weitere (Datenform des Katalogs, Typkonstrukte, Komponentenaufbau)
  bleibt offen und ist Sache von `/speckit-plan`.
- **Zielleser**: Nutzer und Betreiber des Toolkits, die den Ablauf verstehen wollen — die
  Beschreibungen sind absichtlich fachlich formuliert („was passiert dort"), nicht als
  Code-Erklärung. Ein Teil der Zielgruppe ist technisch; das liegt in der Natur des Features
  (Sichtbarkeit der eigenen Automatisierung) und nicht an der Spezifikation.
- **Nicht-Ziele** sind in FR-016 und im Input festgehalten: keine Editierbarkeit, keine neuen
  Auslöser, keine Stack-Verwaltung, keine Statusanzeige pro Schritt.
- Iterationen bis alle Punkte erfüllt: 1.

## Prosa-Review des Katalogs (T034, 30.07.2026)

Kein Test kann prüfen, ob eine Beschreibung *stimmt* (plan.md, Risiko-Tabelle) — die
Genauigkeit der 32 Schritt-Texte in `packages/shared/src/lifecycleCatalog.ts` wurde deshalb
einzeln gegen den Quelltext der referenzierten Symbole gegengelesen. Ergebnis:

- [x] Alle 32 Schritte gegen ihr Symbol gelesen: `worktrees.ts` (6), `orchestrator.ts` +
      `contextOptimizer.ts` + `featureDocuments.ts` + `commandBuilder.ts` (7),
      `orchestrator.ts` + `artifacts.ts` (6), `mergeQueueService.ts` + `verifyService.ts` +
      `agentGateService.ts` (7), `mergeQueueService.ts` + `mergeEngine.ts` +
      `conflictResolver.ts` (6).
- [x] Reihenfolge der Integrations-Schritte deckt sich mit dem Kontrollfluss in
      `MergeQueueService.beginIntegration` (Vorprüfungen → `commitWorktree` → `reconcile` →
      Verify → Review-Gate → Berichte-Commit → `enqueue`/`awaiting_human_review`).
- [x] Reihenfolge der Merge-Schritte deckt sich mit `MergeQueueService.processItem`
      (`reconcile` → `rebaseOnto` → `resolveConflicts` ≤ 3 → Re-Verify → `mergeIntoTarget`
      bzw. PR-Modus → `cleanupMerged`).
- [x] Zahlen und Grenzen aus dem Code übernommen, nicht geschätzt: höchstens 3
      Auflösungsversuche (`MAX_RESOLUTION_ATTEMPTS`), Nachtrag nach 8 s und am Ende des
      Nachlauffensters (`scheduleLateReconcile`), gespiegelt werden genau `.claude`,
      `CLAUDE.md`, `AGENTS.md` (`AGENT_CONFIG_PATHS`).
- [x] Die drei `orderNote`-Begründungen stehen so im Quelltext-Kommentar der jeweiligen
      Stelle (Serialisierung in `WorktreeManager.create`, Startmarke in `launchPhase`,
      Reset-Turn in `handleTurnCompleted`) bzw. in `beginIntegration` (Festschreiben vor
      Abgleich).
- [x] `notDoneHere` der Worktree-Anlage gegengeprüft: in `worktrees.ts` existiert kein
      Installations- oder Build-Schritt; `mirrorAgentConfig` kopiert ausschließlich die
      Agent-Konfiguration.
- [x] Eine Korrektur aus dem Review übernommen: „wird unverändert weiterverwendet" beim
      idempotenten Wiederverwenden war zu stark — auf diesem Pfad läuft `mirrorAgentConfig`
      mit. Formulierung geändert zu „wird weiterverwendet, ohne neu auszuchecken".

Nicht durch Tests gedeckt bleibt damit ausschließlich die inhaltliche Treffsicherheit der
Formulierungen; Existenz von Datei und Symbol sichert
`packages/server/src/services/lifecycleCatalogPaths.test.ts` bei jedem Lauf.
