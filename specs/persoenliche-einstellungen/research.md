# Phase 0 Research: Individuelle Einstellungen (Signaltöne, Themes, Vorauswahl Ticket-Quelle)

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Dieses Dokument hält den erhobenen Ist-Zustand fest und löst die offenen Punkte
der Technical Context. Die Entscheidungen E1–E7 der Spec sind **Vorgaben**, keine
Forschungsergebnisse — sie werden hier nur dort aufgegriffen, wo sie eine
Umsetzungsentscheidung erzwingen.

---

## Ist-Zustand (Codebefund)

Alle Annahmen der Spec wurden am Code geprüft:

| Behauptung der Spec | Befund | Fundstelle |
|---|---|---|
| Ein Zwei-Ton-Beep, ohne Audiodatei erzeugt | `AudioContext`, zwei Sinus-Oszillatoren 880 Hz / 1174 Hz, je 150 ms, Versatz 120 ms, `gain = 0.06` | `packages/web/src/store.tsx:378-399` |
| Genau zwei Ereignisse hörbar | `n.kind === 'turn_completed' \|\| n.kind === 'merged'` | `packages/web/src/store.tsx:531` |
| Rückfragen bewusst stumm („WhisperM8-Regel") | Kommentar an derselben Stelle | `packages/web/src/store.tsx:530` |
| Ein gerätelokaler An/Aus-Schalter | `localStorage['sdd-sound']`, UI im Automation-Dial | `store.tsx:369-375`, `components/AutomationDial.tsx:251-262` |
| Zehn Aufmerksamkeitsereignisse vorhanden | `AttentionKind` mit exakt den zehn Werten der Spec | `packages/shared/src/types.ts:222-232` |
| Sieben Feature-Phasen | `FEATURE_PHASES` (specify … implement); `ProjectPhase = 'constitution'` separat | `packages/shared/src/types.ts:2-15` |
| Genau zwei Farbmodi | `ThemeMode = 'light' \| 'dark'` | `packages/web/src/theme.ts:13` |
| 56 Farbvariablen + `color-scheme` | `:root[data-theme='light']`: 12 neutral (inkl. `zinc-925`) + 4 × 11 Akzent = 56 | `packages/web/src/index.css:17-85` |
| Konsole hängt an eigenem Schema | `terminalTheme(mode)` liefert zwei vollständige `ITheme`-Paletten | `packages/web/src/terminalTheme.ts` |
| Nutzerweite Einstellungsablage vorhanden | Tabelle `settings(key, value)`, `SettingsRepo.getJson/setJson` | `packages/server/src/db/database.ts:84`, `db/repos.ts:1093-1105` |
| „Neues Feature" öffnet Jira bei Verbindung | `FeatureSourceGate`: `setMode(c ? 'jira' : 'manual')` | `packages/web/src/components/Sidebar.tsx:303-351` |
| Letzte Jira-Auswahl liegt getrennt | Settings-Key `jira.lastSelection` | `packages/server/src/api/server.ts:930-936` |

**Korrektur zur Spec**: `FR-004` zählt „mindestens 20" Auslöser; die aufgeführte
Zusammensetzung ergibt **exakt 20** (10 + 2 + 1 + 7). Es wird nicht künstlich
aufgefüllt — die Projekt-Phase `constitution` bleibt laut Spec-Assumption außen vor.

---

## D1 — Zwei Ereignisströme, aber genau eine Tonquelle je Auslöser

- **Decision**: Die zehn Aufmerksamkeits-Auslöser werden vom WS-Event
  `attention_raised` gespeist (Feld `kind` → `AttentionKind`, 1:1). Die zwei
  Ablauf-Auslöser werden vom WS-Event `notification` gespeist, und zwar
  **ausschließlich** für `kind ∈ {turn_completed, merged}`. Die
  Notification-Arten `input_requested` und `escalation` werden von der Ton-Ebene
  **ignoriert**.
- **Rationale**: Beide Ströme überlappen. Der Server sendet zu ein und demselben
  Vorfall sowohl ein Inbox-Item als auch eine Notification: `awaiting_input` +
  `input_requested` (`orchestrator.ts:795-815`) sowie `phase_gate_failed` +
  `escalation` (`orchestrator.ts:420-433`) bzw. eskalierter Merge-Konflikt +
  `escalation` (`mergeQueueService.ts:750`). Ohne diese Aufteilung würde ein
  Vorfall zwei Töne auslösen — sichtbar als „doppelter Piep" und im Widerspruch
  zu FR-017 (eine Ausgabe je Ereignis). Die gewählte Zuordnung erhält zugleich
  exakt das heutige Verhalten für die Standardbelegung (FR-012): heute hängt der
  Ton am `notification`-Strom mit genau diesen zwei Arten.
- **Alternatives considered**:
  (a) Alles aus `notification` — verworfen: nur vier Arten, sechs
  Aufmerksamkeitsereignisse wären unerreichbar.
  (b) Alles aus `attention_raised` — verworfen: `turn_completed`/`merged`
  erzeugen kein Inbox-Item, die beiden heute hörbaren Ereignisse fielen weg.
  (c) Beide Ströme, Duplikate über einen Zeitfenster-Filter unterdrücken —
  verworfen: raten statt wissen; der Server sagt die Zuordnung bereits eindeutig.

## D2 — „Phase erreicht" = Eintritt in `running`, erkannt durch Diff auf `feature_updated`

- **Decision**: Es wird **kein neues Server-Event** eingeführt. Die Oberfläche
  hält je Feature den letzten `phases`-Stand und vergleicht ihn beim Eintreffen
  von `feature_updated`. Eine Phase gilt als *erreicht*, wenn ihr Status auf
  `running` wechselt und vorher nicht `running` war. Die reine Diff-Funktion
  liegt in `@sdd/shared` (`enteredPhase(prev, next)`) und ist dort testbar.
- **Rationale**: `feature_updated` trägt das vollständige `Feature` inklusive
  `phases: Record<FeaturePhase, PhaseState>` (`types.ts:125`) und wird bei jedem
  Phasenübergang gesendet (`emitFeature` nach `savePhases`). Die Spec-Assumption
  „es wird kein neues Ereignis erfunden und keine neue Ereignisquelle gebaut" ist
  damit einhaltbar. `running` ist der einzige Zustand, in den eine Phase durch
  `startPhase` eintritt (`phaseMachine.ts:46`) — er markiert genau den Moment
  „das Feature ist jetzt in dieser Phase".
- **Konsequenz (bewusst)**: Ein **Neustart** derselben Phase gilt erneut als
  „erreicht" und klingt wieder. Das ist gewollt: hörbar ist „diese Phase läuft
  jetzt an", nicht „zum ersten Mal".
- **Alternatives considered**:
  (a) `approved` als Auslöser — verworfen: das ist „Phase abgeschlossen", nicht
  „erreicht", und fällt bei Auto-Progress mit dem Start der Folgephase zusammen.
  (b) Neues Server-Event `phase_entered` — verworfen: doppelte Wahrheit neben
  `feature_updated`, verstösst gegen die Spec-Assumption.

## D3 — Spezifität bei Phasen-Auslösern: spezifisch gewinnt, **sofern nicht Stille**

- **Decision**: Trifft ein Phaseneintritt zu, wird zuerst `phase:<phase>`
  geprüft. Ist dort eine Reaktion ≠ Stille hinterlegt, erklingt genau diese.
  Sonst gilt `phase:changed`. Es erklingt in jedem Fall höchstens eine Ausgabe
  (FR-016).
- **Rationale**: „Die spezifischere Zuordnung gewinnt" darf nicht bedeuten
  „Stille gewinnt immer" — alle sieben Phasen-Auslöser starten laut FR-012 auf
  Stille, wodurch der generische Auslöser `phase:changed` nie zum Zug käme und
  als in FR-004 geforderter Auslöser wertlos wäre. Die gewählte Auflösung macht
  beide Ebenen nutzbar: generisch als Grundton, spezifisch als Ausnahme.
- **Alternatives considered**: Spezifisch gewinnt bedingungslos (auch Stille).
  Verworfen: macht `phase:changed` funktionslos und widerspricht FR-004.

## D4 — Ton-Katalog: parametrische Sequenzen, Unterscheidbarkeit über Fingerprint

- **Decision**: Ein Ton ist Daten, kein Code: `{ id, label, wave, steps[] }` mit
  `steps: { freq, ms, gapMs }[]`. Der Katalog liegt als pures Modul in
  `@sdd/shared` (22 Einträge, ≥ 20 gefordert). Die Unterscheidbarkeit aus FR-006
  wird als **Fingerprint-Invariante** geprüft: `wave` + Tonhöhenfolge +
  Rhythmusfolge (Dauern und Pausen) müssen als Tripel paarweise eindeutig sein;
  zusätzlich müssen `id` und `label` eindeutig sein. Der Web-Renderer ist ein
  reiner Interpreter dieser Daten.
- **Rationale**: Der heutige Beep beweist, dass Oszillatoren genügen (Spec-
  Assumption „Töne ohne Dateien"). Daten statt 22 Einzelfunktionen machen die von
  FR-006 verlangte Prüfbarkeit überhaupt möglich — eine Funktion pro Ton wäre
  nicht maschinell vergleichbar. Der erste Katalogeintrag ist der heutige Beep
  (880 → 1174, Sinus, 150/120 ms), damit FR-012/FR-013 wortgetreu erfüllbar sind.
- **Alternatives considered**:
  (a) Je Ton eine Renderfunktion — verworfen: FR-006 nicht prüfbar.
  (b) Mitgelieferte Audiodateien — verworfen, ausdrücklich nicht im Umfang.

## D5 — Serialisierung: FIFO mit Fertig-Signal, kein Zeitraster

- **Decision**: Eine Warteschlange im Web spielt strikt seriell: der nächste
  Eintrag startet erst, wenn der vorherige sein Ende gemeldet hat
  (`onended` des letzten Oszillators bzw. `onend`/`onerror` der Sprachausgabe),
  mit einer Sicherheitsfrist als Notausgang. Kapazität 20 Einträge (SC-006
  verlangt 10); darüber hinaus wird der **älteste noch nicht begonnene** Eintrag
  verworfen. Die Warteschlange erhält den Player als Abhängigkeit injiziert und
  ist damit ohne Audio-Hardware testbar.
- **Rationale**: FR-017 verlangt „kein Ton DARF beginnen, während ein anderer
  noch klingt". Ein festes Zeitraster (z. B. 400 ms Takt) würde bei gesprochenen
  Ansagen unbekannter Länge brechen; das Fertig-Signal ist die einzige verlässliche
  Quelle. Die Sicherheitsfrist verhindert, dass eine verschluckte `onend`-Meldung
  (bekanntes Verhalten der Browser-Sprachausgabe) die Schlange dauerhaft blockiert.
- **Alternatives considered**:
  (a) Zeitraster — verworfen (siehe oben).
  (b) Neueste zuerst / Verdrängung — verworfen: SC-006 verlangt zehn
  unterscheidbare Ausgaben, nicht die zehnte.

## D6 — Ein gemeinsamer, träge erzeugter `AudioContext`

- **Decision**: Ein einziger, beim ersten Bedarf erzeugter `AudioContext` mit
  einem Master-`GainNode` (Standardwert `0.06` = heutiger Pegel, FR-013). Vor
  jeder Ausgabe `resume()`; scheitert das, entfällt die Ausgabe still (FR-018).
- **Rationale**: Heute entsteht pro Beep ein neuer Kontext, der nach 600 ms per
  `setTimeout` geschlossen wird (`store.tsx:395`). Bei zehn dicht aufeinander
  folgenden Ereignissen wären das zehn Kontexte — Browser begrenzen deren Zahl
  hart. Ein gemeinsamer Kontext ist zugleich die Voraussetzung für eine gemeinsame
  Grundlautstärke.
- **Alternatives considered**: Kontext pro Ausgabe beibehalten — verworfen:
  Ressourcengrenze und kein gemeinsamer Pegel.

## D7 — Leerer Ansagetext: Auslöser-Bezeichnung sprechen

- **Decision**: Ist für eine gesprochene Ansage kein Text hinterlegt (leer oder
  nur Leerraum), wird die **Bezeichnung des Auslösers** gesprochen
  (z. B. „Review fällig").
- **Rationale**: Die Spec lässt beide Wege zu („Standardtext oder wie Stille").
  Wer „Ansage" wählt, will hören — nicht schweigen. Die Auslöser-Bezeichnung
  existiert bereits im Katalog und braucht keine zweite Textquelle.
- **Alternatives considered**: Wie Stille behandeln. Verworfen: eine bewusst
  gewählte Reaktion würde ohne Rückmeldung wirkungslos.

## D8 — Ablage: zwei Settings-Einträge, ausgeliefert über den Boot-Zustand

- **Decision**: Zwei Einträge in der bestehenden Tabelle `settings`:
  `sound` und `ticketSource`. Gelesen werden sie gebündelt als `personal` im
  bestehenden `GET /api/state`; geschrieben über ein neues
  `PATCH /api/settings/personal` mit Teilmengen-Semantik. Die Designwahl bleibt
  gerätelokal in `localStorage` (Spec-Assumption).
- **Rationale**: Zwei Einträge entsprechen wortgetreu der Spec-Dependency
  („wird um zwei Einträge erweitert") und halten E6 ein — `ticketSource` liegt
  getrennt von `jira.lastSelection`. Die Auslieferung über `/api/state` vermeidet
  einen zweiten Rundlauf beim Start: der Store bootstrappt dort ohnehin
  (`store.tsx:443`), und `automation`/`optimization` liegen schon genau so
  (`server.ts:172-173`). Ohne das käme das erste Ereignis womöglich vor den
  Einstellungen an und würde mit Standardwerten vertont.
- **Alternatives considered**:
  (a) Ein Blob-Eintrag `personal` — verworfen: widerspricht der Spec-Dependency,
  ohne etwas zu sparen.
  (b) Eigenes `GET /api/settings/personal` als einzige Quelle — verworfen:
  Wettlauf gegen die ersten WS-Ereignisse. (Die GET-Route entsteht trotzdem
  nicht — der Boot-Zustand genügt.)

## D9 — Übernahme des alten Schalters: einmalige Migration, dann Abbau

- **Decision**: Der gerätelokale Schalter wird aus dem Automation-Dial
  **entfernt** (FR-011). Beim Start gilt: existiert serverseitig noch kein
  `sound`-Eintrag und steht `localStorage['sdd-sound'] === 'off'`, wird der
  Hauptschalter als **aus** übernommen und dieser Zustand einmalig serverseitig
  festgeschrieben. Der `sdd-sound`-Schlüssel wird danach nicht mehr gelesen.
- **Rationale**: FR-015 verlangt genau diese Übernahme, FR-011 verbietet den
  Weiterbestand als zweiter Schalter. Die Migration muss im Web laufen — nur dort
  ist `localStorage` lesbar.
- **Alternatives considered**: Schalter stehen lassen und spiegeln — verworfen,
  FR-011 untersagt zwei Schaltstellen.

## D10 — Drittes Design als weiterer CSS-Block; Umschalter wird zum Zyklus

- **Decision**: `high-contrast` entsteht als zusätzlicher Block
  `:root[data-theme='high-contrast']` in `index.css` mit **demselben
  Schlüsselsatz** wie der Light-Block (56 Farbvariablen + `color-scheme: dark`).
  `ThemeMode` wird zu `ThemeId = 'light' | 'dark' | 'high-contrast'`. Der
  Kopfzeilen-Umschalter wechselt von „umschalten" zu „durchschalten"
  (dark → light → high-contrast → dark) und zeigt weiterhin das Icon des
  **aktiven** Designs; die vollständige Auswahl liegt zusätzlich im neuen
  Einstellungsbereich.
- **Rationale**: E1/E2 sind Vorgabe — der Block-Mechanismus bleibt, genau ein
  Design kommt hinzu. Für den Umschalter erzwingt das eine Entscheidung: bliebe
  er binär, würde er einen Nutzer im Kontrast-Design bei jedem Klick
  unvorhersehbar herauswerfen. Der Zyklus hält jedes Design über beide Wege
  erreichbar und braucht nur ein drittes Icon.
- **Alternatives considered**:
  (a) Umschalter bleibt binär, Kontrast nur über die Einstellungen — verworfen:
  der Schalter würde die getroffene Wahl stillschweigend verwerfen.
  (b) Auswahlmenü in der Kopfzeile — verworfen: mehr UI als nötig, der Zyklus
  genügt bei drei Werten.

## D11 — Test-Heimat: `vitest` auch im Web-Paket

- **Decision**: `packages/web` erhält `vitest` (`"test": "vitest run"` plus
  eigene `vitest.config.ts`, damit die Vite-Plugins für Tests nicht laden). Dort
  entstehen die Prüfungen über web-eigene Artefakte (CSS-Schlüsselsätze,
  Konsolen-Paletten, FOUC-Guard-Gleichlauf, Warteschlangen-Serialisierung).
  Katalog- und Zuordnungslogik werden dagegen in `@sdd/shared` getestet, wo
  `vitest` bereits läuft.
- **Rationale**: FR-024, FR-025 und FR-028 fordern **automatisierte** Prüfungen
  über Artefakte, die in `packages/web` liegen (`index.css`, `terminalTheme.ts`).
  Heute ist `test` dort ein No-op (`package.json`: `echo 'keine Web-Tests (MVP)'`)
  — ohne Runner sind diese drei Anforderungen nicht erfüllbar. `vitest` ist im
  Monorepo schon gesetzt (`@sdd/server`, `@sdd/shared`), `pnpm test` an der Wurzel
  ruft `pnpm -r test` und nimmt das Paket damit ohne weitere Verdrahtung auf.
- **Alternatives considered**: Prüfskript in reinem Node unter `packages/web/scripts/`.
  Verworfen: würde Zusicherungen und Berichterstattung nachbauen, die `vitest`
  mitbringt, und ein zweites Testmuster im Monorepo etablieren.

## D12 — Sprachausgabe: `speechSynthesis`, Verfügbarkeit nur beim Vorhören gemeldet

- **Decision**: Genutzt wird `window.speechSynthesis` mit
  `SpeechSynthesisUtterance` und Systemstandardstimme (keine Stimm-, Sprach-,
  Tempo- oder Tonhöhenwahl — ausdrücklich nicht im Umfang). Beim **Vorhören**
  wird fehlende Verfügbarkeit sichtbar gemeldet (FR-019): fehlendes
  `speechSynthesis`, leere Stimmenliste oder ein `onerror` der Äusserung führen
  zu einem Hinweis am Auslöser. Im **Ereignisfall** bleibt es still ohne
  Fehlermeldung (FR-018).
- **Rationale**: Die Web-Speech-Familie ist im Toolkit bereits im Einsatz
  (`components/VoiceButton.tsx` nutzt `SpeechRecognition`), also derselbe
  Browser-Mechanismus ohne neue Abhängigkeit. Die Asymmetrie
  Vorhören/Ereignisfall ist von FR-018 und FR-019 genau so verlangt.
- **Alternatives considered**: Serverseitige Sprachsynthese — verworfen: neuer
  externer Dienst, laut Spec-Dependency ausgeschlossen.
