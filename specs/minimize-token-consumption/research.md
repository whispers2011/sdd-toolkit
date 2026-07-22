# Phase 0 – Research: Token-Verbrauch im SDD-Flow minimieren

Alle offenen Punkte aus dem Technical Context sind aufgelöst; keine `NEEDS CLARIFICATION` verbleiben. Die Entscheidungen sind in der bestehenden Codebase verankert (Datei-/Zeilen-Referenzen).

---

## A. Autoritative Token-Messung pro Phase (P1, FR-002, SC-004)

**Decision**: Den realen Verbrauch aus dem **Claude-Transkript-JSONL** je Phasen-Execution auslesen. Beim Phasenstart wird die aktuelle Transkript-Dateigröße (Byte-Offset) festgehalten; beim Turn-Ende werden die neuen Zeilen (`assistant`-Zeilen mit `message.usage`) geparst und summiert:
`input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`. Kosten aus denselben Komponenten × Preistabelle. Quelle = `transcript`.

**Rationale**:
- Der Toolkit lokalisiert das Transkript bereits (`packages/server/src/pty/transcriptWatcher.ts:18` `locateTranscript`), liest es offset-basiert (`TranscriptWatcher.drain`, `:68`) und parst Zeilen (`packages/shared/src/transcript.ts:27` `parseClaudeTranscriptLine`). Das Muster (Offset-Fenster) ist erprobt.
- Ein Stichprobenzeile bestätigt die Felder: `usage = {input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, ...}`. `cache_read_input_tokens` (Beispiel: 20 874) macht den **akkumulierten Kontext** sichtbar — genau den Treiber, den P2 senkt und den die heutige Schätzung komplett verfehlt.
- Heute misst `handleTurnCompleted` (`orchestrator.ts:358-360`) `outputText = scrollback.slice(start)` und `promptText = "/speckit-… + Präambel"` → `estimateTokens` (~4 Zeichen/Token, `costMeter.ts:26`). Das erfasst gerenderten Terminaltext, **nicht** die real gesendeten Tokens.

