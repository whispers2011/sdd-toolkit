# Quickstart / Validierung: Individuelle Einstellungen

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Ausführbare Nachweise für die Success Criteria SC-001 … SC-012. Details zu
Typen und Zusicherungen stehen in [data-model.md](./data-model.md) und
[contracts/](./contracts/) — hier steht nur, **was man tut und was man erwartet**.

---

## Voraussetzungen

- Node ≥ 22, pnpm 10 (`packageManager` der Wurzel)
- `pnpm install` an der Wurzel gelaufen
- Kopfhörer oder Lautsprecher — die Hälfte der Kriterien ist hörbar
- Ein Browser, der `speechSynthesis` unterstützt (Chrome/Safari; unter Linux ggf.
  ohne installierte Stimme → dann ist V4b der erwartete Nachweis)

### Eigene Instanz auf eigenen Ports (verbindlich)

Die laufende Toolkit-Instanz belegt 4820/4830. Für die Validierung eine **eigene**
Instanz mit eigenem Datenverzeichnis starten, damit die produktive Datenbank
unberührt bleibt:

```sh
# im Worktree dieses Features
SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR="$HOME/.sdd-toolkit-test-persoenlich" \
  pnpm dev
# → Web auf http://localhost:4898
```

Aufräumen ausschliesslich über die eigenen Ports — **niemals** `pkill -f vite`
oder `pkill -f tsx` (die eigene Session ist ein Kindprozess des laufenden
Toolkits, siehe `CLAUDE.md`):

```sh
lsof -ti:4899 | xargs kill
lsof -ti:4898 | xargs kill
```

Eine „frische Installation" (V1, V3) entsteht durch ein leeres
`SDD_DATA_DIR` **und** einen geleerten `localStorage` des Browserprofils für
`localhost:4898`.

---

## Automatisierte Prüfungen

```sh
pnpm -r typecheck                     # Verträge sind getypt (u. a. Record<ThemeId, ConsolePalette>)
pnpm --filter @sdd/shared test        # Kataloge, Normalisierung, Auflösung, Phasen-Diff
pnpm --filter @sdd/web test           # CSS-Schlüsselsätze, Konsolen-Paletten, FOUC-Guard, Warteschlange
pnpm --filter @sdd/server test        # Routen, Ablage, Trennung von jira.lastSelection
pnpm test                             # alles (pnpm -r test)
```

| Prüfung | Deckt ab | Erwartetes Ergebnis |
|---|---|---|
| `soundCatalog.test.ts` — 20 Auslöser, ≥ 20 Töne, eindeutige Fingerprints/Labels | SC-001, FR-004, FR-006, FR-007 | grün |
| `soundCatalog.test.ts` — Standardbelegung genau zwei Einträge | SC-003, FR-012, FR-013 | grün |
| `soundCatalog.test.ts` — Normalisierung verwirft Unbekanntes, ist idempotent | FR-003, FR-020 | grün |
| `soundCatalog.test.ts` — Auflösung: spezifische Phase gewinnt, Hauptschalter aus ⇒ nichts | FR-010, FR-016 | grün |
| `phaseMachine.test.ts` — `enteredPhase` | FR-016 | grün |
| `themeContract.test.ts` — Schlüsselsatz-Parität der Design-Blöcke | **SC-007**, FR-023, FR-024 | grün; bei entferntem Schlüssel **rot mit Design + Schlüsselname** |
| `themeContract.test.ts` — jede `ThemeId` hat vollständige Konsolen-Palette | FR-025 | grün |
| `themeContract.test.ts` — keine Farbe gleicht dem `background` | FR-028 | grün |
| `themeContract.test.ts` — FOUC-Guard akzeptiert genau die drei `ThemeId` | FR-026 | grün |
| `sound.test.ts` — Warteschlange startet nie vor dem Fertig-Signal | **SC-006**, FR-017 | grün |
| `server.test.ts` — `PATCH /api/settings/personal`, Teilmengen-Semantik, Klemmung | FR-002, FR-003 | grün |
| `server.test.ts` — `ticketSource` und `jira.lastSelection` beeinflussen sich nicht | **SC-011**, FR-032 | grün |

**Gegenprobe zu SC-007 (verlangt, dass die Prüfung *fehlschlägt*)**: eine Zeile im
`high-contrast`-Block auskommentieren, `pnpm --filter @sdd/web test` laufen
lassen — die Meldung muss `high-contrast` und den fehlenden Schlüssel nennen.
Danach zurücknehmen.

---

## Manuelle Szenarien

### V1 — Frische Installation klingt genau wie heute (SC-003, FR-012, FR-013)

