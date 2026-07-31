# Implementation Plan: Individuelle Einstellungen (Signaltöne, Themes, Vorauswahl Ticket-Quelle)

**Branch**: `feature/persoenliche-einstellungen` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/persoenliche-einstellungen/spec.md`

## Summary

Ein neuer, nutzerweiter Einstellungsbereich „Individuelle Einstellungen" führt
drei heute fest verdrahtete Verhaltensweisen zusammen. Technischer Kern:

1. **Signaltöne (US1, der Grossteil des Umfangs)**: Der einzige Beep für zwei
   Ereignisse (`store.tsx:378-399`, `store.tsx:531`) wird durch einen **Katalog
   von 20 Auslösern × 22 Tönen + gesprochener Ansage + Stille** ersetzt. Die
   Auslöser werden **aus vorhandenem Vokabular abgeleitet** — `AttentionKind`
   (10 Werte, `types.ts:222`) und `FEATURE_PHASES` (7 Werte, `types.ts:2`) —, die
   Ereignisse kommen über die bestehenden WS-Ströme `attention_raised`,
   `notification` und `feature_updated`. Kataloge, Normalisierung und Auflösung
   liegen als **pures Modul in `@sdd/shared`** (testbar), die Ausgabe als
   datengetriebener WebAudio-/`speechSynthesis`-Interpreter mit **serieller
   Warteschlange** in `@sdd/web`. Ablage: zwei Einträge in der bestehenden
   `settings`-Tabelle, ausgeliefert im Boot-Zustand `GET /api/state`, geschrieben
   über ein neues `PATCH /api/settings/personal`. Der gerätelokale Schalter
   `sdd-sound` wird **einmalig übernommen und abgebaut** (FR-011/FR-015).
2. **Drittes Farbdesign (US2)**: `high-contrast` entsteht nach E1/E2 als
   **weiterer CSS-Block** mit demselben 56-Schlüssel-Satz wie der Light-Block
   (`index.css:17-85`) plus einer dritten vollständigen Konsolen-Palette
   (E5, `terminalTheme.ts`). `ThemeMode` wird zu `ThemeId` mit drei Werten;
   FOUC-Guard und Kopfzeilen-Umschalter ziehen mit. Die geforderten
   automatisierten Prüfungen (FR-024/025/028) entstehen als Test über die
   web-eigenen Artefakte — dafür erhält `packages/web` erstmals `vitest`.
3. **Vorauswahl Ticket-Quelle (US3)**: eine Zeile Entscheidungslogik in
   `FeatureSourceGate` (`Sidebar.tsx:314`) liest die neue Einstellung, mit
   Zwangsrückfall auf „manuell" ohne Jira-Verbindung. Getrennt von
   `jira.lastSelection` (E6).

Nicht angefasst: die sichtbaren Benachrichtigungen, der Aufmerksamkeits-Eingang,
die Ereignisquellen selbst, die semantische Token-Umstellung (E1/E3) und die
Mehr-Tab-Entdopplung.

## Technical Context

**Language/Version**: TypeScript 5.8, ESM, Node ≥ 22, React 19

**Primary Dependencies**: Fastify (Server), better-sqlite3, Vite 6,
Tailwind CSS v4 (Konfiguration in `index.css`), xterm.js 5.5, vitest 3.2.
**Neu**: keine Laufzeit-Abhängigkeit. `vitest` wird als **devDependency** in
`packages/web` ergänzt (research D11). Töne und Ansagen nutzen ausschliesslich
Browser-Bordmittel (`AudioContext`, `speechSynthesis`) — keine Assets, kein Netz.

**Storage**:
- Nutzerweit, serverseitig: SQLite-Tabelle `settings(key, value)` — zwei neue
  Einträge `sound` und `ticketSource` (`db/database.ts:84`, `db/repos.ts:1093`).
- Gerätelokal: `localStorage['sdd-theme']` ∈ {`light`,`dark`,`high-contrast`};
  `localStorage['sdd-sound']` wird nur noch **einmalig zur Übernahme gelesen**
  und danach nicht mehr verwendet.

**Testing**: `vitest` — bestehend in `@sdd/shared` und `@sdd/server`, **neu** in
`@sdd/web` (`"test": "vitest run"` + eigene `vitest.config.ts`, damit die
Vite-Plugins für Tests nicht laden). Erzwungen durch FR-024/FR-025/FR-028: die zu
prüfenden Artefakte (`index.css`, `terminalTheme.ts`, `index.html`) liegen in
`packages/web`, wo `test` heute ein No-op ist. Hörbare Kriterien (SC-002, SC-003,
SC-004, SC-005, SC-006 manuell, SC-008 … SC-010) über
[quickstart.md](./quickstart.md).

**Target Platform**: Moderne Browser (Chromium/WebKit/Firefox) gegen den lokalen
Fastify-Server; lokale Einzelinstanz, keine Nutzerkonten.

**Project Type**: pnpm-Monorepo, Web-Anwendung mit Server — betroffen sind
`@sdd/shared`, `@sdd/server` und `@sdd/web`. `@sdd/desktop` bleibt unverändert.

**Performance Goals**: Vorhören hörbar < 1 s (SC-002); Designwechsel sichtbar
< 1 s ohne Neuladen (SC-008); zehn dichte Ereignisse ⇒ zehn einzeln
unterscheidbare Ausgaben (SC-006); kein sichtbares Umfärben nach dem Laden
(SC-009).

**Constraints**:
- Kein neues WS-Ereignis, keine neue Ereignisquelle (Spec-Assumption).
- Genau **eine** hörbare Ausgabe je Vorfall — die überlappenden Ströme
  `attention_raised`/`notification` erzwingen eine explizite Zuordnung
  (research D1).
- Standardzustand muss **bitgenau** dem heutigen entsprechen: zwei hörbare
  Ereignisse, `gain = 0.06`, Beep 880/1174 Hz (FR-012/FR-013).
- E1/E2/E3 sind gesetzt: Farbwerte bleiben beim CSS-Block-Mechanismus, genau ein
  zusätzliches Design, nicht-semantische Skalennamen bleiben offen.
- Blockierte Audio-/Sprachausgabe darf im Ereignisfall **nichts** melden (FR-018),
  beim Vorhören **muss** sie melden (FR-019).
- Prozessregeln des Projekts: eigene Instanz nur auf eigenen Ports, kein
  `pkill -f` mit generischem Muster (`CLAUDE.md`).

**Scale/Scope**: 20 Auslöser, 22 Töne, 3 Designs. **5 neue Quelldateien**
(`soundCatalog.ts`, `sound.ts`, `personalSettings.ts`,
`PersonalSettingsDialog.tsx`, `vitest.config.ts`) plus **3 neue Testdateien**;
**18 geänderte Dateien** (4 shared, 3 Server, 11 Web — davon 4 reine
Ein-Zeilen-/Abbau-Änderungen: `index.ts`, `package.json`, `AutomationDial.tsx`,
`icons.tsx`). Kein Schema-Wechsel (die `settings`-Tabelle nimmt nur zwei weitere
Zeilen auf), keine Datenmigration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist eine **unausgefüllte Vorlage**
(Platzhalter `[PRINCIPLE_1_NAME]` …); es existieren **keine projektspezifischen
Gates**. Angewendet werden daher die allgemeinen spec-kit-Prinzipien, die
Projektregeln aus `CLAUDE.md` und die Nutzerpräferenz „minimale Komplexität".

| Prinzip (allgemein) | Bewertung |
|---|---|
| Minimale Komplexität / YAGNI | **PASS** — Töne als Daten statt 22 Renderfunktionen; Auslöser abgeleitet statt aufgeschrieben; keine neue Tabelle, kein neues Ereignis, keine neue Abhängigkeit zur Laufzeit. |
| Bestehende Muster wiederverwenden | **PASS** — `settings`-Key-Value + `PATCH`-Teilmengen folgen `optimization` (`server.ts:1396`); der Einstellungs-Client folgt dem Modulmuster von `theme.ts`; die Auslöser folgen `PHASE_META`/`AGENT_TRIGGER_META` in `workflowModel.ts`. |
| Testbarkeit / pure Kerne | **PASS** — Katalog, Normalisierung, Auflösung und Phasen-Diff sind pure Funktionen in `@sdd/shared`; die Warteschlange nimmt den Player injiziert. |
| Technikneutralität der Spec gewahrt | **PASS** — die Spec nennt keine Frequenzen, keine API, keinen Speicherort; alles davon wird hier entschieden. |
| Keine zweite Quelle der Wahrheit | **PASS** — ein Ton-Katalog (shared), ein Theme-Modul (C1, erweitert), **eine** Schaltstelle für Töne (FR-011, alter Schalter entfällt). |
| Vorgaben E1–E7 respektiert | **PASS** — E1/E2/E3 unangetastet (CSS-Block, genau ein Design, Skalennamen bleiben), E4 als Schlüsselsatz-Vergleich umgesetzt, E5 als `Record<ThemeId, ConsolePalette>`, E6 als eigener Settings-Eintrag, E7 als konfigurierbar-aber-stumm. |
| Projektregeln (`CLAUDE.md`) | **PASS** — quickstart nennt eigene Ports und portgebundenes Aufräumen; keine generischen Kill-Muster. |

**Ergebnis: PASS** — vor Phase 0 und erneut nach Phase 1 geprüft. Ein einziger
Punkt verdient Erwähnung: `packages/web` erhält einen Test-Runner. Das ist keine
Prinzipienverletzung, sondern die **Voraussetzung** dafür, dass FR-024/FR-025/
FR-028 überhaupt erfüllbar sind (research D11); Complexity Tracking bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/persoenliche-einstellungen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0: Ist-Zustand + Entscheidungen D1–D12
├── data-model.md        # Phase 1: 7 Entitäten, Validierungs- und Normalisierungsregeln
├── quickstart.md        # Phase 1: automatisierte Prüfungen + Szenarien V1–V16
├── contracts/
│   ├── api-contract.md      # Phase 1: HTTP + Ereignisströme (A1–A4)
│   ├── sound-catalog.md     # Phase 1: Katalog-, Normalisierungs-, Auflösungsvertrag (S1–S6)
│   └── ui-contract.md       # Phase 1: Theme, Konsole, Client, Ausgabe, Dialoge (U1–U8)
├── checklists/
│   └── requirements.md  # (bestehend) Spec-Qualitäts-Checkliste
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                    # [ändern] SoundReaction, SoundSettings, TicketSource, PersonalSettings
├── soundCatalog.ts             # [neu]    SOUND_TRIGGERS (20), TONES (22), Defaults, normalize, resolve
├── soundCatalog.test.ts        # [neu]    FR-004/006/007/012/013/016/020, SC-001/003
├── phaseMachine.ts             # [ändern] enteredPhase(prev, next) — Phasen-Diff (S6)
├── phaseMachine.test.ts        # [ändern] Fälle zu enteredPhase
└── index.ts                    # [ändern] Export soundCatalog

packages/server/src/
├── db/repos.ts                 # [ändern] SettingsRepo.getPersonal/setPersonal (normalisiert)
└── api/
    ├── server.ts               # [ändern] `personal` in GET /api/state; PATCH /api/settings/personal
    └── server.test.ts          # [ändern] A2.1–A2.7 inkl. Trennung von jira.lastSelection

packages/web/
├── package.json                # [ändern] "test": "vitest run" + devDependency vitest
├── vitest.config.ts            # [neu]    include src/**/*.test.ts, environment node
├── index.html                  # [ändern] FOUC-Guard akzeptiert drei ThemeId (C2 → U1)
└── src/
    ├── index.css               # [ändern] Block :root[data-theme='high-contrast'] (56 Schlüssel)
    ├── theme.ts                # [ändern] ThemeId, THEMES, cycleTheme (C1 → U1)
    ├── terminalTheme.ts        # [ändern] CONSOLE_PALETTES: Record<ThemeId, ConsolePalette> (C5 → U2)
    ├── themeContract.test.ts   # [neu]    FR-023/024/025/026/028, SC-007
    ├── sound.ts                # [neu]    AudioContext-Interpreter, speechSynthesis, serielle Queue (U4)
    ├── sound.test.ts           # [neu]    FR-017/SC-006 (Queue mit injiziertem Player)
    ├── personalSettings.ts     # [neu]    Client-Modul: prime/patch/subscribe + Migration sdd-sound (U3)
    ├── api.ts                  # [ändern] AppState.personal, savePersonal()
    ├── store.tsx               # [ändern] Ton-Anbindung der drei Ströme; alter Beep + Schalter entfernt (U5)
    └── components/
        ├── PersonalSettingsDialog.tsx  # [neu]    drei Abschnitte, Vorhören, Rückmeldung (U6)
        ├── Sidebar.tsx                 # [ändern] Eintrag in ToolSettings; FeatureSourceGate liest Vorauswahl (U6/U7)
        ├── AutomationDial.tsx          # [ändern] SoundToggle entfernt (FR-011)
        ├── ThemeToggle.tsx             # [ändern] Zyklus über drei Designs (U1.4)
        └── icons.tsx                   # [ändern] Kontrast-Icon (U8)

# Unverändert: packages/desktop, alle übrigen Komponenten (sie kippen über die
# CSS-Variablen des neuen Design-Blocks mit — E1), sämtliche Server-Services,
# der Ereignisbus (events.ts) und das DB-Schema.
```

