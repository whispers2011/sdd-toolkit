# Implementation Plan: Token- und Kostenmessung aus der Telemetrie der Claude-CLI

**Branch**: `feature/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau/spec.md`

## Summary

Die Verbrauchsmessung wechselt von „aus der Transkriptdatei rekonstruieren" auf „die CLI meldet
es selbst". Das Toolkit startet jeden Claude-Prozess mit aktivierter OpenTelemetry und einer
eigenen Marke in den Ressourcen-Attributen, nimmt die Ereignisse über eine neue Route
`POST /v1/logs` auf dem bestehenden Server entgegen und schreibt jede einzelne API-Anfrage dem
Lauf zu, der zu ihrem Zeitstempel aktiv war.

Der Kern der Verbesserung ist nicht „andere Zahlenquelle", sondern **der Wegfall der
Startmarke**: Heute muss `orchestrator.startOffsetIn` erraten, ab welchem Byte einer
fortlaufenden Datei ein Lauf beginnt — dort entstand der Lauf mit 62 Mio. Tokens. Künftig
trägt jede Meldung ihren eigenen Zeitstempel und ihre eigene Session-Marke; es kann nur
ankommen, was während des Laufs entstanden ist.

Ausgewertet wird ausschliesslich das Ereignis `claude_code.api_request`. Es liefert alles in
einem Datensatz: die vier Token-Arten getrennt, den Geldbetrag (`cost_usd_micros`), das Modell,
eine `request_id` als Dedupe-Schlüssel und `query_source` als Herkunft (Hauptagent / Subagent /
Hilfsanfrage) — womit der heute komplett fehlende Subagenten-Anteil ohne zweite Datenquelle
mitzählt. Die Transkript-Messung bleibt unverändert als Rückfallebene bestehen und wird nie
zusätzlich addiert.

Alle technischen Annahmen sind am installierten Binary (Claude Code 2.1.220) belegt — statisch
und in einem Live-Probelauf gegen einen lokalen Empfänger. Details und die verworfenen
Alternativen: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js ≥ 20, ESM · pnpm-Workspace

**Primary Dependencies**: Fastify 5 (Server), better-sqlite3 12 (Ablage), node-pty 1
(Sessions), chokidar 4 (Datei-Watcher), React 19 + Tailwind (Web).
**Keine neue Laufzeit-Abhängigkeit** — der OTLP-Empfang läuft über `http/json` als
Fastify-Route über einem JSON-Objekt (siehe research.md D3).

**Storage**: SQLite unter `~/.sdd-toolkit`, Schema über die fortlaufende `MIGRATIONS`-Liste in
`packages/server/src/db/database.ts`. Dieses Feature hängt genau eine additive Migration an.

**Testing**: Vitest je Paket (`pnpm test`), `tsc --noEmit` je Paket (`pnpm typecheck`).
Schwerpunkt auf reinen Funktionen in `@sdd/shared` — Parser, Einstufung, Zuordnung,
Aggregation sind ohne IO testbar und tragen die Korrektheitsargumente des Features.

**Target Platform**: Lokaler Entwicklerrechner (macOS/Linux), Server an `127.0.0.1` gebunden.

**Project Type**: TypeScript-Monorepo, drei Pakete: `packages/shared` (reine Logik + Typen),
`packages/server` (Fastify, PTY, SQLite), `packages/web` (React-SPA).

**Performance Goals**: Session-Start zusätzlich < 1 s (SC-007) — der Beitrag ist das Setzen von
Umgebungsvariablen, also praktisch null. Verarbeitung eines OTLP-Stapels darf den Ereignis-Loop
nicht spürbar blockieren; gemessene Stapelgrössen 3–19 KB alle 5 s je aktiver Session.

**Constraints**:
- Die sichtbare Terminalausgabe der Session darf sich nicht ändern (FR-029) — deshalb Empfang
  über HTTP an den Server, nicht über den Konsolen-Exporter der CLI.
- Empfang ausschliesslich lokal, keine Übermittlung nach aussen (FR-028).
- Keine Inhaltsdaten (FR-027) — Inhalts-Schalter explizit aus, und nur `api_request` wird
  überhaupt ausgewertet.
