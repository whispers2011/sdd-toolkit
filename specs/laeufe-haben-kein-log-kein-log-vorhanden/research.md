# Phase 0 Research: Läufe haben kein Log

Alle offenen Punkte aus der Spec sind über die Clarifications (Session 2026-07-23) und die
Code-Analyse aufgelöst. Keine verbleibenden `NEEDS CLARIFICATION`.

## R1 – Warum fehlt das Log bei Phasen-Läufen?

- **Decision**: Ursache identifiziert — Phasen-Läufe schreiben keine Log-Datei.
- **Rationale**: Der Endpoint `GET /api/executions/:id/log` liest per Konvention
  `<dataDir>/logs/<id>.log` (`server.ts:892`). Verify (`verifyService.ts:24`), Review
  (`reviewGateService.ts:68`), Konfliktauflösung (`conflictResolver.ts:25`) und Chat
  (`chatService.ts:181`) schreiben diese Datei via `createWriteStream`. Der Orchestrator
  startet Phasen-Läufe mit `logPath: null` (`orchestrator.ts:224`) und hält Ausgabe nur im
  In-Memory-`session.scrollback` (`orchestrator.ts:470`, ausschließlich fürs Metering).
  → Für Phasen-Läufe existiert nie eine Datei → 404 „Kein Log vorhanden".
- **Alternatives considered**: (a) Scrollback beim Turn-Ende in eine `.log`-Datei schreiben
  — verworfen: Scrollback ist verrauscht (ANSI/TUI-Redraws), flüchtig (Neustart-Verlust,
  `SCROLLBACK_LIMIT`), und widerspricht Clarification Q1.

## R2 – Log-Quelle: Transkript statt Scrollback

- **Decision**: Log-Inhalt wird aus dem Claude-Transkript-Ausschnitt des Laufs gerendert.
- **Rationale**: Clarification Q1 = „Bereinigtes Transkript". Das Transkript
  (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) ist strukturiertes JSONL, liegt
  dauerhaft auf Platte (überlebt Neustart, FR-001) und ist bereits die autoritative Quelle
  fürs Token-Metering (`readTranscriptDelta` + `sumUsage`). Bausteine existieren:
  `locateTranscript`, `transcriptSize`, `readTranscriptDelta`, `parseClaudeTranscriptLine`,
  `assistantTextFromTranscriptLine`, `encodeClaudeCwd` (alle in `transcriptWatcher.ts` /
  `@sdd/shared`).
- **Alternatives considered**: Rohen Terminal-Verlauf speichern (verworfen, s. Q1);
  Mischform „roh speichern / bereinigt zeigen" (verworfen — mehr Speicher/Code ohne Nutzen).

## R3 – Pro-Lauf-Attribution (kein Vermischen, FR-003)

- **Decision**: Ausschnitt `[transcript_offset_start, transcript_offset_end)` je Lauf.
- **Rationale**: Beim Phasen-Start wird `transcript_offset_start` bereits erfasst
  (`orchestrator.ts:218`, gespeichert in `executions`). Beim Abschluss wird die aktuelle
  Transkriptgröße als `transcript_offset_end` festgehalten. Da die persistente Session das
  Transkript über mehrere Phasen hinweg **anhängt**, grenzt das Byte-Intervall genau den
  einen Lauf ab. Der Watcher-Code belegt append-only Semantik (Offset nur bei
  Kürzung/Ersetzung zurückgesetzt, `transcriptWatcher.ts:118`).
- **Alternatives considered**: Nur bis EOF lesen (verworfen — nachfolgende Phasen hätten
  angehängt → Vermischung, verletzt FR-003).

## R4 – Laufende Läufe (FR-005)

- **Decision**: On-demand-Rendering deckt „running" automatisch ab; `offset_end` bei
  laufendem Lauf `NULL` → bis zur aktuellen Transkriptgröße lesen. Transkriptpfad bei
  laufendem Lauf aus der Live-Session (`deps.ptys.forFeature(featureId)` →
  `locateTranscript(cwd, claudeSessionId)`).
- **Rationale**: Kein Streaming nötig; erneutes Öffnen/periodisches Nachladen zeigt neuen
  Inhalt (FR-005 „refresh on reopen"). Bei bereits abgeschlossenen Läufen wird der
  persistierte `transcript_path` genutzt (session-unabhängig, neustartfest).
- **Alternatives considered**: WebSocket-Live-Stream des Logs (verworfen — Over-Engineering
  für einen Audit-Trail; Konsole zeigt bereits live).

## R5 – Endpoint-Kompatibilität & Altbestände (FR-004, FR-007)

- **Decision**: Endpoint priorisiert die physische `<id>.log`-Datei; nur wenn keine
  existiert und der Lauf `kind='phase'` mit Transkript-Koordinaten ist, wird gerendert;
  sonst 404 „Kein Log vorhanden".
- **Rationale**: Datei-basierte Arten bleiben unverändert (FR-007). Vor-Fix-Phasenläufe
  ohne gespeicherte Koordinaten → korrekt 404 (FR-004, keine Rekonstruktion möglich).
- **Alternatives considered**: Alle Arten aufs Transkript umstellen (verworfen —
  unnötiger Umbau, größerer Blast-Radius).

## R6 – Renderer-Format (Bereinigung, FR-006)

- **Decision**: `renderTranscriptLog(lines: string[]): string` als pure Funktion in
  `@sdd/shared`. Zeilenweise: User-Prompt (ohne reine tool_result-Zeilen), Assistant-Text,
  Tool-Aufrufe (`tool_use` → Name + kompakter Input), optional gekürzte `tool_result`;
  Abbruch-Marker (`INTERRUPT_MARKER_PREFIX`) sichtbar machen; `meta`/`summary` überspringen.
  Ausgabe ist reiner UTF-8-Text ohne ANSI/Steuerzeichen.
- **Rationale**: Erfüllt FR-006 (lesbar, bereinigt) und ist als reine Funktion
  deterministisch unit-testbar (Repo-Konvention). Nutzt vorhandene Parser aus `transcript.ts`.
- **Alternatives considered**: Anzeige-Bereinigung erst im Web (verworfen — Logik gehört in
  `shared`, testbar, wiederverwendbar; hält Transport klein).

## R7 – Große Logs (FR-009)

- **Decision**: Vollständig, ohne Größenbegrenzung (Clarification Q2). Web-`<pre>` scrollt
  bereits (`overflow-auto`).
- **Rationale**: Konsistenz mit den datei-basierten Arten (die ihr ganzes Log schreiben).
- **Alternatives considered**: Anzeige-/Schreib-Kappung (verworfen, s. Q2).