**Structure Decision**: Dreischichtig entlang der bestehenden Paketgrenzen, mit
einer bewussten Zuordnung von Wissen zu Paketen:

- **`@sdd/shared` trägt alles Prüfbare**: Kataloge, Standardwerte,
  Normalisierung, Auflösung, Phasen-Diff. Dort läuft `vitest` schon, und dort
  liegt bereits das Vokabular, aus dem die Auslöser abgeleitet werden
  (`AttentionKind`, `FEATURE_PHASES`, `PHASE_META`). Server und Client teilen so
  **dieselbe** Normalisierung — kein zweites Regelwerk, keine Zahl 56, keine
  handgeführte Auslöser-Liste.
- **`@sdd/server` bleibt dumm**: zwei Repo-Methoden und eine Route nach dem
  Muster von `optimization`. Keine Kataloge, keine Tonlogik.
- **`@sdd/web` trägt nur Effekte und Darstellung**: den Interpreter der
  Ton-Daten, die Warteschlange, die Dialoge, die drei CSS-/Konsolen-Paletten.
  Der neue Test-Runner prüft genau die Artefakte, die nur hier existieren.

Die Liste geänderter Web-Dateien ist wieder klein, weil das dritte Design nach
E1 über CSS-Variablen wirkt: die restlichen Komponenten färben ohne Zutun mit.
Angefasst werden nur echte JS-Konsumenten des Designs (Konsole), die neuen
Bausteine und die drei Stellen, die heute die verdrahteten Entscheidungen
treffen (`store.tsx:531`, `AutomationDial.tsx:251`, `Sidebar.tsx:314`).

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt bleibt leer.