1. Leeres `SDD_DATA_DIR`, `localStorage` geleert, Web öffnen.
2. „Einstellungen → Individuelle Einstellungen → Signaltöne" öffnen.
3. **Erwartet**: Hauptschalter *an*; `Agent-Zug fertig` und `Feature gemergt`
   stehen auf dem Ton „Zwei-Ton aufwärts"; die **übrigen 18** Auslöser stehen auf
   „Stille". `Eingabe erwartet` und `Berechtigung erfragt` zeigen die Begründung
   der bisherigen Stille (FR-014).
4. Eine Phase laufen lassen, bis sie fertig ist. **Erwartet**: derselbe
   Zwei-Ton-Beep wie vor dem Feature, in derselben Lautstärke.

### V2 — Zuordnen, vorhören, hörbar unterscheiden (SC-001, SC-002, US1/2, US1/3)

1. `Review fällig` → Ton „Sanftes Glöckchen" wählen, **Vorhören** drücken.
   **Erwartet**: innerhalb einer Sekunde hörbar, **ohne** zu speichern.
2. `Lauf abgebrochen` → Ton „Fehler-Abstieg", vorhören.
3. Übernehmen, Dialog schliessen, beide Ereignisse auslösen (Review anfordern;
   einen Lauf abbrechen). **Erwartet**: zwei deutlich unterschiedliche Töne.

### V3 — Rückfragen bleiben stumm, sind aber umkehrbar (SC-004, US1/6, FR-014)

1. Frische Installation: eine Agenten-Rückfrage auslösen.
   **Erwartet**: sichtbare Meldung im Aufmerksamkeits-Eingang, **kein** Ton.
2. `Eingabe erwartet` auf einen Ton stellen (Stoppuhr: unter einer Minute
   Bedienzeit) und erneut auslösen. **Erwartet**: Ton erklingt.

### V4 — Gesprochene Ansage (US1/4, FR-009, FR-019, research D7)

1. `Freigabe nötig` → „Ansage", Text `Freigabe für Zahlungsmodul`, vorhören.
   **Erwartet**: der Satz wird gesprochen.
2. Ereignis auslösen. **Erwartet**: derselbe Satz.
3. **V4b (Ansagetext leer)**: Text löschen, vorhören. **Erwartet**: es wird
   „Freigabe nötig" gesprochen — nichts Undefiniertes, keine Stille.
4. **V4c (Sprachausgabe fehlt)**: in einem Browser ohne Stimme vorhören.
   **Erwartet**: sichtbare Rückmeldung am Auslöser; **keine** stille
   Fehlfunktion, die erst im Ereignisfall auffällt.

### V5 — Geräteübergreifend (SC-005, FR-002)

1. In Browser A eine Zuordnung setzen.
2. Dieselbe Adresse in Browser B (oder in einem anderen Profil) öffnen und den
   Einstellungsbereich ansehen. **Erwartet**: identische Zuordnung, ohne dort
   etwas eingestellt zu haben; das Ereignis klingt dort gleich.

### V6 — Hauptschalter (US1/8, FR-010, FR-011)

1. Hauptschalter aus, ein belegtes Ereignis auslösen. **Erwartet**: still, die
   sichtbare Benachrichtigung erscheint unverändert.
2. Hauptschalter wieder an. **Erwartet**: alle Zuordnungen unverändert vorhanden.
3. Im Automation-Dial nachsehen. **Erwartet**: der alte Schalter „Sound wenn ein
   Agent fertig ist" existiert **nicht mehr**.

### V7 — Übernahme des alten Schalters (FR-015)

1. Bei leerem `SDD_DATA_DIR` vor dem ersten Laden im Browser setzen:
   `localStorage.setItem('sdd-sound','off')`.
2. Web laden, Einstellungen öffnen. **Erwartet**: Hauptschalter startet **aus**.
   Wer stumm war, bekommt durch die Umstellung keine Töne.

### V8 — Zehn Ereignisse in Folge (SC-006, FR-017)

1. Zehn Ereignisse dicht hintereinander erzeugen (z. B. zehn belegte Auslöser
   über die Konsole des Servers auslösen oder mehrere Features gleichzeitig
   abschliessen lassen).
2. **Erwartet**: zehn nacheinander hörbare, einzeln unterscheidbare Ausgaben —
   kein Gemisch, kein Ausfall, keine Ausgabe beginnt vor dem Ende der vorherigen.

### V9 — Überlappende Phasen-Auslöser (FR-016, research D3)

