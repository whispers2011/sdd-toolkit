# Implementation Plan: Kontext-Hygiene im Wissens-Chat

**Branch**: `feature/kontext-hygiene-im-wissens-chat` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/kontext-hygiene-im-wissens-chat/spec.md`

## Summary

Der Wissens-Chat besitzt beide Bausteine schon: `ChatWorkService.restart()` startet verlustfrei
frisch, und `ChatPanel` zeigt die Karte **[Chat fortsetzen] / [Neuen Chat starten]**, sobald
`workPaused` gilt. Das Feature fügt **einen zweiten Auslöser für dieselbe Karte** hinzu — nicht
„5 Minuten Leerlauf", sondern „der Verlauf ist teuer geworden" — und macht die Zahl sichtbar, die
den Auslöser rechtfertigt.

Das Urteil („Angebot fällig? Kennzahl kritisch? Welcher Text?") kommt in ein **neues pures Modul
`packages/shared/src/chatHygiene.ts`**: dort stehen alle Grenzwerte an einer Stelle — inklusive der
bisherigen Leerlaufzeit, die aus `chatWorkService.ts` dorthin **umzieht** (FR-018) — und die
Bewertungsfunktion `evaluateChatHygiene()`. Das Modul ist datenfrei von IO und UI und wird mit
vitest geprüft; `packages/web` hat konventionsgemäß keine Tests, also darf dort keine Logik liegen.

Der Server misst nicht neu: `ChatWorkService.meterTurn()` fährt bereits an jeder Turn-Grenze die
Kaskade *Meldungen der CLI → Transkript → Schätzung*. Sie wird **wiederverwendet**; ergänzt wird
nur, dass ihr Ergebnis (auch das Ergebnis „nichts messbar") je Unterhaltung in einem Ringpuffer der
letzten drei Turns landet, dazu die Verlaufsgröße aus `transcriptSize(locateTranscript(…))`. Aus
diesen Eingaben entsteht an der Turn-Grenze — und nur dort (FR-007) — das **Kostenprofil**, das
`GET /api/projects/:id/chat` mitliefert.

In der Oberfläche entstehen genau zwei Dinge: ein **nicht blockierender Hinweisstreifen** über der
Konsole, wenn die Session lebt (die Konsole muss bedienbar bleiben, FR-008), und ein **Kennzahlen-
Streifen** unter der Konsole mit Kontextgröße, Kosten und Verhältnis des letzten Turns (FR-014/015).
Ist der Chat zusätzlich per Leerlauf pausiert, bleibt es bei der **einen** bestehenden Karte, deren
Text dann beide Gründe nennt (FR-013).

**Kein automatischer Neustart, kein Komprimieren des Verlaufs, keine DB-Migration, keine neue
Dependency, keine Änderung der Leerlauf-Mechanik.**

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM, `module: NodeNext`), pnpm-10-Workspace

**Primary Dependencies**: Fastify 5 (HTTP/WS), React 19 + Tailwind 4 (Web), `@sdd/shared`
(workspace), better-sqlite3 (bereits vorhanden, hier nur lesend/über bestehende Repos). Bewusst
**keine neuen Runtime- oder Dev-Dependencies**. `@sdd/shared` bleibt frei von `node:`-Importen —
Dateisystemzugriff (Transkriptgröße) bleibt in `@sdd/server`.

**Storage**: Keine neue Persistenz. Das Kostenprofil und der Ablehnungs-Wasserstand leben **im
Speicher je Unterhaltung** (`Map<conversationId, …>` in `ChatWorkService`, wie die bestehenden
`proposals`/`lastMarker`-Maps). Verbrauchszahlen werden unverändert über den bestehenden Weg
`executions.finishWithUsage()` in SQLite geschrieben — dieses Feature ergänzt dort nichts.

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`. Neue/erweiterte Tests:
`packages/shared/src/chatHygiene.test.ts` (NEU, pures Urteil inkl. aller Grenzfälle),
`packages/server/src/services/chatWorkService.test.ts` (erweitert: Profil an der Turn-Grenze,
Ablehnung, Wasserstand, Neustart setzt zurück), `packages/server/src/api/server.test.ts`
(erweitert: `costProfile` in `GET /chat`, neue Dismiss-Route). `packages/web` hat keine Tests
(`"test": "echo 'keine Web-Tests (MVP)'"`) — die UI-Kriterien werden über
[quickstart.md](./quickstart.md) manuell nachgewiesen.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser bzw. in der
Electron-Hülle (`packages/desktop`)

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Daten/Funktionen),
`packages/server` (API + Services + git + pty), `packages/web` (React-SPA), `packages/desktop`
(Electron-Hülle, hier nicht berührt)

