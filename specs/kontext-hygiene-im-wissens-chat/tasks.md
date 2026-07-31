---

description: "Aufgabenliste: Kontext-Hygiene im Wissens-Chat"
---

# Tasks: Kontext-Hygiene im Wissens-Chat

**Input**: Design-Dokumente aus `/specs/kontext-hygiene-im-wissens-chat/`

**Prerequisites**: [plan.md](./plan.md) (vorhanden), [spec.md](./spec.md) (vorhanden)

> **Fehlende Design-Dokumente**: `plan.md` verweist auf `research.md`, `data-model.md`,
> `quickstart.md` und `contracts/` — keines dieser Dokumente existiert im Spec-Ordner. Die
> Aufgaben unten sind daher **selbsttragend**: konkrete Signaturen, Grenzwerte und Dateipfade
> stehen in den Aufgaben selbst (abgeleitet aus plan.md, den Assumptions in spec.md und dem
> tatsächlichen Quellcode). T002 legt die fehlende `quickstart.md` an, weil die UI-Kriterien
> laut plan.md ausschließlich dort manuell nachgewiesen werden (`packages/web` hat keine Tests).

**Tests**: Tests sind **ausdrücklich verlangt** — plan.md („Testing") benennt
`packages/shared/src/chatHygiene.test.ts` (neu) sowie Erweiterungen an
`packages/server/src/services/chatWorkService.test.ts` und `packages/server/src/api/server.test.ts`.
`packages/web` hat konventionsgemäß keine Tests; dessen Kriterien werden manuell nachgewiesen.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story unabhängig
umgesetzt und abgenommen werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: zugehörige User Story (US1, US2, US3)
- Jede Aufgabe nennt den exakten Dateipfad

## Path Conventions

pnpm-Monorepo (siehe plan.md „Project Structure"):

- `packages/shared/src/` — pure Typen/Daten/Funktionen, node-frei, vitest
- `packages/server/src/` — API, Services, git, pty
- `packages/web/src/` — React-SPA, **keine Tests**

## Grenzwerte (eine Stelle, FR-018)

Aus [spec.md](./spec.md) „Assumptions" — gelten als Vorgabe für `CHAT_HYGIENE_LIMITS`:

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `idleMs` | `5 * 60_000` | bestehende Leerlaufzeit (zieht aus `chatWorkService.ts` um) |
| `historyBytes` | `8 * 1024 * 1024` | Verlaufsgröße, ab der angeboten wird |
| `cacheReadTokensPerTurn` | `150_000` | gelesener Kontext je Turn, ab dem angeboten wird |
| `ratioTrigger` | `300` | Verhältnis gelesener Kontext : Ausgabe, ab dem angeboten wird |
| `ratioTurns` | `3` | so viele aufeinanderfolgende Turns muss `ratioTrigger` gelten |
| `minCacheReadTokens` | `50_000` | Mindestverbrauch je Turn für den Verhältnis-Auslöser (FR-005) |
| `ratioCritical` | `1000` | ab hier wird die Kennzahl sichtbar als kritisch markiert |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangsstand absichern, damit die späteren „grün"-Tore etwas bedeuten

- [X] T001 Ausgangsstand festhalten: `pnpm -r typecheck && pnpm -r test` im Repo-Root laufen lassen und das Ergebnis (grün/rote Tests) notieren — alle folgenden Phasen messen sich daran
- [X] T002 Fehlende `specs/kontext-hygiene-im-wissens-chat/quickstart.md` anlegen mit den manuellen Nachweis-Szenarien, auf die plan.md verweist: (1) großer Verlauf → Angebot ohne Leerlauf (SC-001/SC-004), (2) Kennzahlen-Streifen nach einem Turn (SC-002/SC-003), (3) Konsole behält Eingaben bei offenem Angebot (SC-006), (4) Neustart über das Angebot lässt den Verlauf bestehen (SC-005), (5) frischer Chat warnt nicht (SC-004, Edge Case „Direkt nach einem Neustart")

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Das pure Urteilsmodul, der Umzug der Leerlaufzeit, die Messung an der Turn-Grenze und der Transport des Kostenprofils. Alle drei Stories lesen dasselbe `ChatCostProfile` — deshalb liegt der komplette `chatHygiene.ts`-Baustein hier und nicht in einer Story: es ist **eine** pure Datei, und `packages/web` hat keine Tests, also ist sie der einzige Ort, an dem die Kriterien überhaupt prüfbar sind.

**⚠️ CRITICAL**: Keine Story-Arbeit vor Abschluss dieser Phase

- [X] T003 `packages/shared/src/chatHygiene.ts` (NEU) anlegen mit `CHAT_HYGIENE_LIMITS` (alle sieben Werte aus der Tabelle oben, `as const`) und den Typen `ChatTurnUsage` (`cacheReadTokens`/`outputTokens`/`costMicros`/`tokens` je `number | null`, plus `measured: boolean`), `ChatContextRatio` (getaggte Union: `{ kind: 'value'; ratio: number }` | `{ kind: 'no_output' }` | `{ kind: 'unknown' }`), `ChatRestartReason` (`'idle' | 'history_size' | 'context_per_turn' | 'context_ratio'`), `ChatCostProfile` (`historyBytes: number | null`, `lastTurn: ChatTurnUsage | null`, `ratio: ChatContextRatio`, `reasons: ChatRestartReason[]`, `offerOpen: boolean`, `message: string | null`) und `ChatOfferWatermark` (`historyBytes: number | null`, `cacheReadTokens: number | null`) — kein `node:`-Import, kein React
- [X] T004 In `packages/shared/src/chatHygiene.ts` die reinen Helfer ergänzen: `contextRatio(usage)` → `ChatContextRatio` (unbekannte Felder → `unknown`, `outputTokens === 0` → `no_output`, sonst `value`), `ratioLabel(ratio)` → deutscher Text mit festem Wert für `no_output`/`unknown` (nie „Infinity"/„NaN"), `formatHistorySize(bytes)` → z. B. `16,8 MB` (`null` → „unbekannt")
- [X] T005 In `packages/shared/src/chatHygiene.ts` `evaluateChatHygiene(input, limits = CHAT_HYGIENE_LIMITS)` ergänzen — `input`: `{ historyBytes: number | null; turns: ChatTurnUsage[] (jüngster zuletzt, max. 3); idle: boolean; watermark: ChatOfferWatermark | null }`; liefert `ChatCostProfile` mit den Gründen: `history_size` bei `historyBytes >= limits.historyBytes`, `context_per_turn` bei `cacheReadTokens >= limits.cacheReadTokensPerTurn` des jüngsten Turns, `context_ratio` nur wenn `limits.ratioTurns` aufeinanderfolgende Turns je `ratio >= limits.ratioTrigger` **und** `cacheReadTokens >= limits.minCacheReadTokens` erfüllen (FR-005), `idle` durchgereicht (FR-013); `null`-Felder lösen nie einen Auslöser aus (Edge Case „Keine Verbrauchsdaten"); ein gesetzter `watermark` unterdrückt Gründe, bis die auslösende Größe um eine weitere Schwellenstufe gewachsen ist (FR-009); leere `turns` + `historyBytes` unter der Schwelle → `reasons: []`, `offerOpen: false` (FR-012)
- [X] T006 In `packages/shared/src/chatHygiene.ts` `restartOfferMessage(profile, limits?)` ergänzen: **ein** deutscher Satz, der alle zutreffenden Gründe mit Zahl nennt (FR-006, z. B. „Verlauf ist 16,8 MB, jeder weitere Turn zahlt ihn mit."; bei kombiniertem Leerlauf+Kosten beide Gründe in einem Text, FR-013); `reasons: []` → `null`
- [X] T007 `packages/shared/src/chatHygiene.test.ts` (NEU) mit vitest: Schwellen je Auslöser (genau darunter/darauf), Verhältnis erst nach drei Turns, Verhältnis unterhalb `minCacheReadTokens` löst nicht aus (2'000 gelesene / 2 Ausgabe-Tokens → kein Angebot), `outputTokens === 0` → `no_output` statt Infinity, unbekannte Werte → `ratio: unknown` und kein verbrauchsbasierter Auslöser, `historyBytes: null` → nur verbrauchsbasierte Auslöser, Wasserstand unterdrückt und gibt erst nach einer weiteren Schwellenstufe wieder frei, Leerlauf+Kosten ergeben **einen** Text mit beiden Gründen, frische Unterhaltung (leere `turns`) ergibt kein Angebot, Referenzfall 28.07.2026 (16,8 MB / 265'000 / 300) löst aus (SC-004)
- [X] T008 [P] `export * from './chatHygiene.js';` in `packages/shared/src/index.ts` ergänzen (Reihenfolge wie die bestehenden Exporte)
- [X] T009 Leerlaufzeit umziehen (FR-018): in `packages/server/src/services/chatWorkService.ts` `export const CHAT_IDLE_TIMEOUT_MS` (Zeile 42) samt Kommentar entfernen, `CHAT_HYGIENE_LIMITS` aus `@sdd/shared` importieren und den Default von `reapIdleSessions()` (Zeile 493) auf `CHAT_HYGIENE_LIMITS.idleMs` umstellen — kein Kompatibilitäts-Shim
- [X] T010 In `packages/server/src/services/chatWorkService.test.ts` den Import (Zeile 12) und die acht Verwendungen (Zeilen 298, 304, 314, 322, 328, 335, 341, 599) von `CHAT_IDLE_TIMEOUT_MS` auf `CHAT_HYGIENE_LIMITS.idleMs` umstellen; danach `pnpm -r test` grün — Leerlaufverhalten unverändert (Tor vor allen Feature-Änderungen)
- [X] T011 In `packages/server/src/services/chatWorkService.ts` den Zustand je Unterhaltung anlegen: `private hygiene = new Map<string, { turns: ChatTurnUsage[]; historyBytes: number | null; watermark: ChatOfferWatermark | null; profile: ChatCostProfile | null }>()` — analog zu den bestehenden `proposals`/`lastMarker`-Maps, mit Kommentar „im Speicher, überlebt Panel-Öffnen, nicht den Server-Neustart"
- [X] T012 In `packages/server/src/services/chatWorkService.ts` `private historyBytesFor(session)` ergänzen: über das bereits importierte `locateTranscript(session.cwd, session.claudeSessionId)` + `transcriptSize(path)`; kein Pfad oder keine `claudeSessionId` → `null` (Edge Case „Verlaufsgrösse nicht ermittelbar", keine Fehlermeldung)
- [X] T013 `meterTurn()` in `packages/server/src/services/chatWorkService.ts` erweitern (FR-001, FR-007): das Ergebnis von `usageForTurn()` **auch im Fall `null`** als `ChatTurnUsage` (`measured: false`, alle Zahlen `null`) in den Ringpuffer der Unterhaltung schreiben (max. `CHAT_HYGIENE_LIMITS.ratioTurns` Einträge), `historyBytesFor(session)` bestimmen, `evaluateChatHygiene()` aufrufen, Profil in der Map ablegen und `bus.emitEvent('chat_updated', { projectId, conversationId })` absetzen — die bestehende Kaskade in `usageForTurn()` und der Schreibweg über `executions.finishWithUsage()` bleiben unangetastet
- [X] T014 In `packages/server/src/services/chatWorkService.ts` das Räumen ergänzen (FR-012): `doRestart()` löscht den `hygiene`-Eintrag der alten Unterhaltung (bei `this.proposals.delete(old.id)`), `handleExit()` und `killAll()` räumen entsprechend — die frische Unterhaltung startet mit leerer Bewertung
  - **Abweichung, bewusst**: `handleExit()` räumt **nicht**. Der Zustand gehört der Unterhaltung, nicht der Session: nach einem Leerlauf-Reap ist die Unterhaltung pausiert **und** weiterhin teuer — genau dann muss die eine Pausiert-Karte beide Gründe nennen können (FR-013, Szenario 5). Geräumt wird bei `doRestart()`, wo die Unterhaltung endet (FR-012), und in `killAll()`. Im Code an der Stelle begründet.
- [X] T015 In `packages/server/src/services/chatWorkService.ts` `costProfileFor(conversation: ChatConversation): ChatCostProfile | null` ergänzen: gibt **nur** das gespeicherte Profil zurück und bewertet nicht neu (FR-007 — `GET /chat` darf kein Angebot erzeugen); ergänzt `reasons` um `'idle'`, wenn `workPaused(conversation)` gilt, und setzt `message` über `restartOfferMessage()` (FR-013)
- [X] T016 In `packages/server/src/api/server.ts` die Route `GET /api/projects/:id/chat` (Zeile 453–460) um das optionale Feld `costProfile` erweitern: `const costProfile = base.conversation ? deps.chatWork.costProfileFor(base.conversation) : null;` und in die Antwort aufnehmen — bestehende Felder unverändert
- [X] T017 [P] In `packages/web/src/api.ts` das Interface `ChatState` (Zeile 65–72) um `costProfile?: ChatCostProfile | null;` erweitern und den Typ aus `@sdd/shared` importieren (bestehende Import-Zeile ergänzen)
- [X] T018 In `packages/server/src/services/chatWorkService.test.ts` einen `describe`-Block „Kostenprofil an der Turn-Grenze" ergänzen: Turn-Ende schreibt Verbrauch und Verlaufsgröße in den Ringpuffer; der Ringpuffer hält höchstens drei Turns; ein Turn ohne messbaren Verbrauch landet als `measured: false` (nicht als `0`, FR-016); `costProfileFor()` liefert vor dem ersten Turn `null`; nach `restart()` ist das Profil der frischen Unterhaltung leer (FR-012)
- [X] T019 [P] In `packages/server/src/api/server.test.ts` prüfen, dass `GET /api/projects/:id/chat` das Feld `costProfile` mitliefert (ohne Messung `null`) und die bestehenden Felder `workSession`/`workPaused`/`pendingFeatures` unverändert bleiben

**Checkpoint**: Urteilsmodul getestet, Leerlaufzeit an einer Stelle, Messung wird je Unterhaltung festgehalten und über `GET /chat` transportiert — die Stories können beginnen

---

## Phase 3: User Story 1 - Der teure Verlauf meldet sich selbst (Priority: P1) 🎯 MVP

**Goal**: Ein Wissens-Chat mit großem Verlauf bzw. hohem gelesenen Kontext bietet an der Turn-Grenze von selbst die bestehende Entscheidung „Chat fortsetzen / Neuen Chat starten" an — ohne Leerlaufzeit, verlustfrei, ablehnbar, ohne die Konsole zu blockieren.

**Independent Test**: Wissens-Chat mit Verlauf über der Schwelle (bzw. Turn über `cacheReadTokensPerTurn`) einen Turn beenden lassen: die Entscheidungskarte erscheint, obwohl keine Leerlaufzeit abgelaufen ist und die Session weiterläuft; der Neustart darüber beginnt frisch, der vorherige Verlauf bleibt erhalten.

### Implementation for User Story 1

- [X] T020 [US1] In `packages/server/src/services/chatWorkService.ts` `dismissOffer(projectId: string): void` ergänzen (FR-008/FR-009): setzt im `hygiene`-Eintrag der aktiven Unterhaltung den `watermark` auf die aktuellen Werte (`historyBytes` **und** `cacheReadTokens` des jüngsten Turns), bewertet das Profil mit diesem Wasserstand neu (`offerOpen: false`) und emittiert `chat_updated` — Muster wie `dismissProposal()` (Zeile 300)
- [X] T021 [US1] In `packages/server/src/api/server.ts` die Route `POST /api/projects/:id/chat/work/offer/dismiss` ergänzen (direkt hinter der bestehenden `.../features/dismiss`, Zeile 488): ruft `deps.chatWork.dismissOffer(req.params.id)` und antwortet `{ ok: true }`
- [X] T022 [P] [US1] In `packages/web/src/api.ts` `dismissChatRestartOffer: (projectId: string) => …` im `api`-Objekt ergänzen (neben `dismissChatFeatures`, Zeile 393): `POST /api/projects/${projectId}/chat/work/offer/dismiss`
- [X] T023 [US1] In `packages/server/src/services/chatWorkService.test.ts` einen `describe`-Block „Neustart-Angebot aus Kosten" ergänzen: Angebot nach Turn-Ende bei Verlauf über der Schwelle **ohne** Leerlauf (AC1/SC-001); Angebot bei gelesenem Kontext über `cacheReadTokensPerTurn`, obwohl der Verlauf klein ist (AC2); während `status === 'working'` entsteht kein Angebot und `costProfileFor()` erzeugt keines (AC5/FR-007); frischer Chat mit kurzem Verlauf über mehrere Turns → kein Angebot (AC6/SC-004); `dismissOffer()` unterdrückt das Angebot und im selben Turn erscheint kein zweites (AC4/SC-006); nach weiterem Wachstum um eine Schwellenstufe wird erneut angeboten (FR-009); pausierte **und** teure Unterhaltung ergibt genau eine Karte mit beiden Gründen (AC7/FR-013)
- [X] T024 [P] [US1] In `packages/server/src/api/server.test.ts` die neue Route prüfen: `POST /api/projects/:id/chat/work/offer/dismiss` antwortet `{ ok: true }`, danach liefert `GET /chat` `costProfile.offerOpen === false`; unbekannte Projekt-ID → 404 wie bei den benachbarten Chat-Routen
- [X] T025 [US1] In `packages/web/src/components/ChatPanel.tsx` den nicht blockierenden Hinweisstreifen **über** der Konsole ergänzen (FR-008, SC-006): normales Layout-Element im Flex-Container direkt vor dem Terminal-`div` (Zeile 230), sichtbar nur wenn `chat?.costProfile?.offerOpen && !paused`; `WarningIcon` aus `./icons.js` + `costProfile.message` als Text; Aktionen „Chat fortsetzen" (ruft `api.dismissChatRestartOffer`) und „Neuen Chat starten" (bestehendes `onRestart`); **kein** Overlay/Dialog, **kein** `autoFocus`, **kein** globaler Key-Handler — das Terminal behält Größe und Fokus
- [X] T026 [US1] In `packages/web/src/components/ChatPanel.tsx` den Text der bestehenden Pausiert-Karte (Zeile 231–257) aus `costProfile.message` speisen, wenn zusätzlich Kosten-Gründe vorliegen (FR-013): eine Karte, deren Text die zutreffenden Gründe nennt; fällt auf den bisherigen Wortlaut zurück, wenn nur Leerlauf vorliegt — die Verzweigung bleibt `paused ? Karte : offerOpen ? Streifen+Terminal : Terminal`, nie beides
- [X] T027 [US1] In `packages/web/src/components/ChatPanel.tsx` `resume()` (Zeile 140–144) um den Aufruf von `api.dismissChatRestartOffer(projectId)` erweitern, bevor das Terminal gemountet wird — sonst springt direkt nach „Chat fortsetzen" der Streifen an (Doppelfrage)
- [ ] T028 [US1] Szenarien 1, 3, 4 und 5 aus `specs/kontext-hygiene-im-wissens-chat/quickstart.md` manuell durchspielen (eigene Toolkit-Instanz auf freiem Port, nicht 4820/4830): Angebot ohne Leerlauf, Konsole behält Eingaben bei offenem Angebot, Neustart über das Angebot lässt den Verlauf bestehen und hält die `needsConfirm`-Rückfragen ein (FR-010/FR-011), frischer Chat warnt nicht
  - **Offen, bewusst zurückgestellt** (Entscheidung 30.07.2026): braucht einen echten Wissens-Chat mit ≳ 8 MB Verlauf bzw. Turns über 150'000 gelesenen Tokens — hier nicht reproduzierbar. Ausdrücklich **nicht** über abgesenkte `CHAT_HYGIENE_LIMITS` erzwungen: genau das hatte den Baum rot hinterlassen (Befund im quickstart-Protokoll). Die Entscheidungen dahinter sind automatisiert abgedeckt; offen bleibt der Augenschein am echten Terminal.

**Checkpoint**: US1 ist allein nutzbar und abnahmefähig — der teure Verlauf meldet sich selbst, verlustfrei und ohne die Arbeit zu unterbrechen (MVP)

---

## Phase 4: User Story 2 - Die Kosten des letzten Turns stehen im Chat (Priority: P2)

**Goal**: Kontextgröße und Kosten des zuletzt beendeten Turns sind direkt im Chat-Panel ablesbar, ohne Wechsel der Ansicht — fehlende Werte als „unbekannt", nie als Null.

**Independent Test**: In einem Wissens-Chat einen Turn beenden: unmittelbar danach stehen gelesene Kontextgröße und Kosten dieses Turns im Panel; ein frischer Chat zeigt „noch keine Messung".

### Implementation for User Story 2

- [X] T029 [US2] In `packages/web/src/components/ChatPanel.tsx` den Kennzahlen-Streifen **unter** der Konsole ergänzen (FR-014, SC-002): eigenes Layout-Element nach dem Terminal-`div` und vor der Vorschlagskarte (Zeile 269–271); zeigt aus `chat?.costProfile?.lastTurn` die gelesene Kontextgröße mit `fmtTokens` und die Kosten mit `fmtCost` (beide aus `./charts.js`), dazu die Verlaufsgröße über `formatHistorySize()` aus `@sdd/shared`
- [X] T030 [US2] In `packages/web/src/components/ChatPanel.tsx` die Leerfälle des Kennzahlen-Streifens abdecken (FR-016, AC3/AC4): `lastTurn === null` → „noch keine Messung" (unauffällig, stört die Konsole nicht); einzelne `null`-Felder → „unbekannt" statt `0 Tokens` oder `$0.00`; die Zahlen beziehen sich stets auf den zuletzt beendeten Turn
- [ ] T031 [US2] Szenario 2 aus `specs/kontext-hygiene-im-wissens-chat/quickstart.md` manuell nachweisen: nach einem Turn stehen Kontextgröße und Kosten ohne weiteren Klick im Panel; ein „danke, passt"-Turn in einem großen Chat weist dieselben hohen Zahlen aus wie ein Turn mit echter Arbeit (SC-007); frischer Chat zeigt „noch keine Messung"
  - **Offen, bewusst zurückgestellt** — wie T028. Der Leerfall („noch keine Messung", „unbekannt" statt `0`/`$0.00`) ist im Code als eigener Zweig von `CostStrip` umgesetzt und über `chatHygiene.test.ts` (FR-016-Block) abgedeckt.

**Checkpoint**: US1 und US2 funktionieren unabhängig voneinander

---

## Phase 5: User Story 3 - Das Verhältnis gelesener Kontext zu Ausgabe als Kennzahl (Priority: P3)

**Goal**: Das Verhältnis gelesener Kontext : erzeugte Ausgabe des letzten Turns ist eine eigene, lesbare Kennzahl und wird ab `ratioCritical` sichtbar als kritisch markiert.

**Independent Test**: Turn mit viel gelesenem Kontext und wenig Ausgabe beenden → Verhältnis wird ausgewiesen und als kritisch markiert; Turn mit ausgewogenem Verhältnis wird ausgewiesen, aber nicht markiert.

### Implementation for User Story 3

- [X] T032 [US3] In `packages/web/src/components/ChatPanel.tsx` das Verhältnis als eigene Kennzahl im Streifen ausweisen (FR-015, AC1): Text aus `ratioLabel(chat.costProfile.ratio)` (`@sdd/shared`), damit `no_output` und `unknown` einen definierten Wert zeigen statt „Infinity"/„NaN" (AC4)
- [X] T033 [US3] In `packages/web/src/components/ChatPanel.tsx` die kritische Markierung ergänzen (FR-015, AC2/AC3): ab `ratio.kind === 'value' && ratio.ratio >= CHAT_HYGIENE_LIMITS.ratioCritical` sichtbar markieren (`WarningIcon` + Warnfarbe im Stil des bestehenden dunklen Layouts, keine Emojis); darunter sichtbar, aber unmarkiert
- [ ] T034 [US3] Manuell nachweisen (SC-003): ein Turn mit ~265'000 gelesenen Kontext-Tokens und ~300 Ausgabe-Tokens wird als kritisch markiert, ein ausgewogener Turn nicht; Ergebnis in `specs/kontext-hygiene-im-wissens-chat/quickstart.md` bei Szenario 2 vermerken
  - **Offen, bewusst zurückgestellt** — wie T028. Die Schwelle selbst ist als Test festgeschrieben (`chatHygiene.test.ts` → „das Verhältnis des Referenzfalls liegt in der Gegend der kritischen Marke": 265'673 : 250 liegt über `ratioCritical`); die Markierung im Streifen liest denselben Wert über `CHAT_HYGIENE_LIMITS.ratioCritical`.

### Entscheidung zu T028 / T031 / T034 (30.07.2026)

**Frage:** Die manuellen Nachweise brauchen einen echten Wissens-Chat mit ≳8 MB Verlauf bzw. Turns
über 150'000 Tokens. Wie damit umgehen?

**Antwort: eigene Instanz JA — die Daten aber gestellt, nicht erzeugt.**

1. **Eigene Instanz ist erlaubt und erwünscht.** Ein Schwesterfeature hat das heute vorgemacht und
   sauber abgenommen: eigene Ports, eigenes `SDD_DATA_DIR` im Agenten-Scratchpad, Abräumen
   ausschliesslich über `lsof -ti:<port> | xargs -r kill`. Nimm freie Ports — **nicht** 4820/4830
   (laufende Instanz) und **nicht** 4921/4931 oder 4922/4932 (heute schon benutzt), z. B.
   `SDD_PORT=4941 SDD_WEB_PORT=4951`. Generische `pkill`/`killall`-Muster bleiben verboten
   (Projektregel in `CLAUDE.md`); sie sind die Ursache des Selbstabschusses vom 26.07.2026, nicht
   die isolierte Instanz.

2. **Erzeuge die 8 MB und die 265'000 Kontext-Tokens NICHT durch echte Turns.** Ein Turn mit
   265'000 gelesenen Tokens ist kein Testfixture, sondern eine Rechnung — und genau die
   Verschwendung, die dieses Feature sichtbar machen soll. Es wäre widersinnig, sie zum Nachweis
   zu verursachen.

3. **Stattdessen die Instanz mit Fixtures befüllen.** Alle drei Kennzahlen leitet das Toolkit aus
   Daten ab, die sich direkt schreiben lassen:
   - Kontextgrösse: Grösse der Transkriptdatei → lege im `SDD_DATA_DIR` der Testinstanz eine
     Transkriptdatei von ~8 MB an (wiederholte, gültige JSONL-Zeilen genügen).
   - Verhältnis und kritische Markierung: `cache_read_tokens` und `output_tokens` der
     `executions`-Zeile → schreibe eine Zeile mit ~265'000 / ~300 für den kritischen Fall und eine
     ausgewogene für die Gegenprobe.
   - Kosten: `cost_micros` derselben Zeile.
   Damit prüfst du genau das, was das Feature baut — die **Beurteilung** der Zahlen —, und nicht
   die Fähigkeit des Modells, 265'000 Tokens zu lesen.

4. **Was echte Augen braucht** und daher an der Testinstanz beobachtet wird: dass Grösse und Kosten
   nach einem Turn **ohne weiteren Klick** im Panel stehen (T031), dass ohne Inhalt **kein** Angebot
   erscheint (T028), und dass der kritische Fall markiert, der ausgewogene nicht (T034). Ein
   einzelner echter, kleiner Turn genügt dafür — die Schwellenwerte kommen aus den Fixtures.

5. **Ehrlich beschriften.** Vermerke im `quickstart.md`, dass die Schwellenwerte **gestellt** sind
   (mit den konkreten Zahlen und dem Weg, wie sie eingespielt wurden), und nicht aus organisch
   gewachsenem Verlauf stammen. Ein Nachweis, der seine Herkunft verschweigt, ist genau das
   Problem, das dieses Projekt an anderer Stelle abstellt.

**Checkpoint**: Alle drei Stories sind unabhängig funktionsfähig

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Abnahme, Konventionstreue, Nachjustierbarkeit

- [X] T035 `pnpm -r typecheck && pnpm -r test` im Repo-Root grün — insbesondere `packages/shared/src/chatHygiene.test.ts`, `packages/server/src/services/chatWorkService.test.ts` und `packages/server/src/api/server.test.ts`
- [X] T036 Referenzfall-Nachweis (SC-004) in `specs/kontext-hygiene-im-wissens-chat/quickstart.md` festhalten: für 16,8 MB Verlauf / ~265'000 gelesene Tokens / 100–400 Ausgabe-Tokens erscheint das Angebot; für einen frischen Chat mit weniger als zehn Turns in keinem Turn
- [X] T037 [P] Konventions-Review: `packages/shared/src/chatHygiene.ts` enthält keinen `node:`-Import und kein React; `git diff` zeigt keine Änderung an `package.json`-Dependencies (plan.md: null neue Runtime-/Dev-Deps); UI-Texte deutsch, SVG-Icons statt Emojis
- [X] T038 [P] Nachjustierbarkeit prüfen (FR-018): `grep -rn "8 \* 1024\|150_000\|50_000\|300\b\|1000\b" packages/server/src packages/web/src` zeigt keine der Grenzwerte außerhalb von `CHAT_HYGIENE_LIMITS`; `grep -rn "CHAT_IDLE_TIMEOUT_MS" packages/` findet nichts mehr

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle Stories**
- **User Stories (Phase 3–5)**: alle nach Phase 2; danach in Prioritätsfolge P1 → P2 → P3 oder parallel
- **Polish (Phase 6)**: nach den gewünschten Stories

### Kritischer Pfad innerhalb Phase 2

- T003 → T004/T005/T006 (gleiche Datei, daher sequenziell) → T007 (Tests dazu)
- T003 → T008 (andere Datei, parallel zu T004–T007)
- T008 → T009 → T010 (**Tor**: `pnpm -r test` grün, bevor Feature-Änderungen beginnen)
- T010 → T011 → T012 → T013 → T014 → T015 (alle in `chatWorkService.ts`, sequenziell)
- T015 → T016 → T019; T015 → T018; T017 parallel zu T016 (anderes Paket)

### User Story Dependencies

- **US1 (P1)**: nur Phase 2 — keine Abhängigkeit von US2/US3
- **US2 (P2)**: nur Phase 2 (liest `costProfile.lastTurn`) — unabhängig von US1
- **US3 (P3)**: nur Phase 2 (liest `costProfile.ratio`); baut in denselben Streifen wie US2, ist aber ohne US2 lauffähig — wird US2 übersprungen, legt T032 den Streifen selbst an

### Innerhalb der Stories

- Server vor Transport vor Oberfläche
- `ChatPanel.tsx`-Aufgaben (T025, T026, T027, T029, T030, T032, T033) laufen **nie** parallel — dieselbe Datei
- Manuelle Nachweise (T028, T031, T034) jeweils zuletzt in ihrer Story

### Parallel Opportunities

- T008 parallel zu T004–T007 (nach T003)
- T017 parallel zu T016; T019 parallel zu T018; T024 parallel zu T023
- T022 parallel zu T021
- T037 parallel zu T038
- Nach Phase 2 können US1, US2 und US3 von verschiedenen Personen begonnen werden — Kollisionsrisiko allein in `ChatPanel.tsx`

---

## Parallel Example: Phase 2

```bash
# Nach T003 (Modul mit Limits + Typen existiert):
Task: "T004 contextRatio/ratioLabel/formatHistorySize in packages/shared/src/chatHygiene.ts"
Task: "T008 Re-Export in packages/shared/src/index.ts"

# Nach T015 (costProfileFor existiert):
Task: "T016 costProfile in GET /chat in packages/server/src/api/server.ts"
Task: "T017 ChatState.costProfile in packages/web/src/api.ts"

# Testarbeit am Ende der Phase:
Task: "T018 Profil-Tests in packages/server/src/services/chatWorkService.test.ts"
Task: "T019 costProfile-Feldtest in packages/server/src/api/server.test.ts"
```

## Parallel Example: User Story 1

```bash
# Nach T020 (dismissOffer existiert):
Task: "T021 Dismiss-Route in packages/server/src/api/server.ts"
Task: "T022 dismissChatRestartOffer in packages/web/src/api.ts"

# Tests danach:
Task: "T023 Angebots-Tests in packages/server/src/services/chatWorkService.test.ts"
Task: "T024 Routen-Test in packages/server/src/api/server.test.ts"
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T019) — **blockiert alles**, endet mit grünen Tests
3. Phase 3: User Story 1 (T020–T028)
4. **STOP und ABNEHMEN**: SC-001, SC-004, SC-005, SC-006 nachweisen
5. Der Sparbeitrag ist damit vollständig realisiert — die beiden Anzeige-Stories sind Komfort

### Incremental Delivery

1. Setup + Foundational → Fundament steht, Leerlaufzeit an einer Stelle, Messung läuft
2. US1 → Angebot ohne Leerlauf (MVP, spart auch dann, wenn niemand hinsieht)
3. US2 → Zahlen im Panel (SC-002, SC-007)
4. US3 → Kennzahl mit kritischer Markierung (SC-003)

### Parallel Team Strategy

Nach Phase 2 kann Person A US1 (Server + Streifen) übernehmen, Person B US2+US3 (Kennzahlen-Streifen).
US2 und US3 gehören sinnvoll in eine Hand, weil sie dieselbe Stelle in `ChatPanel.tsx` bebauen.

---

## Notes

- `[P]` = andere Datei, keine offene Abhängigkeit
- Der Umzug von `CHAT_IDLE_TIMEOUT_MS` (T009/T010) ist bewusst **eine** Änderung vor allen Feature-Schritten — Grund und Abweichungsbegründung siehe plan.md „Constitution Check"
- `.specify/memory/constitution.md` ist ein unausgefülltes Template; es gelten die Repo-Konventionen als Gates (plan.md „Constitution Check"): Urteil pure in `shared` mit vitest, `@sdd/shared` node-frei, keine neuen Dependencies, deutsche UI mit SVG-Icons
- `null` statt `0`, durchgängig (FR-016) — dieselbe Regel, die `summarizeEvents()` schon für `costMicros` einhält
- Zustand nur im Speicher: nach einem Server-Neustart wird an der ersten Turn-Grenze neu bewertet; ein dann erneut erscheinendes Angebot ist sachlich richtig. Keine Migration, kein DB-Feld
- Beim manuellen Testen eigene Ports verwenden (nicht 4820/4830) und ausschließlich die eigene Instanz abräumen (`lsof -ti:PORT | xargs kill`) — siehe `CLAUDE.md`
- Nach jeder Aufgabe oder logischen Gruppe committen; an jedem Checkpoint kann die Story einzeln abgenommen werden