## Phase 0 — Outline & Research

Abgeschlossen → [research.md](./research.md). Der Ist-Zustand wurde vollständig
am Code belegt (Tabelle „Ist-Zustand"), alle Annahmen der Spec bestätigt; eine
Zählkorrektur: FR-004 fordert „mindestens 20", die genannte Zusammensetzung
ergibt **exakt 20**.

Aufgelöste Entscheidungen: **D1** Zuordnung der zwei überlappenden Ereignisströme ·
**D2** „Phase erreicht" per Diff auf `feature_updated`, kein neues Ereignis ·
**D3** Spezifität: spezifisch gewinnt, sofern nicht Stille · **D4** Töne als
Daten + Fingerprint-Invariante · **D5** serielle Warteschlange mit Fertig-Signal ·
**D6** ein gemeinsamer `AudioContext` · **D7** leerer Ansagetext ⇒
Auslöser-Bezeichnung · **D8** zwei Settings-Einträge, Auslieferung im Boot-Zustand ·
**D9** Migration und Abbau des alten Schalters · **D10** dritter Design-Block +
Zyklus im Umschalter · **D11** `vitest` auch im Web-Paket · **D12**
`speechSynthesis` mit asymmetrischer Fehlermeldung.

Es blieben **keine** NEEDS-CLARIFICATION-Punkte offen: die Spec ist geklärt
(`/speckit-clarify` ist in `spec.md` als „Entscheidungen und Randbedingungen"
E1–E7 dokumentiert), und die verbleibenden Umsetzungsfragen sind oben entschieden.

## Phase 1 — Design & Contracts

Abgeschlossen. Artefakte:

- [data-model.md](./data-model.md) — sieben Entitäten (Auslöser, Ton, Reaktion,
  Ton-Zuordnung, Farbdesign inkl. Konsolen-Palette, Vorauswahl Ticket-Quelle,
  Übertragungsform) mit Schlüsselräumen, Standardwerten, Validierungs- und
  Normalisierungsregeln sowie den zwei Zustandsübergängen.
- [contracts/sound-catalog.md](./contracts/sound-catalog.md) — S1–S6: Auslöser-
  und Ton-Katalog samt Bezeichnungen, Standardbelegung, Normalisierungstabelle,
  Auflösung, Phasen-Diff.
- [contracts/api-contract.md](./contracts/api-contract.md) — A1–A4: erweitertes
  `GET /api/state`, neues `PATCH /api/settings/personal`, die verbindliche
  Lesart der unveränderten Ereignisströme, serverseitige Normalisierung.
- [contracts/ui-contract.md](./contracts/ui-contract.md) — U1–U8: Erweiterung der
  bestehenden Theme-Verträge C1/C2/C5, Einstellungs-Client, Ton-Ausgabe,
  Store-Anbindung, Dialog, „Neues Feature"-Fluss, Icons.
- [quickstart.md](./quickstart.md) — automatisierte Prüfungen je FR/SC plus
  Szenarien V1–V16 mit vollständiger Abdeckungsübersicht SC-001 … SC-012,
  inklusive der von SC-007 geforderten **Gegenprobe** (Prüfung muss fehlschlagen)
  und der projektkonformen Start-/Aufräumbefehle auf eigenen Ports.

**Constitution Re-Check nach Phase 1**: unverändert **PASS**. Das Design hat
keine Entität, keine Route und keine Abhängigkeit hinzugefügt, die über die
Anforderungen hinausgeht; die einzige Infrastrukturzugabe (`vitest` im
Web-Paket) ist durch FR-024/FR-025/FR-028 erzwungen.

## Umsetzungsreihenfolge (Hinweis für `/speckit-tasks`)

Die Prioritäten der Spec (US1 > US2 > US3) sind umsetzbar, weil die drei Themen
sich nur den Dialograhmen teilen. Empfohlene Schnitte:

1. **Fundament** — `@sdd/shared`: Typen, Katalog, Normalisierung, Auflösung,
   `enteredPhase` + Tests. Liefert allein noch keinen Nutzen, ist aber
   Voraussetzung für 2 und 4.
2. **Ablage** — Server: `getPersonal`/`setPersonal`, `personal` im Boot-Zustand,
   `PATCH`-Route + Tests.
3. **US2 (Darstellung)** — bewusst **vor** der Ton-Oberfläche: unabhängig,
   klein, und die drei geforderten automatisierten Prüfungen etablieren den
   Web-Test-Runner, den US1 danach mitbenutzt.
4. **US1 (Signaltöne)** — `sound.ts` + Warteschlange, `personalSettings.ts`
   inkl. Migration, Store-Anbindung, Dialog-Abschnitt „Signaltöne", Abbau des
   alten Schalters.
5. **US3 (Vorauswahl)** — Dialog-Abschnitt + `FeatureSourceGate`.

Der Abbau des alten Schalters (FR-011) gehört **in denselben Schnitt** wie der
neue Hauptschalter — dazwischen gäbe es zwei widersprüchliche Schaltstellen.