**Performance Goals**: Pro Turn-Grenze kommen genau zwei zusätzliche Operationen hinzu: ein
`statSync` auf die Transkriptdatei (die für die Messung ohnehin geöffnet wird) und eine reine
Auswertung über maximal drei gemerkte Turns — beides im Mikrosekunden- bis Millisekundenbereich.
Zusätzlich wird pro Turn ein `chat_updated`-Event abgesetzt, das im offenen Panel **ein** `GET
/chat` auslöst (derselbe Weg, den der Feature-Vorschlag heute schon nutzt). Kein Polling, kein
Timer, keine Auswertung während eines laufenden Turns.

**Constraints**:
- **Angebote nur an der Turn-Grenze** (FR-007): Auslöser wird ausschließlich in `meterTurn()`
  bewertet; `GET /chat` rechnet nur den gespeicherten Stand aus und erzeugt kein neues Angebot.
- **Konsole bleibt bedienbar** (FR-008, SC-006): bei lebender Session ist der Hinweis ein Streifen
  über dem Terminal — kein Overlay, kein Autofokus, kein Abfangen von Tastatureingaben.
- **Genau eine Entscheidungskarte** (FR-013): pausiert ⇒ bestehende Karte (Text nennt beide
  Gründe); lebend ⇒ Streifen. Nie beides.
- **Verlustfreiheit und Schutzabfragen unverändert** (FR-010/011): der Neustart läuft durch das
  vorhandene `restart()` samt `needsConfirm`-Guard; nichts daran wird angefasst.