- Ein Ausfall der Telemetrie darf keinen Session-Start blockieren (FR-020).
- Bestandsläufe bleiben unverändert (FR-025) → nur additive, `NULL`-fähige Spalten.

**Scale/Scope**: Einzelnutzer-Werkzeug; wenige gleichzeitige Sessions, Läufe im Minuten- bis
Stundenbereich. Ungebundene Datenmengen entstehen nur im Zwischenpuffer und sind dort zeitlich
und mengenmässig gedeckelt (FR-030).

## Constitution Check

`.specify/memory/constitution.md` ist im Auslieferungszustand — sämtliche Prinzipien sind noch
Platzhalter (`[PRINCIPLE_1_NAME]`, `[PRINCIPLE_1_DESCRIPTION]`, …). Es sind daher **keine Gates
definiert, die dieser Plan verletzen oder erfüllen könnte**; die Prüfung entfällt mangels
Inhalt, nicht mangels Beachtung.

Ersatzweise gelten die im Repository niedergeschriebenen Regeln, gegen die der Plan geprüft
wurde:

| Regel (Quelle) | Bewertung |
|---|---|
| Prozesse nie über generische Muster beenden (`CLAUDE.md`) | Betroffen bei den Prüfschritten in quickstart.md: eigene Testinstanzen nur über gemerkte PID oder eigenen Port abräumen, nie 4820/4830. Ausdrücklich so dokumentiert. |
| Minimale Komplexität, kein Over-Engineering (globale Vorgaben) | Kein neues Framework, keine neue Abhängigkeit, kein zweiter Listener, kein Metrik-Pfad, keine Traces. |
| Keine Rückwärtskompatibilitäts-Krücken für entfernten Code | Nichts wird entfernt; die Rückfallebene bleibt, weil die Spec sie verlangt (FR-015), nicht als Krücke. |

**Ergebnis**: Gate bestanden (keine definierten Gates). Nach Phase 1 erneut geprüft — unverändert.

## Project Structure

### Documentation (this feature)

```text
specs/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: 10 Entscheidungen, am Binary verifiziert
├── data-model.md        # Phase 1: Entitäten, Felder, Zustandsübergänge, Migration
├── quickstart.md        # Phase 1: ausführbare Prüfszenarien je User Story
├── contracts/
│   ├── otlp-receiver.md      # Eingehend: POST /v1/logs
│   ├── telemetry-env.md      # Ausgehend: Umgebung der gestarteten Claude-Prozesse
│   └── runs-api.md           # Erweiterte HTTP-Verträge Richtung Web
└── tasks.md             # Phase 2 — NICHT von /speckit-plan erzeugt
```

### Source Code (repository root)

```text
packages/shared/src/
├── telemetryEvent.ts          # NEU: OTLP/JSON → UsageEvent (reiner Parser)
├── telemetryEvent.test.ts     # NEU
├── telemetryAttribution.ts    # NEU: Ereignisse → Lauf (Zeitfenster, Dedupe, Herkunft)
├── telemetryAttribution.test.ts # NEU
├── types.ts                   # ÄNDERN: ExecutionRecord + telemetry-Felder, UsageOrigin
├── costBreakdown.ts           # ÄNDERN: TokensSource 'telemetry', Betrag + Läufe-ohne-Betrag
├── runSummary.ts              # ÄNDERN: sourceMix 'telemetry', Subagenten-Anteil, Betrag
└── index.ts                   # ÄNDERN: Exporte

packages/server/src/
├── telemetry/
│   ├── otlpRoute.ts           # NEU: POST /v1/logs, antwortet immer 200
│   ├── telemetryStore.ts      # NEU: Puffer je Session, Dedupe, Kehraus (FR-030)
│   ├── telemetryEnv.ts        # NEU: Umgebungsvariablen je Prozess + Erkennung fremder Konfiguration
│   └── *.test.ts              # NEU
├── pty/sessionManager.ts      # ÄNDERN: Marke in die PTY-Umgebung
├── services/orchestrator.ts   # ÄNDERN: Telemetrie vor meterTurn; Nachlauf-Verrechnung
├── services/agentGateService.ts    # ÄNDERN: sdd.run.id für Headless-Läufe
├── services/conflictResolver.ts    # ÄNDERN: dito
├── services/chatService.ts         # ÄNDERN: dito
├── services/chatWorkService.ts     # ÄNDERN: dito
├── db/database.ts             # ÄNDERN: eine additive Migration
├── db/repos.ts                # ÄNDERN: ExecutionRepo (Telemetrie-Abschluss, Nachtrag)
└── api/server.ts              # ÄNDERN: Route registrieren, Hinweis-Endpunkt

packages/web/src/
├── components/ExecutionsView.tsx   # ÄNDERN: Herkunft, Subagenten-Anteil, Betrag
├── components/ProjectSettings.tsx  # ÄNDERN: Telemetrie-Status + Grund (FR-019)
└── api.ts                          # ÄNDERN: Typen
```

