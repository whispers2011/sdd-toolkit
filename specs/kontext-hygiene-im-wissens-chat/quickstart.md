# Quickstart: Kontext-Hygiene im Wissens-Chat

**Zweck**: Die Kriterien, die `packages/web` konventionsgemäß nicht als Test abdecken kann
(dort gibt es keine Tests), werden hier von Hand nachgewiesen. Die Urteilslogik selbst ist
automatisiert geprüft — `packages/shared/src/chatHygiene.test.ts` (33 Fälle),
`packages/server/src/services/chatWorkService.test.ts` (17 Fälle) und
`packages/server/src/api/server.test.ts` (4 Fälle).

## Eigene Instanz starten (nicht die laufende benutzen)

Die laufende Toolkit-Instanz belegt 4820/4830 und ist **deine Elternprozess-Kette** — sie darf
weder benutzt noch abgeräumt werden (siehe `CLAUDE.md`). Eigene freie Ports nehmen:

```sh
# Server + Web mit eigenen Ports
PORT=4899 pnpm --filter @sdd/server dev &
pnpm --filter @sdd/web dev -- --port 5899 &
```

Abräumen ausschließlich über die eigenen Ports:

```sh
lsof -ti:4899 | xargs kill
lsof -ti:5899 | xargs kill
```

## Szenario 1 — Großer Verlauf meldet sich ohne Leerlauf (SC-001, SC-004, AC1/AC2)

