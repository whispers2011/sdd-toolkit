# Phase 0 Research: Projektspezifisches Wissen

Die Spec enthält keine offenen `[NEEDS CLARIFICATION]`-Marker (via `/speckit-clarify` aufgelöst). Die hier dokumentierten Entscheidungen betreffen die technische Umsetzung im bestehenden SDD-Toolkit und wurden aus dem Bestandscode abgeleitet.

## D1 — Speicherort: SQLite als Single Source of Truth

**Decision**: Wissen wird in neuen, projekt-gescopten SQLite-Tabellen gespeichert (`knowledge_bundles`, `knowledge_entries`, `knowledge_feature_selection`), analog zur bestehenden `personas`-Tabelle. CRUD über typisiertes Repo (`KnowledgeRepo`).

**Rationale**: Sämtliche Domänendaten des Toolkits liegen bereits in SQLite (WAL) mit Migrations-Array + Repo-Muster (`database.ts`, `repos.ts`). Wissen ist projektweit und muss über alle Feature-Worktrees geteilt werden (FR-011) — eine zentrale DB erfüllt das ohne Git-Kopplung. „100 % im Toolkit verwaltbar" (FR-001) bedeutet: keine externe Dateibearbeitung nötig → DB-Backing ist die direkteste Umsetzung.

**Alternatives considered**:
- *Wissen als committete Dateien im Repo* (`.specify/memory/…`): Jede Bearbeitung würde Commits/Worktree-Sync erfordern und Merge-Konflikte erzeugen; widerspricht „ohne Dateien außerhalb des Toolkits bearbeiten" (SC-002). Verworfen.
- *Separate Wissens-DB je Projekt*: unnötige Komplexität; die bestehende DB ist bereits projekt-fähig (FK auf `projects`, `ON DELETE CASCADE`). Verworfen.

## D2 — Index als abgeleitete Projektion (nicht separat gepflegt)

**Decision**: Der „Projekt-Index" ist **keine** eigene gespeicherte, veränderliche Struktur, sondern eine **Projektion** über `knowledge_bundles`/`knowledge_entries` (Titel/Name + Anwendbarkeit + Hierarchie, **ohne** Inhalte). Berechnet on-demand in `KnowledgeRepo.index(projectId)` / pure `projectIndex()` in `@sdd/shared`.

**Rationale**: FR-006 fordert „automatische Aktualisierung ohne manuellen Neuaufbau" und SC-005 „100 % Konsistenz nach jeder Änderung". Eine Projektion ist per Konstruktion immer konsistent — es gibt keinen Zustand, der driften kann. Das eliminiert eine ganze Fehlerklasse und macht FR-006/SC-005 trivial erfüllbar. Bei ~Dutzenden Einträgen ist die Berechnung vernachlässigbar (< 50 ms).

**Alternatives considered**:
- *Materialisierte Index-Tabelle mit Update-Triggern/Hooks*: mehr Code, Trigger-Reihenfolge-Risiken, Staleness bei Fehlern. Der einzige Ort, an dem eine Kopie existiert (materialisierte Worktree-Datei, D5), wird bei jedem Phasenstart neu geschrieben und ist über die Re-Sync (FR-013) heilbar. Verworfen als Primärmechanismus.

## D3 — Datenmodell für Verschachtelung: Adjazenzliste (`parent_id`)

**Decision**: Bundles bilden einen Baum über `parent_id` (Self-Reference, `NULL` = Top-Level). Einträge hängen an einem Bundle (`bundle_id`, `NULL` = direkt unter Projekt). Baum-Aufbau als pure Funktion `buildKnowledgeTree()` in `@sdd/shared`.

**Rationale**: Einfachstes Modell für beliebig tiefe Verschachtelung (FR-003) bei kleiner Datenmenge; `ON DELETE CASCADE` räumt Teilbäume automatisch auf. Keine künstliche Tiefengrenze (Spec-Annahme). Zyklusvermeidung als Validierung im Repo/pure Funktion (Parent darf kein Nachfahre sein).

**Alternatives considered**: Materialized Path / Nested Sets — bei dieser Größenordnung Overkill. Verworfen.

## D4 — Anwendbarkeit + Relevanz-Vorschlag (hybrid)

**Decision**: Anwendbarkeit = Freitext (`applicability_text`) **plus** strukturierte Tags (`applicability_tags`, JSON-Array). Relevanz-Vorschlag ist **deterministisch** und pure (`scoreRelevance(index, featureSignal)`): Score aus (a) exaktem Tag-Treffer gegen Tokens aus Feature-Name + `spec.md` und (b) Token-Overlap des Freitexts. Ergebnis ist ein Vorschlag; der Nutzer übersteuert pro Feature (`include`/`exclude`, gespeichert in `knowledge_feature_selection`). Finale Auswahl = Auto-Vorschlag ⊕ Overrides.

**Rationale**: Deckt die Klärung „Hybrid" + „Freitext + Tags" (2026-07-22) ab. Kein separater LLM-Call nötig: Bei kompaktem Index kann die Session zusätzlich selbst relevante Bundles nachziehen (D5); die deterministische Vorauswahl bleibt günstig, reproduzierbar und testbar. Passt zum Automation-Dial (Vorschlag ≈ Level 3, manuelle Auswahl ≈ Level 2).

**Alternatives considered**:
- *LLM-Relevanz-Pass (headless Claude, `buildHeadlessArgv` vorhanden)*: möglich als spätere Ausbaustufe, für v1 unnötig teuer/nichtdeterministisch. Als Option notiert, nicht eingeplant.
- *Nur manuell*: verschenkt den Automatisierungsnutzen (FR-009). Verworfen.