1. `Phasenwechsel (allgemein)` → „Ping"; `Phase erreicht: implement` → „Fanfare".
2. Feature nach `implement` bringen. **Erwartet**: **nur** „Fanfare".
3. Feature nach `plan` bringen (dort steht Stille). **Erwartet**: „Ping" — der
   allgemeine Auslöser greift, wenn der spezifische auf Stille steht.

### V10 — Drittes Design vollständig (SC-008, US2/1, US2/2, FR-021, FR-022)

1. Eine Agenten-Konsole öffnen (Terminal mit Ausgabe, sichtbarer Scrollback).
2. „Darstellung → Dunkel, hoher Kontrast" wählen.
3. **Erwartet**: die gesamte Oberfläche wechselt in unter einer Sekunde und ohne
   Neuladen; **die Konsole färbt mit um**; Scrollback, Fokus und Sitzung bleiben;
   keine Fläche, kein Statuspunkt, kein Badge bleibt im vorherigen Schema.
4. Durchsehen: Board, Kanban, Grid, Review-Portal, Diff-Ansicht, Chat,
   Wissens-Panel, Läufe/Token-Dashboard, Dialoge. **Erwartet**: überall lesbar,
   nichts gleichfarbig auf gleichfarbig.

### V11 — Kein Umfärben nach dem Laden (SC-009, FR-026)

1. `high-contrast` gewählt lassen, Seite neu laden (auch hart, `Cmd+Shift+R`).
2. **Erwartet**: das Design ist von der ersten Darstellung an aktiv — kein
   sichtbares Umschlagen. Kopfzeilen-Umschalter mehrfach drücken:
   dark → light → high-contrast → dark, Icon zeigt jeweils das aktive Design.

### V12 — Unbekanntes Design (US2/5, FR-027)

1. `localStorage.setItem('sdd-theme','solarized')`, neu laden.
2. **Erwartet**: ein gültiges Design ist aktiv, die Oberfläche ist vollständig
   bedienbar, keine Fehlermeldung.

### V13 — Vorauswahl Ticket-Quelle (SC-010, SC-012, US3/1–3)

1. Jira verbinden. Vorauswahl auf „Manuell erfassen" stellen.
2. „Neues Feature" öffnen. **Erwartet**: manuelle Erfassung; der Umschalter „Aus
   Jira importieren" ist vorhanden und funktioniert.
3. Vorauswahl auf „Aus Jira importieren" stellen, erneut öffnen.
   **Erwartet**: Jira-Auswahl; Umschalter zu „Manuell erfassen" vorhanden.
4. Jira-Verbindung trennen, Vorauswahl auf „Aus Jira importieren" belassen,
   öffnen. **Erwartet**: manuelle Erfassung; nach erneutem Verbinden steht die
   Vorauswahl **unverändert** auf „Aus Jira importieren".

### V14 — Die beiden Jira-Einstellungen sind unabhängig (SC-011, US3/4, FR-032)

1. Im Jira-Import-Dialog ein bestimmtes Projekt/Board wählen und den Dialog
   schliessen.
2. Vorauswahl der Ticket-Quelle zweimal umstellen.
3. Import-Dialog wieder öffnen. **Erwartet**: dieselbe Jira-Auswahl wie in
   Schritt 1 — unverändert.

### V15 — Einstellungen nicht lesbar (FR-003, Edge Case)

1. Instanz stoppen, in der Test-Datenbank `settings.value` des Eintrags `sound`
   auf `{kaputt` setzen, Instanz starten.
2. **Erwartet**: die Oberfläche startet mit Standardwerten und ist bedienbar; kein
   500er; nichts wird stillschweigend überschrieben, bis die Person selbst
   speichert.

### V16 — Audio-Sperre vor der ersten Interaktion (FR-018, Edge Case)

1. Seite laden und **nicht** anklicken; ein belegtes Ereignis auslösen.
2. **Erwartet**: die sichtbare Benachrichtigung erscheint, der Ton entfällt still
   — keine Fehlermeldung, keine rote Konsolenausgabe.

---

## Abdeckungsübersicht

| Kriterium | Nachweis |
|---|---|
| SC-001 | `soundCatalog.test.ts`, V2 |
| SC-002 | V2 (Vorhören), V4 |
| SC-003 | `soundCatalog.test.ts`, V1 |
| SC-004 | V3 |
| SC-005 | V5 |
| SC-006 | `sound.test.ts`, V8 |
| SC-007 | `themeContract.test.ts` + Gegenprobe |
| SC-008 | V10 |
| SC-009 | V11 |
| SC-010 | V13 |
| SC-011 | `server.test.ts`, V14 |
| SC-012 | V13/2–3 (beide Wege bleiben erreichbar) |