- **Messung wiederverwenden, nicht ersetzen** (Assumption „Messgrundlage"): `usageForTurn()`
  behält seine Kaskade und ihre Reihenfolge; ergänzt wird nur das Festhalten des Ergebnisses.
- **Grenzwerte an einer Stelle** (FR-018): `CHAT_HYGIENE_LIMITS` in `chatHygiene.ts` trägt auch
  `idleMs`; `CHAT_IDLE_TIMEOUT_MS` in `chatWorkService.ts` entfällt (kein Kompatibilitäts-Shim).
- **Keine Null-Messung behaupten** (FR-016): fehlende Werte sind `null` und werden als
  „unbekannt" gezeigt — dieselbe Regel, die `summarizeEvents()` schon für `costMicros` einhält.
- Deutsche UI, dunkles Layout, **SVG-Icons statt Emojis** (`WarningIcon` für den Streifen).

**Scale/Scope**: ein neues Shared-Modul (~180 Zeilen) plus Testdatei, ~90 geänderte Zeilen in
`chatWorkService.ts`, zwei API-Berührungen (ein Feld, eine Route), ~80 Zeilen in `ChatPanel.tsx`,
ein Typ-Feld in `packages/web/src/api.ts`. Kein Schema, keine Migration, kein neuer Prozess.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als Gates;
alle erfüllt:

- ✅ **Urteilslogik pure in `shared`, mit vitest getestet**: Schwellenwerte, Auslöser-Entscheidung,
  Verhältnisbildung und Hinweistext liegen in `chatHygiene.ts` — kein IO, kein React. Grund: die
  Kriterien aus US1/US3 sind sonst nirgends testbar (`packages/web` hat keine Tests).
- ✅ **`@sdd/shared` bleibt node-frei**: das neue Modul importiert kein `node:`-Builtin; die
  Verlaufsgröße liest der Server (`transcriptWatcher.ts`).
- ✅ **Keine neuen Dependencies**: bestätigt (0 neue Runtime- und Dev-Deps).
- ✅ **Bestehende Wege wiederverwenden statt duplizieren**: `restart()`, der `needsConfirm`-Guard,
  die Metering-Kaskade, das `chat_updated`-Invalidierungssignal und die Karte im Panel bleiben,
  wie sie sind — das Feature hängt sich an, statt daneben zu bauen.
- ✅ **Keine Migration, kein Vertragsbruch**: `GET /chat` bekommt ein **optionales** Feld, die
  Dismiss-Route ist neu und additiv; kein bestehender Response ändert seine Bedeutung.
- ✅ **Deutsche UI + SVG-Icons statt Emojis**: eingehalten (`WarningIcon`).
- ✅ **Kein stiller Eingriff**: nichts wird ohne Zustimmung neu gestartet, nichts gelöscht,
  nichts komprimiert (Assumption „Ausdrücklich nicht in diesem Feature").
- ⚠️ **Bewusste Abweichung, begründet**: der Umzug von `CHAT_IDLE_TIMEOUT_MS` verändert eine
  bestehende Datei über den Feature-Kern hinaus. FR-018 verlangt genau das („an einer Stelle
  zusammen mit der bestehenden Leerlaufzeit"); die Alternative wären zwei Orte für dieselbe
  Sorte Wert. Kein Verhaltensunterschied — derselbe Zahlenwert, nur ein anderer Wohnort.
  Details: [research.md](./research.md) D2. Kein Complexity-Tracking-Eintrag nötig.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt kein neues Paket,
kein Framework, keine Persistenzschicht und keinen Hintergrundprozess ein. Die einzige neue
Zustandshaltung ist eine Map im Speicher desselben Service, der bereits drei solche Maps führt.
Complexity Tracking bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/kontext-hygiene-im-wissens-chat/
├── plan.md                        # Diese Datei
├── research.md                    # Phase 0: Leitentscheidungen mit Begründung
├── data-model.md                  # Phase 1: Entitäten, Typen, Zustandsübergänge, Regeln
├── quickstart.md                  # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── chat-hygiene-module.md     # Öffentliche API des Shared-Moduls (Grenzwerte, Bewertung)
│   ├── http-api.md                # GET /chat (Feld costProfile) + POST …/offer/dismiss
│   └── ui-contract.md             # Platzierung, Zustände, Wortlaut, A11y, Fokusregeln
└── tasks.md                       # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── chatHygiene.ts (NEU)           # CHAT_HYGIENE_LIMITS (inkl. idleMs), Typen
│                                  #   (ChatTurnUsage, ChatContextRatio, ChatRestartReason,
│                                  #   ChatCostProfile, ChatOfferWatermark),
│                                  #   evaluateChatHygiene(), contextRatio(),
│                                  #   restartOfferMessage(), ratioLabel(), formatHistorySize()
├── chatHygiene.test.ts (NEU)      # Schwellen, Verhältnis über 3 Turns, Mindestverbrauch,
│                                  #   0-Output, unbekannte Werte, Ablehnungs-Wasserstand,
│                                  #   Leerlauf+Kosten kombiniert, frische Unterhaltung
└── index.ts                       # + export * from './chatHygiene.js'

packages/server/src/services/
├── chatWorkService.ts             # − CHAT_IDLE_TIMEOUT_MS (→ shared: limits.idleMs)
│                                  # + hygiene: Map<conversationId, ChatHygieneState>
│                                  # + meterTurn(): Turn-Verbrauch + Verlaufsgröße festhalten,
│                                  #   Profil bewerten, chat_updated emittieren
│                                  # + costProfileFor(conversation), dismissOffer(projectId)
│                                  # + historyBytesFor(session|conversation) (transcriptSize)
│                                  # + restart()/handleExit(): Zustand der Unterhaltung räumen
└── chatWorkService.test.ts        # + Profil-, Ablehnungs-, Wasserstand-, Neustart-Tests
                                   #   (Import CHAT_IDLE_TIMEOUT_MS → CHAT_HYGIENE_LIMITS.idleMs)

packages/server/src/api/
├── server.ts                      # GET  /api/projects/:id/chat → + costProfile
│                                  # POST /api/projects/:id/chat/work/offer/dismiss (NEU)
└── server.test.ts                 # + Feld- und Routen-Tests

packages/web/src/
├── api.ts                         # ChatState + costProfile?: ChatCostProfile | null
│                                  # + dismissChatRestartOffer(projectId)
└── components/ChatPanel.tsx       # + Hinweisstreifen über der Konsole (lebende Session)
                                   # + Kennzahlen-Streifen unter der Konsole
                                   # + Text der Pausiert-Karte nennt zusätzliche Gründe
                                   # + „Chat fortsetzen" lehnt ein offenes Angebot mit ab
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Die Aufteilung folgt
der im Repo gelebten Linie **Urteil in `shared`, IO im Service, Darstellung im Web**: `chatHygiene.ts`
entscheidet, `ChatWorkService` beschafft die Eingaben und hält den Zustand, `ChatPanel` zeigt an.
Ein eigenes Modul (statt einer Erweiterung von `costMeter.ts`/`costBreakdown.ts`) deshalb, weil es
hier nicht um das Rechnen mit Verbrauch geht, sondern um **Grenzwerte einer Unterhaltung und die
daraus folgende Empfehlung** — andere Verantwortung, andere Testfälle. Begründung im Detail:
[research.md](./research.md) D1.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Shared-Fundament (US1 + US3)**: `chatHygiene.ts` mit `CHAT_HYGIENE_LIMITS` (inkl. `idleMs`),
   Typen, `contextRatio()`, `evaluateChatHygiene()` und `restartOfferMessage()` gemäß
   [contracts/chat-hygiene-module.md](./contracts/chat-hygiene-module.md); Re-Export in `index.ts`;
   `chatHygiene.test.ts` mit allen Grenzfällen aus [data-model.md](./data-model.md).
2. **Leerlaufzeit umziehen (FR-018)**: `CHAT_IDLE_TIMEOUT_MS` aus `chatWorkService.ts` entfernen,
   Default von `reapIdleSessions()` auf `CHAT_HYGIENE_LIMITS.idleMs` umstellen, die zehn
   Verwendungen in `chatWorkService.test.ts` nachziehen. `pnpm -r test` grün — Leerlaufverhalten
   unverändert.
3. **Messung festhalten (US1/US2, FR-001)**: in `meterTurn()` den Turn-Verbrauch (auch den Fall
   „nichts messbar") in den Ringpuffer der Unterhaltung schreiben, Verlaufsgröße über
   `locateTranscript` + `transcriptSize` bestimmen, Profil bewerten, `chat_updated` emittieren.
   `restart()` und `handleExit()` räumen den Zustand der alten Unterhaltung (FR-012).
4. **Auslöser + Ablehnung serverseitig (US1, FR-002…FR-009)**: `costProfileFor()` und
   `dismissOffer()`; Wasserstand-Logik kommt aus dem Shared-Modul, der Service hält nur den Wert.
   Server-Tests für: Angebot ohne Leerlauf, Angebot nur an der Turn-Grenze, Ablehnung unterdrückt,
   erneutes Angebot nach weiterer Schwellenstufe, frische Unterhaltung ohne Angebot.
5. **Transport (US1/US2)**: `costProfile` in `GET /chat`, Route
   `POST /api/projects/:id/chat/work/offer/dismiss` gemäß [contracts/http-api.md](./contracts/http-api.md);
   `server.test.ts` erweitern.
6. **Angebot in der Oberfläche (US1)**: Hinweisstreifen über der Konsole, Aktionen
   „Chat fortsetzen" (lehnt ab) / „Neuen Chat starten" (bestehender `onRestart`), Text der
   Pausiert-Karte um die Kosten-Gründe ergänzen — genau eine Karte (FR-013). Fokus- und
   Tastaturregeln nach [contracts/ui-contract.md](./contracts/ui-contract.md).
7. **Zahlen in der Oberfläche (US2)**: Kennzahlen-Streifen unter der Konsole mit gelesener
   Kontextgröße und Kosten des letzten Turns (`fmtTokens`/`fmtCost` aus `components/charts.tsx`),
   „unbekannt" statt Null, „noch keine Messung" im frischen Chat.
8. **Kennzahl (US3)**: Verhältnis im Streifen ausweisen, ab `ratioCritical` sichtbar markieren
   (`WarningIcon` + Farbe), definierter Wert bei fehlender Ausgabe.
9. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün; die Szenarien aus
   [quickstart.md](./quickstart.md) manuell durchspielen, inklusive Referenzfall-Nachweis (SC-004)
   und Nachweis, dass die Konsole während eines offenen Angebots Eingaben behält (SC-006).

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Der Hinweisstreifen frisst Tastatureingaben oder zieht den Fokus vom Terminal (FR-008, SC-006 fällt) | Streifen ist normales Layout-Element über dem Terminal, **kein** Overlay/Dialog, ohne `autoFocus`; kein globaler Key-Handler; Terminal behält seine Größe über den Flex-Container. Nachweis in quickstart.md Szenario 3 |
| Zwei Karten gleichzeitig (Leerlauf + Kosten), AC7/FR-013 fällt | Eine einzige Verzweigung im Panel: `paused ? Karte : offer ? Streifen : Terminal`; der Text der Karte kommt aus `restartOfferMessage()`, das beide Gründe zusammenfasst. Test im Shared-Modul (kombinierte Gründe → ein Text) |
| Angebot erscheint mitten im laufenden Turn (FR-007) | Bewertung ausschließlich im `turn_completed`-Zweig von `handleStatusChange()`; `GET /chat` rechnet nur nach, ohne Eingaben zu aktualisieren. Server-Test: `working`-Status setzen, kein Angebot |
| Endlos-Nachfragen nach Ablehnung (FR-009) | Ablehnung speichert einen Wasserstand (Verlaufsgröße **und** gelesener Kontext zum Zeitpunkt der Ablehnung); erneut angeboten wird erst ab Wasserstand + eine weitere Schwellenstufe. Reines Urteil im Shared-Modul, direkt testbar |
| Schätz-Rückfallebene liefert keinen Cache-Read/Output-Split → Verhältnis und Kontext-Auslöser blind | `ChatTurnUsage` führt jedes Feld als `number \| null`; unbekannte Felder liefern `ratio: { kind: 'unknown' }` und lösen keinen verbrauchsbasierten Auslöser aus. Der Größen-Auslöser bleibt wirksam (Edge Case „Keine Verbrauchsdaten") |
| Nullwerte werden als Messung ausgegeben (FR-016) | `null` durchgängig statt `0`; dieselbe Regel wie in `summarizeEvents()`. Test: unbekannter Turn zeigt „unbekannt", niemals „$0.00" oder „0 Tokens" |
| Verlaufsgröße wird zu klein gemessen, weil eine Unterhaltung mehrere Transkriptdateien hat (Resume-Recovery hat die alte ID verworfen) | Bewusst nur die aktuelle Transkriptdatei der Unterhaltung; der Auslöser greift dann **später**, nie fälschlich. Dokumentiert in research.md D5; kein neuer DB-Query |
| Verlaufsgröße nicht ermittelbar (`locateTranscript` findet nichts) | `historyBytes: null` → nur verbrauchsbasierte Auslöser, keine Fehlermeldung im Chat (Edge Case „Verlaufsgrösse nicht ermittelbar") |
| Zustand im Speicher geht bei Server-Neustart verloren → Angebot erscheint einmal erneut | Bewusst akzeptiert: an der ersten Turn-Grenze nach dem Neustart wird neu bewertet, das Angebot ist dann sachlich richtig (der Verlauf ist ja groß). Kein DB-Feld, keine Migration. In research.md D6 festgehalten |
| Direkt nach „Chat fortsetzen" aus der Pausiert-Karte springt sofort der Streifen an (Doppelfrage) | „Chat fortsetzen" ruft die Dismiss-Route mit, bevor es das Terminal mountet — ein Wasserstand ist dann gesetzt (Edge Case „Direkt nach einem Neustart" analog) |
| Kleiner Chat mit „ok"-Antwort bekommt ein Angebot (Edge Case, FR-005) | Verhältnis-Auslöser erst ab `minCacheReadTokens` (50'000) je Turn **und** erst nach `ratioTurns` (3) aufeinanderfolgenden Turns; Test mit 2'000 gelesenen Tokens / 2 Ausgabe-Tokens → kein Angebot |
| Turn ohne Ausgabe erzeugt „Infinity" oder NaN (US3 AC4) | `ChatContextRatio` ist eine getaggte Union mit `no_output`-Fall; `ratioLabel()` liefert dafür einen festen Text. Test deckt 0 und `null` ab |
| Zusätzliches `chat_updated` je Turn erzeugt Last | Ein Event pro Turn-Grenze, identisch zum bestehenden Vorschlags-Signal; nur ein offenes Panel reagiert, mit genau einem `GET /chat` |
| Entfernen von `CHAT_IDLE_TIMEOUT_MS` bricht Tests | Umzug und Test-Nachziehen in **einem** Schritt (Reihenfolge-Punkt 2), vor allen Feature-Änderungen; `pnpm -r test` als Tor |
| Grenzwerte erweisen sich als zu scharf oder zu lasch | Alle Werte in `CHAT_HYGIENE_LIMITS`; `evaluateChatHygiene(input, limits)` nimmt Grenzen als Parameter, Tests arbeiten mit expliziten Werten — Nachjustieren ist eine Ein-Zeilen-Änderung ohne Testumbau |

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bleibt leer.