1. Projekt-Chat eines Projekts öffnen, dessen Unterhaltung schon über 8 MB Transkript hat
   (bzw. dessen letzter Turn über 150'000 Tokens Kontext liest).
2. Einen beliebigen Turn beenden lassen — auch ein „danke, passt" genügt.

**Erwartet**: Unmittelbar nach dem Turn erscheint **über** der Konsole ein Streifen mit
Warnzeichen, dem Satz „Der Verlauf ist X MB groß — jeder weitere Turn zahlt den Verlauf mit."
und den Schaltflächen **[Chat fortsetzen]** / **[Neuen Chat starten]**. Es ist **keine**
Leerlaufzeit abgelaufen, die Session läuft weiter (Statuspunkt im Kopf nicht grau).

**Gegenprobe (SC-004)**: In einem frisch gestarteten Chat mit kleinem Verlauf über neun Turns
erscheint der Streifen in **keinem** Turn.

## Szenario 2 — Kennzahlen des letzten Turns (SC-002, SC-003, SC-007)

1. Im Chat einen Turn beenden lassen.

**Erwartet**: **Unter** der Konsole steht ohne weiteren Klick und ohne Wechsel der Ansicht ein
Streifen mit vier Kennzahlen: `Kontext`, `Kosten`, `Kontext : Ausgabe`, `Verlauf`.

- Ein Turn mit ~265'000 gelesenen Kontext-Tokens und ~300 Ausgabe-Tokens weist
  `Kontext : Ausgabe` mit Warnzeichen und Warnfarbe aus (ab 1000 : 1 kritisch, SC-003/US3 AC2).
- Ein ausgewogener Turn (z. B. 60'000 : 30'000) weist das Verhältnis sichtbar, aber **ohne**
  Markierung aus (US3 AC3).
- Ein „danke, passt"-Turn in einem großen Chat weist dieselben hohen Zahlen aus wie ein Turn
  mit echter Arbeit (SC-007).
- Ein Turn ohne ermittelbare Werte zeigt „unbekannt" — nie `0` und nie `$0.00` (FR-016).
- Ein Turn ohne erzeugte Ausgabe zeigt `keine Ausgabe` — nie „Infinity" oder „NaN" (US3 AC4).

**Gegenprobe**: Ein frischer Chat ohne beendeten Turn zeigt an derselben Stelle nur
„noch keine Messung" (US2 AC4).

## Szenario 3 — Konsole behält Eingaben bei offenem Angebot (SC-006, FR-008)

1. Angebot wie in Szenario 1 auslösen.
2. Bei offenem Streifen in die Konsole tippen, ohne vorher hineinzuklicken.

**Erwartet**: Die Eingabe landet in der Konsole. Der Streifen ist ein normales Layout-Element
über dem Terminal — kein Overlay, kein Dialog, kein Autofokus, kein globaler Tasten-Handler.
Das Terminal behält seine Größe (nur die Höhe des Streifens weniger) und seinen Fokus.
3. **[Chat fortsetzen]** wählen.

**Erwartet**: Der Streifen verschwindet, die Session läuft ohne Neustart weiter, im selben Turn
erscheint kein zweites Angebot. Erst wenn der Verlauf um weitere 8 MB (bzw. der gelesene Kontext
um weitere 150'000 Tokens) gewachsen ist, wird erneut angeboten (FR-009).

## Szenario 4 — Neustart über das Angebot ist verlustfrei (SC-005, FR-010/FR-011)

1. Angebot wie in Szenario 1 auslösen.
2. **[Neuen Chat starten]** wählen.

**Erwartet**:

- Eine frische Unterhaltung beginnt mit leerem Kontext; der Kennzahlen-Streifen steht wieder auf
  „noch keine Messung", es erscheint **kein** neues Angebot (FR-012, Edge Case „Direkt nach
  einem Neustart").
- Die vorherige Unterhaltung ist **nicht gelöscht** (`chat_conversations.ended_at` gesetzt, die
  Nachrichten bleiben lesbar).
- Arbeitet die Session gerade oder hat die Arbeitskopie unbestätigte Änderungen, kommt **vorher**
  die bestehende Rückfrage („Der Chat arbeitet gerade …" / „unbestätigte Änderungen …"); ohne
  Bestätigung wird nichts verworfen (FR-011).

## Szenario 5 — Leerlauf und Kosten ergeben genau eine Karte (AC7, FR-013)

1. Chat mit großem Verlauf (Szenario 1) fünf Minuten unberührt lassen, Panel schließen, damit der
   Leerlauf-Reaper greift.
2. Panel wieder öffnen.

**Erwartet**: Genau **eine** Karte („Chat wegen Inaktivität pausiert"), deren Text beide Gründe
in einem Satz nennt — z. B. „Seit 5 min keine Aktivität und der Verlauf ist 16,8 MB groß — jeder
weitere Turn zahlt den Verlauf mit." Kein zweiter Streifen daneben. Bei reinem Leerlauf (kleiner
Verlauf) steht dort weiterhin der bisherige Wortlaut.

## Referenzfall-Nachweis (SC-004)

| Eingabe | Erwartung |
|---|---|
| 16,8 MB Verlauf, ~265'000 gelesene Tokens, 100–400 Ausgabe-Tokens | Angebot erscheint; Gründe `history_size`, `context_per_turn`, `context_ratio` |
| frischer Chat, < 10 Turns, kleiner Verlauf | in keinem Turn ein Angebot |

Beide Zeilen sind als Test festgeschrieben (`chatHygiene.test.ts` → „Referenzfall 28.07.2026",
`chatWorkService.test.ts` → „bietet bei großem Verlauf an, ohne dass eine Leerlaufzeit abläuft"
und „ein frischer Chat … bekommt über mehrere Turns nichts angeboten").

## Protokoll

| Datum | Szenario | Ergebnis |
|---|---|---|
| 2026-07-30 | Automatisierte Grundlage: `pnpm -r typecheck` und `pnpm -r test` | grün (4 Pakete typecheck, 435 Tests shared, 557 Tests server) |
| 2026-07-30 | **Befund**: `CHAT_HYGIENE_LIMITS` stand mit abgesenkten Werten im Baum (`historyBytes: 1024`, `cacheReadTokensPerTurn: 1_000`, `ratioCritical: 5`, je mit Kommentar `// MANUELLER TEST`) | Ein Versuch, die Oberfläche von Hand auszulösen, hatte die Grenzwerte gesenkt und nicht zurückgesetzt. Damit war der Baum **rot**: `pnpm -r typecheck` scheiterte in `chatHygiene.test.ts` und mehrere Schwellen-Tests in `chatHygiene.test.ts`/`chatWorkService.test.ts` hätten die abgesenkten Werte angeschlagen. Werte auf die Vorgabe aus tasks.md zurückgesetzt (`8 * 1024 * 1024`, `150_000`, `1_000`); zusätzlich `ratioTurn()` im Test explizit als `number` typisiert, weil `as const` den Default-Parameter sonst auf das Literal `50000` verengt. **Lehre**: Wer die Grenzwerte fürs Handtesten senkt, muss danach `pnpm -r typecheck && pnpm -r test` fahren — der Test „lässt sich ohne Testumbau nachjustieren" ist genau dafür da. |
| 2026-07-30 | Automatisierte Grundlage erneut nach dem Zurücksetzen | grün (4 Pakete typecheck, 435 Tests shared, 557 Tests server; davon `chatHygiene.test.ts` 33, Hygiene-Blöcke in `chatWorkService.test.ts` 17, in `server.test.ts` 4) |
| 2026-07-30 | Konventions-Review (T037/T038) | grün: `CHAT_IDLE_TIMEOUT_MS` existiert nirgends mehr, `chatHygiene.ts` ohne `node:`-Import und ohne React, keine Änderung an einer `package.json`, keine Grenzwerte hartcodiert außerhalb von `CHAT_HYGIENE_LIMITS` (der einzige Treffer `16.8 * 1024 * 1024` ist Testdatum des Referenzfalls, keine Grenze), keine Emojis in `ChatPanel.tsx` |
| 2026-07-30 | 1–5 (Oberfläche am laufenden Chat) | **offen, bewusst so abgenommen** — braucht einen realen Wissens-Chat mit ≳ 8 MB Verlauf bzw. Turns über 150'000 gelesenen Tokens; in dieser Umgebung nicht reproduzierbar, ohne echte Claude-Turns in dieser Größe zu fahren. Die dahinterliegenden Entscheidungen (Auslöser, Wasserstand, ein Text für beide Gründe, „unbekannt" statt 0, `no_output` statt Infinity) sind in `chatHygiene.test.ts` / `chatWorkService.test.ts` / `server.test.ts` abgedeckt; offen bleibt allein der Augenschein der Platzierung und der Fokus-Nachweis am echten Terminal. Entscheidung vom 30.07.2026: nicht über abgesenkte Grenzwerte erzwingen (siehe Befund oben), sondern beim nächsten echten großen Chat nachholen. Was ohne Augenschein aus dem Code belegt ist: der Hinweisstreifen ist ein normales Flex-Kind über dem Terminal-`div` — kein Overlay, kein Dialog, kein `autoFocus`, kein globaler Key-Handler (FR-008/SC-006), und der Kennzahlen-Streifen steht als eigenes Element unter dem Terminal-`div`. |
