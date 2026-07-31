# UI-Contract: Worktree-Übersicht

Vertragsfläche der Oberfläche — Einstiegspunkt, Zustände, Darstellungszusagen und Aktionen.
Ergänzt [http-api.md](./http-api.md). Sprache: Deutsch; Symbole als **SVG-Icons** aus
`components/icons.tsx` (Projekt-Konvention), keine Emojis.

---

## C1 — Einstiegspunkt (FR-001, SC-001)

| Schritt | Ort | Verhalten |
|---|---|---|
| 1 | Sidebar unten links → **„Einstellungen"** | Öffnet den bestehenden `ToolSettings`-Dialog |
| 2 | Dialogeintrag **„Worktree-Übersicht"** (neu, unter „Jira-Verbindung") | Schließt den Dialog, `dispatch({ type: 'set_view', view: { kind: 'worktrees' } })` |

Genau **zwei** Interaktionen bis zur Zuordnung Feature↔Worktree (SC-001). Die View ist
tool-weit (projektübergreifend) und erscheint deshalb **nicht** als Tab in der Kopfleiste;
sie ersetzt den Hauptbereich wie `review`/`workflow`/`agents`.

Untertitel im Dialogeintrag: „Offene Worktrees aller Projekte, geänderte Dateien, Aufräumen".

---

## C2 — Aufbau der Ansicht