**Structure Decision**: Bestehende Drei-Paket-Struktur, unverändert. Die Messlogik entsteht als
reine Funktionen in `packages/shared` — parallel zum bestehenden Vorbild (`transcriptUsage.ts`,
`costBreakdown.ts`, `runSummary.ts` sind alle IO-frei und dadurch dicht testbar). Der Server
bekommt einen neuen, klar abgegrenzten Ordner `telemetry/` neben `pty/`; die vier
Zustandsträger (Puffer, Route, Umgebung, Anbindung an den Orchestrator) liegen dort zusammen,
statt sich in bestehende Dateien zu verteilen.

## Umsetzung in Reihenfolge der Prioritäten

Die Spec ordnet vier Stories nach Priorität. Der Plan folgt dieser Ordnung, damit nach jeder
Stufe etwas Prüfbares dasteht.

### Grundlage (vor US1, nicht eigenständig auslieferbar)

1. **Parser** (`shared/telemetryEvent.ts`): OTLP/JSON-Rumpf → `UsageEvent[]`. Nur
   `claude_code.api_request`; alles andere fällt still weg. Ganzzahlen kommen als String oder
   Zahl — beides tolerieren.
2. **Einstufung** (`shared/telemetryAttribution.ts`): `query_source` → `main | subagent |
   auxiliary` exakt nach der Regel der CLI (research.md D4), plus Dedupe über `request_id` und
   Zuordnung eines Ereignisses zu einem Zeitfenster.
3. **Umgebung** (`server/telemetry/telemetryEnv.ts`): die Variablen aus
   [contracts/telemetry-env.md](./contracts/telemetry-env.md) erzeugen; Erkennung einer
   abweichenden geerbten Konfiguration (D5).
4. **Migration + Ablage**: additive Spalten (data-model.md), `ExecutionRepo` um
   Telemetrie-Abschluss und Nachtrag erweitern.

### US1 — Der Verbrauch eines Laufs stimmt (P1)

5. **Empfänger**: `POST /v1/logs` registrieren, Rumpfgrenze erhöhen, immer `200 {}` antworten.
6. **Puffer** (`telemetryStore.ts`): Ereignisse je `sdd.session.id` / `sdd.run.id` sammeln,
   nach `request_id` deduplizieren, zeitlich und in der Anzahl deckeln.
7. **Marke setzen**: `sessionManager.spawn` gibt jeder PTY-Session ihre `sdd.session.id` mit.
8. **Zuordnung im Orchestrator**: Beim Abschluss eines Laufs die Ereignisse im Fenster
   `[startedAt, finishedAt]` der Session zusammenfassen; liegen welche vor, gewinnt die
   Telemetrie und `meterTurn` läuft gar nicht erst (FR-014/FR-016).
9. **Nachlauf**: Ereignisse, die nach dem Abschluss eintreffen und zeitlich zum Lauf gehören,
   werden bis 5 Minuten nach Abschluss nachgetragen; der Lauf wird über den bestehenden
   Ereignisbus aktualisiert. Danach endgültig (FR-011/FR-012, SC-005).