## D5 — Bereitstellung an die Feature-Session (P4): Materialisierung + Index-First

**Decision**: Beim Phasenstart (additiv in `Orchestrator.startPhaseRun`) schreibt `knowledgeService.materializeForFeature(feature, phase)`:
1. `.sdd/knowledge/index.md` — **immer** (kompakt: Baum aus Titeln + Anwendbarkeit, keine Inhalte),
2. je selektiertem Element eine Inhaltsdatei unter `.sdd/knowledge/…` (bzw. Verweis auf die bestehende Repo-Datei bei `source='file'`),
3. `.sdd/` in `.git/info/exclude` (Muster wie `.sdd-tmp/`),
4. protokolliert die geladene Auswahl (FR-014).

Der Agent wird angewiesen, **zuerst den Index** zu lesen und **nur** die als relevant markierten Inhaltsdateien — „nicht jeder Context sofort" (FR-008).

**Injektionskanal — ENTSCHIEDEN (T029-Spike, umgesetzt)**: Gewählt wurde der **kompakte Präambel-Weg**: `materializeForFeature` gibt einen kurzen Pointer zurück, den der `Orchestrator` in `startPhaseRun`/`startAgentForApprovedChain` **an die Phasen-Prompt anhängt** (single-turn, kein zusätzlicher Turn, keine Repo-Provisionierung, keine spec-kit-Template-Änderung). Begründung: Der Bestandscode sendet genau eine Prompt pro Turn und wartet auf `turn_completed` — ein zweiter Priming-Turn wäre race-anfällig; die Präambel ist damit der einzige Weg, der garantiert im Kontext genau dieses Phasen-Turns liegt. Die Materialisierung ist best-effort (Fehler blockieren eine Phase nie). Der ursprünglich als Primärkandidat notierte **spec-kit-`before_*`-Hook** bleibt als spätere Ausbaustufe möglich (das Dateiformat aus `materialized-layout.md` ist kanalunabhängig stabil), ist für v1 aber bewusst nicht nötig.

**Rationale**: Materialisierung als Dateien nutzt exakt das vorhandene Worktree-Datei-Muster (`.sdd-tmp/`, `.git/info/exclude` in `api/server.ts`) und hält die Feature-Diffs sauber (Constraint). „Index-first, Inhalte nur bei Relevanz" erfüllt FR-008/SC-003 direkt. Der Injektionskanal ist der einzige nennenswerte Design-Risiko-Punkt und wird bewusst als benannte Entscheidung mit Primär- + Fallback-Weg offen gehalten, statt fragile Details vorwegzunehmen.

**Alternatives considered**:
- *Zwei sequentielle Prompts (Priming + Slash-Command)*: riskiert Race mit dem interaktiven Turn-Modell (`sendPrompt` + `turn_completed`). Verworfen als Primärweg.
- *Wissen in `/api/state`-Bootstrap + In-Context ohne Dateien*: bläht den Bootstrap auf und liefert der CLI-Session nichts Lesbares. Verworfen.

## D6 — Transport ins Frontend: on-demand + `knowledge_updated`-Event

**Decision**: Wissen wird **nicht** in `/api/state` gebootstrappt. Neue REST-Endpunkte liefern Baum/Index pro Projekt on-demand; ein neues Bus-Event `knowledge_updated` (`{ projectId }`) triggert im Web einen gezielten Refetch. Ergänzung in `events.ts` (`BusEvents` + `BUS_EVENT_NAMES`) und `store.tsx`.

**Rationale**: Spiegelt das bestehende `executions`-Muster (on-demand geladen, nicht im Bootstrap). Hält `/api/state` schlank und die WS-Nutzlast klein (nur Invalidierung, keine Volldaten). Die WS-Broadcast-Schleife in `api/server.ts` iteriert bereits generisch über `BUS_EVENT_NAMES` — additiv ohne Sonderfall.

**Alternatives considered**: Volle Wissensbäume via WS pushen — unnötige Nutzlast, Skalierungsrisiko. Verworfen.

## D7 — Import bestehender Repo-Dateien (FR-015)

**Decision**: Ein Eintrag hat `source ∈ {'inline','file'}`. Bei `'file'` speichert `source_path` (repo-relativ) den Verweis; der Body wird beim Anlegen/Refresh aus der Datei im Projekt-Checkout gelesen (kein Duplizieren als Pflichtkopie). Import-Aktion in `knowledgeService`.

**Rationale**: Deckt die Klärung „Erfassen + Importieren" (2026-07-22) und FR-015. Referenzierte Dateien bleiben in ihrer Quelle; die Materialisierung (D5) kann direkt auf den Repo-Pfad verweisen. Kontinuierliches Watching externer Änderungen ist out-of-scope (Spec-Annahme) — Drift wird über Re-Sync/Refresh (FR-013) abgefangen.

**Alternatives considered**: Datei-Inhalt beim Import hart kopieren und einfrieren — verliert die Quelle-Aktualität. Verworfen (Refresh-on-read gewählt).

## Zusammenfassung offener Punkte

| Punkt | Status |
|-------|--------|
| Injektionskanal Session (D5) | **Entschieden & umgesetzt**: Prompt-Präambel (single-turn) |
| LLM-Relevanz (D4) | Bewusst nach v1 verschoben |
| Watching externer Datei-Änderungen (D7) | Out-of-scope v1 (Re-Sync deckt Drift) |

Alle übrigen Entscheidungen sind festgelegt; keine `NEEDS CLARIFICATION` offen.