```text
Worktree-Übersicht                       Stand 14:03:22   [↻ Aktualisieren]

┌ sdd-toolkit · main · 2 Worktrees ─────────────────────────────────────────┐
│ ▣ Haupt-Checkout   main            /Users/…/sdd-toolkit      2 uncommittet│
│ ▸ worktree-uebersicht   feature/worktree-uebersicht   Umsetzen läuft      │
│     3 Dateien · 1 uncommittet     [Überschneidung] [Session aktiv]        │
│ ▸ alt-feature           feature/alt-feature           Abgeschlossen       │
│     0 Dateien · keine Änderungen  [bereits integriert]        [Entfernen] │
└───────────────────────────────────────────────────────────────────────────┘

┌ anderes-projekt ──────────────────────────────────────────────────────────┐
│ Projekt nicht erreichbar: /pfad/weg — kein Git-Repository                  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Zusagen**

| # | Zusage | Anforderung |
|---|---|---|
| C2.1 | Ein Block je Projekt mit Name, Branch des Haupt-Checkouts und Anzahl offener Worktrees | FR-002, FR-004 |
| C2.2 | Der Haupt-Checkout steht als **erster**, optisch abgesetzter Eintrag im Block und trägt nie eine Entfernen-Aktion | FR-003, FR-026 |
| C2.3 | Jeder Worktree-Eintrag zeigt eingeklappt: Label, Branch, Bearbeitungsstand, Anzahl geänderter Dateien | FR-005, FR-006, FR-007, FR-014 |
| C2.4 | Verwaiste Einträge tragen sichtbar „ohne Feature-Zuordnung", Chat-Worktrees „Wissens-Chat" | FR-008 |
| C2.5 | `dirState: missing` zeigt „Worktree-Verzeichnis fehlt", `registry_only` zeigt „nur in der Git-Verwaltung geführt" — beide ohne Entfernen-Aktion | FR-009, Edge Cases |
| C2.6 | Projekte mit `error` zeigen die Meldung im Block; alle anderen Blöcke bleiben bedienbar | FR-032 |
| C2.7 | Klick auf einen zugeordneten Eintrag springt in die Feature-Konsole (`select_project` + `set_view console`) | FR-010 |
| C2.8 | Projekt ohne offene Worktrees zeigt „Keine offenen Worktrees" statt leerer Fläche | US1-AS6 |

---

## C3 — Dateiliste (aufklappbar)

| # | Zusage | Anforderung |
|---|---|---|
| C3.1 | Aufklappen zeigt je Datei: Pfad, Änderungsart, Commit-Zustand | FR-011, FR-012, FR-013 |
| C3.2 | Änderungsart als Kürzel + Tooltip: `+` neu, `~` geändert, `−` gelöscht, `→` umbenannt (bei umbenannt zusätzlich `oldPath`) | FR-012 |
| C3.3 | Commit-Zustand sichtbar: „committet" / „uncommittet" / „committet + geändert" (`both`) | FR-013 |
| C3.4 | `changedFileCount === 0` ⇒ ausdrücklich „Keine Änderungen gegenüber `<targetBranch>`" | FR-015 |
| C3.5 | Liste scrollt in fester Höhe (`max-h`); bei `filesTruncated` steht „… zeigt 300 von N Dateien" | FR-016 |
| C3.6 | Dateien mit `overlapping` bzw. `behindTarget` sind in der Liste markiert | FR-017, FR-018 |
| C3.7 | Der Aufklappzustand überlebt eine Aktualisierung (Schlüssel: `entry.id`) | FR-029/031 |

---

## C4 — Warnungen

| Art | Darstellung | Text |
|---|---|---|
| `already_merged` | Badge, Tonalität „aufräumbar" | „bereits integriert — Worktree kann entfernt werden" |
| `overlap` | Badge + Detailzeile | „Überschneidung mit *`<Feature A>`*, *`<Feature B>`*: `<n>` Datei(en)" |
| `behind_target` | Badge + Detailzeile | „gegenüber `<targetBranch>` veraltet: `<n>` Datei(en) dort ebenfalls geändert" |

| # | Zusage | Anforderung |
|---|---|---|
| C4.1 | Kein Badge, wenn `warnings` leer ist — keine Platzhalter, keine Fehlalarme | FR-020 |
| C4.2 | Mehrere Warnungen erscheinen gleichzeitig und optisch unterscheidbar | FR-021 |
| C4.3 | Jede Warnung nennt die betroffenen Dateien (aufklappbar bei `fileCount > files.length`) und bei `overlap` die anderen Features | FR-017, FR-018 |

---

## C5 — Entfernen (zweistufig)

| # | Zusage | Anforderung |
|---|---|---|
| C5.1 | Aktion nur bei `removable === true` sichtbar; bei `sessionActive` erscheint stattdessen der deaktivierte Hinweis „Session aktiv — Entfernen gesperrt" | FR-025, US4-AS4 |
| C5.2 | Erste Bestätigung nennt Feature/Label, Branch, Pfad und Anzahl betroffener Änderungen | FR-023 |
| C5.3 | Antwortet der Server mit `409 uncommitted`, erscheint eine **zweite**, deutlich formulierte Bestätigung mit der Anzahl uncommitteter Dateien; erst sie sendet `force: true` | FR-024, SC-009 |
| C5.4 | Fehler (`409 session_active`, `500 remove_failed`) erscheinen als Klartextmeldung; die Liste wird neu geladen und bleibt konsistent | FR-027, US4-AS5 |
| C5.5 | Nach Erfolg verschwindet der Eintrag beim unmittelbar folgenden Refetch | US4-AS1 |
| C5.6 | Der Haupt-Checkout bietet nie eine Entfernen-Aktion an | FR-026 |

Wiederverwendet wird der bestehende `ConfirmDialog` aus `components/Sidebar.tsx`.

---

## C6 — Aktualität und Zustände

| Zustand | Darstellung | Anforderung |
|---|---|---|
| Erstes Laden | „Lade Worktree-Übersicht …", keine Platzhalterdaten | FR-031 |
| Nachladen (Polling/Refresh) | Bestehende Liste bleibt sichtbar, Kopfzeile zeigt „wird aktualisiert …" statt eines frischen „Stand" | FR-031 |
| Geladen | „Stand `HH:MM:SS`" aus `collectedAt` | FR-028 |
| Leer (keine Projekte) | „Noch keine Projekte konfiguriert." | US1-AS6 |
| Fehler beim Abruf | Fehlerzeile mit Wiederholen-Möglichkeit; letzte Daten werden nicht als aktuell ausgegeben | FR-031 |

| # | Zusage | Anforderung |
|---|---|---|
| C6.1 | Automatische Aktualisierung alle **5 s**, solange die View sichtbar ist (Intervall beim Verlassen abgeräumt) | FR-029, SC-004 |
| C6.2 | Zusätzlicher Refetch, sobald sich die Feature-Signatur im Store ändert (WS `feature_updated`/`feature_deleted`) | FR-029 |
| C6.3 | „↻ Aktualisieren" lädt mit `?refresh=1` und macht den Ladefortschritt sichtbar | FR-030, US5-AS3 |

---

## C7 — Nicht Bestandteil der Oberfläche

- Datei-Inhalte, Diffs, Editieren (bleibt im Review-Portal)
- Branch löschen, Reparieren, Prunen, Worktree neu anlegen
- Vollständiger Dateibaum einer Arbeitskopie (nur **geänderte** Dateien, Assumption der Spezifikation)
- Mehrfachauswahl / Sammel-Aufräumen (nur einzelne Worktrees, FR-022)
