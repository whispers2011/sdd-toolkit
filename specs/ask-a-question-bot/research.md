# Research: Ask-a-Question-Bot (Projekt-Chat)

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Datum**: 2026-07-22

Alle offenen Punkte aus dem Technical Context sind hier entschieden; es verbleiben keine NEEDS CLARIFICATION.

## R1: Ausführungsmodell der Chat-Turns — Headless statt PTY

- **Decision**: Pro Chat-Turn ein kurzlebiger Headless-Lauf: `claude -p "<nutzereingabe>" --output-format stream-json --include-partial-messages --resume <claude_session_id>` via `node:child_process.spawn` (kein PTY). Neuer Builder `buildChatArgv()` in `pty/commandBuilder.ts` neben dem bestehenden `buildHeadlessArgv()`.
- **Rationale**: stream-json liefert strukturierte Nachrichten und Text-Deltas → direkt als Chat-Bubbles renderbar und streambar (SC-003 „Antwort beginnt sichtbar zu werden"). Die `session_id` aus dem stream-json-`init`/`result`-Event wird persistiert und ermöglicht Mehr-Turn-Kontinuität sowie Fortsetzung über App-Neustarts (FR-009). Der Headless-Spawn-Pfad existiert bereits (`conflictResolver.ts`, `reviewGateService.ts`) — nur das Output-Format und Resume sind neu.
- **Alternatives considered**:
  - *PTY-Session mit Claude-TUI* (wie Feature-Konsolen): verworfen — raw Terminal statt Chat-UI im kleinen Panel, Schreibrechte schwerer zu begrenzen, Scrollback statt strukturierter Nachrichten macht Persistenz/Proposal-Parsing fragil.
  - *Headless mit `--output-format text`* (bestehender Pfad): verworfen — kein Streaming, keine `session_id` → weder SC-003 noch Resume erfüllbar.
  - *Agent SDK / eigener API-Client*: verworfen — neue Abhängigkeit und zweiter Provider-Pfad; das Toolkit standardisiert bewusst auf die Claude-Code-CLI.

## R2: Read-only-Garantie (FR-004)

- **Decision**: Drei Schichten: (1) `cwd` = Projekt-Root (`projects.path`), **kein** Worktree und kein `--add-dir`; (2) explizite Tool-Whitelist `--allowedTools "Read,Grep,Glob"` — im Headless-Modus werden alle nicht freigegebenen Tools (Write, Edit, Bash, …) automatisch verweigert, da niemand Permission-Prompts beantworten kann; (3) **kein** `--permission-mode acceptEdits` (Unterschied zum bestehenden `buildHeadlessArgv`).
- **Rationale**: Erzwingt „rein lesend" mechanisch statt nur per Prompt-Bitte; reines Chatten kann prinzipbedingt keine Dateien, Branches oder Worktrees erzeugen. Die Feature-Anlage läuft ausschließlich über den bestehenden Server-Endpoint nach UI-Bestätigung — nie durch die Chat-Session selbst.
- **Alternatives considered**: Nur System-Prompt-Anweisung (verworfen: nicht erzwungen); Sandbox/Container (verworfen: Overkill für lokale Einzelplatz-App); `--disallowedTools`-Blacklist (verworfen: Whitelist ist enger und zukunftssicher bei neuen Tools).

## R3: Persistenz — neue Tabellen statt Snapshot-Wiederverwendung

- **Decision**: Neue Migration (ans Ende des `MIGRATIONS`-Arrays in `db/database.ts`) mit `chat_conversations` (eine aktive pro Projekt, hält `claude_session_id`) und `chat_messages` (geordnete Nachrichten inkl. Vorschlag-JSON und Turn-Status). Neuer `ChatRepo` in `db/repos.ts` nach bestehendem Repo-Muster (nanoid(10), Prepared Statements, `toX`-Mapper). Details in [data-model.md](./data-model.md).
- **Rationale**: Es existiert kein Message-Store (Feature-Sessions persistieren nur Terminal-Scrollback-Snapshots + Claudes JSONL). Chat-Bubbles, Vorschlag-Status und Neustart-Fortsetzung brauchen strukturierte Zeilen; SQLite-Repos sind das etablierte Muster.
- **Alternatives considered**: Scrollback-Snapshots wie `snapshotStore.ts` (verworfen: unstrukturiert, kein Vorschlag-Status); Claudes JSONL als einzige Quelle (verworfen: wird nach ~30 Tagen gepruned, Format extern nicht garantiert).

## R4: Resume-Fallback nach Transcript-Pruning

- **Decision**: Schlägt ein Turn mit `--resume` fehl (Claude pruned JSONL nach ~30 Tagen — gleiche Problematik wie bei `Orchestrator.ensureSession`), wird derselbe Turn einmalig ohne `--resume` neu gestartet; die neue `session_id` ersetzt die alte. Dem Neustart-Turn werden die letzten 10 Nachrichten aus der DB als kompakter Kontextblock im Prompt vorangestellt.
- **Rationale**: Verlauf bleibt für den Nutzer lückenlos sichtbar (DB), Gesprächskontext bleibt näherungsweise erhalten, kein Datenverlust-Fehlerfall Richtung Nutzer (Edge Case „Fehler beim Start" aus der Spec wird nur bei echtem Spawn-Fehler gezeigt).
- **Alternatives considered**: Harter Fehler mit „Neue Unterhaltung nötig" (verworfen: unnötig nutzerfeindlich); kompletten Verlauf re-injizieren (verworfen: Prompt-Größe unbegrenzt).

## R5: Feature-Vorschlag-Protokoll (FR-005/FR-006)

- **Decision**: System-Prompt via `--append-system-prompt` (neuer Prompt-Builder `services/chatPrompt.ts`: Projektname/-pfad, Rolle „Q&A-Assistent", Regel „nur bei feature-würdigem Umfang, nie bei einfachen Fragen"). Der Assistent emittiert Vorschläge als Marker im Antworttext: `<feature-vorschlag name="kebab-slug">Anforderungsbeschreibung…</feature-vorschlag>`. Eine reine Parser-Funktion (`shared/src/chatProposal.ts`) extrahiert den Marker, entfernt ihn aus dem Anzeigetext und legt ihn strukturiert (`name`, `description`, Status `offen`) auf der Assistenten-Nachricht ab. Die UI rendert daraus eine Karte mit „Feature anlegen" / „Ablehnen".
- **Rationale**: Ein einziger Modell-Lauf pro Turn (keine Zusatz-Latenz/-Kosten), deterministisch parsebar, testbar als Pure Function (passt zur Testkultur). Das Muster „Prompt-Vertrag + Parser" existiert bereits (`parseVerdict` im ReviewGateService).
- **Alternatives considered**: Separater Klassifikations-Call pro Nachricht (verworfen: doppelte Kosten/Latenz); MCP-Tool „createFeature" für die Session (verworfen: Session könnte Features anlegen → verletzt FR-004/FR-005-Schutzprinzip, Zustimmung muss in der Toolkit-UI liegen); JSON-only-Antwortformat (verworfen: zerstört normale Chat-Antworten).

## R6: Streaming zum Client

- **Decision**: Zwei neue Bus-Events in `events.ts` (+ `BUS_EVENT_NAMES`): `chat_stream` (`{projectId, conversationId, messageId, delta, done}`) und `chat_updated` (`{projectId, conversationId}`), ausgeliefert über den bestehenden `/ws/events`-Broadcast; Behandlung im `ws.onmessage`-Switch von `store.tsx`. Payload-Details in [contracts/chat-api.md](./contracts/chat-api.md).
- **Rationale**: Exakt das etablierte Event-Muster (`feature_updated`, `notification`, …); Single-User-Broadcast ist ausreichend; kein zweiter WS-Endpoint nötig. Läuft die Antwort weiter, während das Panel geschlossen ist, geht nichts verloren — beim Öffnen wird der Stand aus der DB geladen und der Stream läuft weiter (Edge Case aus der Spec).
- **Alternatives considered**: Eigener WS-Endpoint wie `/ws/terminal/:sessionId` (verworfen: Mehraufwand ohne Nutzen, kein bidirektionaler Bedarf); Polling (verworfen: SC-003-Streaming-Gefühl).

## R7: Kosten-Erfassung (Deferred-Punkt aus /speckit-clarify)

- **Decision**: Ja, Chat-Turns erscheinen im Cost-Metering: pro abgeschlossenem Turn eine `executions`-Zeile mit neuem `kind: 'chat'` (`ExecutionKind`-Union in `types.ts` erweitern), `project_id` gesetzt, `feature_id` NULL (Spalte ist nullable). Kosten primär aus dem stream-json-`result`-Event (liefert Usage/Kosten), Fallback `costMeter.meter()`.
- **Rationale**: Chat-Kosten werden sichtbar im bestehenden Executions-/Kosten-View, ohne neue Aggregations-Infrastruktur.
- **Alternatives considered**: Kosten nur auf `chat_messages` (verworfen: unsichtbar für bestehende Auswertung); gar nicht metern (verworfen: Toolkit misst sonst überall).

## R8: Nebenläufigkeit, Recovery, Lebenszyklus

- **Decision**: Genau eine laufende Antwort pro Unterhaltung (In-Memory-Map `conversationId → ChildProcess` im `ChatService`); Senden während ein Turn läuft → HTTP 409, UI deaktiviert den Senden-Button. Beim Server-Boot werden Nachrichten mit Status `streaming` auf `interrupted` gesetzt (analog `reapOnBoot`-Muster). „Neue Unterhaltung" beendet die aktive Konversation (`ended_at`) und legt eine frische an; alte Zeilen bleiben in der DB, werden aber nicht mehr angezeigt (Spec: keine Historienliste). Timeout pro Turn: 20 min (wie bestehende Headless-Läufe).
- **Rationale**: Erfüllt die Edge Cases „Vorschläge nacheinander", „Panel zu während Antwort läuft", „App-Neustart"; minimale Mechanik ohne Queue-Infrastruktur.
- **Alternatives considered**: Eingabe-Queue (verworfen: YAGNI für Single-User); Abbrechen-Button (bewusst nicht in Scope der Spec; kann später ergänzt werden).

## R9: Übergabe in den Anlege-Dialog (FR-006)

- **Decision**: `NewFeatureDialog` aus `Sidebar.tsx` in eine eigene, exportierte Komponente `components/NewFeatureDialog.tsx` extrahieren und um optionale Props `initialName`/`initialDescription` erweitern; `Sidebar` nutzt sie unverändert (leer), das Chat-Panel öffnet sie vorbefüllt aus der Vorschlag-Karte. Nach erfolgreichem `api.createFeature` markiert das Panel den Vorschlag als `angenommen` (inkl. `featureId`), der Chat bestätigt und verlinkt die Konsole des neuen Features (bestehendes `set_view`-Muster); Dialog-Abbruch lässt den Vorschlag `offen` (Edge Case).
- **Rationale**: Exakt der bestehende Anlege-Weg (FR-007: gleicher Lebenszyklus — `createFeature` legt Worktree + DB-Zeile an und startet mit Beschreibung automatisch die Specify-Phase); keine Duplikation des Dialogs.
- **Alternatives considered**: Direktes Anlegen ohne Dialog (durch /speckit-clarify explizit verworfen — Nutzer will prüfen/anpassen); eigener Chat-Anlege-Dialog (verworfen: Duplikation).