**Attribution**: Execution-Zeile bekommt `transcript_offset_start` (gesetzt in `startPhaseRun`, analog zu `scrollbackStart` in `RunningPhase`, `orchestrator.ts:50-52`). Beim Turn-Ende Delta ab Offset parsen. Mehrere Turns innerhalb einer Phase → aufsummiert (deckt FR-001 „Mehrfachläufe" ab).

**Fallback (FR-002)**: Fehlt das Transkript oder keine Usage-Zeile → bestehende `meter()`-Schätzung, Quelle `estimated`. Explizit im Terminaloutput geparste Usage → `parsed`. Die Quelle wird pro Execution gespeichert und in der UI als Badge gezeigt (SC-004).

**Alternatives considered**:
- *Terminal-Scrollback schätzen* (heute): verfehlt Cache-/Kontext-Tokens dramatisch → verworfen (nur Fallback).
- *Phasen in `stream-json` fahren* (wie Chat, `chatStream.ts:52`): bräche die persistente interaktive `--resume`-Konsole (Kern-UX „echte Konsole pro Feature") → verworfen.
- *Hook-Events*: der Hook-Bridge-JSONL trägt Status, keine Token-Usage → ungeeignet.

---

## B. Smarte Kontext-Übergabe (P2, FR-004, FR-011)

**Decision**: Vor dem Start einer **Downstream**-Phase den akkumulierten Sitzungskontext gezielt zurücksetzen, gesteuert durch `contextStrategy`:
- `full` — heutiges Verhalten (`--resume`, Verlauf akkumuliert).
- `compact` — vor dem Phasen-Slash-Command ein `/compact` in dieselbe Session senden (Verlauf wird zusammengefasst; sicherste Reduktion).
- `fresh` — Kontext vor der Phase leeren (`/clear`), sodass die Phase nur ihre von Disk gelesenen Artefakte + Wissen trägt (maximale Reduktion).

Default der ersten Ausbaustufe: **`compact`** (sicher). `fresh` ist für die schweren Phasen (`plan`, `implement`) der große Hebel und wird per A/B geprüft.

**Rationale**:
- Der größte Treiber ist die persistente `--resume`-Session (`orchestrator.ts:133-149`, `ensureSession`), die jeden Vorphasen-Turn im Kontext hält; jede Folgephase zahlt ihn erneut als Cache-Read/Input.
- Die Phasen sind **artefakt-getrieben**: die gebündelten speckit-Skills lesen `spec.md`/`plan.md`/`tasks.md` jede Phase frisch von Disk (bestätigt in `.claude/skills/speckit-*/SKILL.md`). Der Gesprächsverlauf ist daher zwischen Phasen weitgehend redundant → Reset ist sicher.
- Umsetzung minimalinvasiv: Reset-Kommando als PTY-Prompt **vor** dem Phasen-Command senden (`ptys.sendPrompt`, genutzt in `orchestrator.ts:194`). Prozess/`sessionId` bleiben gleich → `TranscriptWatcher`/Statuslogik bleiben gültig.

**Guard (FR-010)**: Scheitert der Reset oder fehlt ein benötigtes Artefakt auf Disk (`artifactExists`, `artifacts.ts`), fällt der Optimizer auf `full` zurück und protokolliert das. Reset wird nie für die erste Phase (`specify`) eines Features angewandt.

**Scope (FR-011)**: Nur Phasen-Läufe (`kind:'phase'`, gestartet in `startPhaseRun`/`startAgentForApprovedChain`). Chat/verify/review/Konfliktauflösung unangetastet.

**Alternatives considered**:
- *Pro Phase frische `claude`-Session ohne `--resume`*: sauberste Trennung, aber verliert die „eine Konsole pro Feature" und Scrollback-Kontinuität → als spätere Option notiert, nicht Default.
- *Artefakt-Inhalte selbst in den Prompt injizieren & trimmen*: der Toolkit injiziert heute keine Artefaktinhalte (Skills lesen sie) — ein Umbau würde die Skills forken → verworfen.

---

## C. Verdichtung signalarmer Inhalte (P3, FR-005, FR-009)

**Decision**: Deterministischer Kompressor (`contextCompressor`, pure) auf **toolkit-injizierte** Inhalte anwenden: materialisierte Wissens-Bodies (`knowledgeService.ts:124-135`), Index-Präambel und `extraPrompt`. Operationen: ANSI strippen (`stripAnsi`, `costMeter.ts:21`), mehrfache Leerzeilen kollabieren, wiederholte Zeilen deduplizieren, überlange Code-/Log-Blöcke mit Auslassungsmarker kürzen, Boilerplate droppen. **Standard deterministisch** (keine Modellaufrufe → garantierte Netto-Ersparnis).

Optionale **LLM-Verdichtung** (headless `claude -p`, `buildHeadlessArgv`, `commandBuilder.ts:30`) als zuschaltbarer Schritt, aber nur wirksam, wenn `gesparte_tokens > für_die_zusammenfassung_ausgegebene_tokens` (Netto-Ersparnis-Guard); andernfalls Verwerfen und deterministisches Ergebnis nutzen.

**Rationale**: Deckt Klärung „beides, konfigurierbar" ab; deterministischer Default verhindert selbst-verursachte Kosten (Edge Case „LLM-Verdichtung ohne Netto-Ersparnis"). Der Kompressor ist pure/Testbar in `@sdd/shared`.

**Audit (FR-009)**: Jede Verdichtung liefert ein `CompressionReport` (Bytes/Tokens vorher/nachher, Liste ausgelassener Blöcke); protokolliert und optional an die Execution referenziert.

**Realistischer Umfang**: Da der Toolkit keine Artefaktinhalte injiziert, ist P3s deterministischer Zielbereich das materialisierte Wissen + Präambeln. Der große Feature-Gesamt-Hebel bleibt P2; P3 ist additiv (daher P3-Priorität).

---

## D. Konfiguration & Reversibilität (FR-008)

**Decision**: `OptimizationSettings` analog zu `AutomationSettings` (`types.ts:46-73`) mit Auflösung **global → Projekt → Feature** (`resolveAutomation`-Muster, `types.ts:273`):
- `contextStrategy: 'full' | 'compact' | 'fresh'`
- `compression: 'off' | 'deterministic' | 'llm'`

Persistenz: globaler Default im `settings`-Key (`SettingsRepo`), Projekt-Override in einer `projects`-JSON-Spalte (wie `automation`), Feature-Override in `features.automation`-Analogon. **Reversibel**: `full` + `off` = exakt heutiges Verhalten, ohne Datenverlust.

**Rationale**: Bewährtes, getestetes Muster (`resolveAutomation` + `LEVEL2/3_DEFAULTS`); niedriges Risiko; erfüllt FR-008 direkt.

---

## E. A/B-Nachweis am selben Feature (SC-001, FR-007)

**Decision**: Jede Execution speichert die **aktiven** Optimierungs-Settings (`opt_context_strategy`, `opt_compression`). Der Kosten-Breakdown-Endpoint kann Executions nach Strategie gruppieren; der A/B-Nachweis vergleicht denselben Feature-Ablauf einmal mit `full/off` und einmal mit der Optimierung — identische (transkript-basierte) Messmethode auf beiden Seiten.

**Rationale**: Da zwei verschiedene Features nie gleich groß sind (Edge Case „Vergleichbarkeit"), erfolgt der Nachweis am selben, reproduzierbaren Referenz-Feature. Die pro-Execution gespeicherte Strategie macht die Zuordnung eindeutig und den relativen Delta belastbar, auch wenn Absolutwerte teils geschätzt bleiben.

**Alternatives considered**: Vergleich zweier verschiedener Features (unfair, Größenunterschied) → verworfen. Nur globale Vorher/Nachher-Summe (vermischt Läufe) → verworfen.

---

## F. Test- & Qualitätsstrategie (FR-006, SC-002)

**Decision**:
- Unit-Tests (`@sdd/shared`): `transcriptUsage` (Usage-Summierung, fehlende/teilweise Felder, kaputte Zeilen), `contextCompressor` (Idempotenz, Erhalt relevanter Zeilen, Report-Korrektheit), `costBreakdown` (Rollup je Phase/Art, Mehrfachläufe, Quelle-Mix), `resolveOptimization` (Override-Präzedenz).
- Server-Tests (In-Memory-DB): Migration additiv, `ExecutionRepo.aggregateByFeature`, Orchestrator sendet Reset nur bei Downstream-Phasen und fällt bei fehlendem Artefakt auf `full` zurück.
- Qualitäts-Gleichheit (SC-002): Der A/B-Lauf mit Optimierung muss dieselben Gates bestehen (Spec-Checkliste, Review-Gate `VERDICT: PASS`, Verify-Pipeline). Reduktion hängt sich **vor** die Kontext-Übergabe, nie in die Gates.

**Rationale**: Folgt dem bestehenden Testmuster und operationalisiert „ohne Qualitätsminderung" über vorhandene Gates statt neuer, subjektiver Kriterien.