Nach dieser Stufe ist US1 vollständig prüfbar — inklusive der Kernfrage: fortgesetzte Session,
Zuordnung beim Start unbekannt, trotzdem korrekter Verbrauch.

### US2 — Subagenten zählen mit (P2)

10. **Aufteilung**: Beim Zusammenfassen die drei Herkünfte getrennt summieren; Subagenten-Anteil
    als eigene Spalten schreiben. Kein Anteil ohne Subagenten → keine Null-Zeile (FR-010,
    Szenario 3).
11. **Aggregation**: `runSummary.ts` und `costBreakdown.ts` reichen den Anteil durch.
12. **Anzeige**: Subagenten-Anteil im aufgeklappten Lauf sichtbar.

### US3 — Herkunft sichtbar, Rückfallebene belastbar (P2)

13. **Herkunftsstufe** `telemetry` durch alle Schichten: `ExecutionRecord.tokensSource`,
    `TokensSource`, `sourceMix`, `SOURCE_LABELS` in `ExecutionsView.tsx`.
14. **Messanteil** in der Lauf-Übersicht um die neue Quelle erweitern (FR-018) — die heutige
    Kennzahl „% gemessen" rechnet mit `sourceMix.transcript` und muss die neue Stufe
    einschliessen, sonst fällt die Anzeige beim Umstieg scheinbar auf 0.
15. **Hinweis bei inaktiver Telemetrie** mit Grund (FR-019) und **fremde Konfiguration
    erkannt** (D5), sichtbar in den Einstellungen.

### US4 — Kosten von der CLI (P3)

16. **Betrag** je Lauf aus `cost_usd_micros` summieren und speichern.
17. **Anzeige** als gemeldeter Betrag, klar von einer Schätzung unterschieden.
18. **Summen** weisen aus, wie viele enthaltene Läufe keinen Betrag beitragen (FR-024);
    Bestandsläufe bekommen keinen rückwirkenden Betrag (FR-023, FR-025).

## Risiken und wie der Plan sie auffängt

| Risiko | Auffangen |
|---|---|
| **Doppelzählung** — derselbe Stapel kommt nach einem Übertragungsfehler erneut an | Dedupe über `request_id`, die je API-Anfrage eindeutig ist (verifiziert). Der Puffer merkt sich gesehene IDs je Session; der Empfänger antwortet immer 200, damit die CLI gar nicht erst wiederholt. |
| **Verbrauch ohne aktiven Lauf** (Nutzer tippt selbst) landet fälschlich an einem Lauf | Zuordnung strikt über das Zeitfenster `[startedAt, finishedAt]` eines Laufs. Ereignisse ausserhalb jedes Fensters verfallen mit dem Puffer (FR-005). |
| **Fremde Session** meldet mit | Ohne `sdd.*`-Marke wird verworfen (FR-003) — strukturell, nicht als Prüfregel. |
| **Rangfolge `settings.json` vs. Prozessumgebung** unklar | Einmalige empirische Prüfung im Umsetzungsschritt; Ausweichweg über die ohnehin je Session geschriebene Settings-Datei ist bereits gebaut (research.md D5). |
| **Telemetrie fällt aus** (ältere CLI, Port belegt, nichts eingetroffen) | Rückfall auf `meterTurn` unverändert; Start wird nie blockiert (FR-020); Hinweis mit Grund (FR-019). Der bestehende Regressionstest zur Startmarke bleibt. |
| **Messanteil bricht optisch ein**, weil die Übersicht nur `transcript` zählt | Ausdrücklich als eigener Schritt (14) geführt, nicht als Nebenwirkung. |
| **Grosser OTLP-Stapel** wird still mit 413 verworfen | Route mit erhöhtem `bodyLimit` registrieren (research.md D3). |

## Complexity Tracking

Keine Verletzungen zu rechtfertigen — die Constitution definiert keine Gates, und der Plan
führt weder eine neue Abhängigkeit noch ein neues Paket noch einen zweiten Netzwerk-Listener
ein. Die einzige strukturelle Zutat ist der Ordner `packages/server/src/telemetry/`; er bündelt
vier zusammengehörige Bausteine, statt sie über bestehende Dateien zu verteilen.
