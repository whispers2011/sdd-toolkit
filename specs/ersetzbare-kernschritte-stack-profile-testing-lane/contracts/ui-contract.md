# Vertrag: Oberfläche

Deutsche Beschriftungen, dunkles Layout, **Symbole ausschließlich als SVG-Icons** aus
`components/icons.tsx` (Konvention `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`). Kein
Rohbezeichner einer Stufe oder eines Profils in einer Zeile — alle Texte kommen aus den geteilten
Katalogen (`INTEGRATION_STAGE_META`, `STACK_PROFILE_META`, `AUTOMATION_META`, `ACTION_REASON`).

Jede Aktion rendert das Ergebnis von `actionPolicy.evaluateAction()`: `available` → Schaltfläche,
`blocked` → Schaltfläche gesperrt **mit sichtbarem Grund**, `hidden` → nicht gezeigt. Keine eigene
Bedingung in einer Komponente.

---

## 1. Einstiegspunkte

| Ort | Neu |
|---|---|
| Sidebar | Eintrag **„Testing-Lane"** (FlaskIcon) mit Zähler der Features auf `awaiting_manual_test`; öffnet `View { kind: 'testing' }` |
| Projekt-Einstellungen | Abschnitt **„Stack-Profile"** (Profilkommandos + Dienstliste) |
| Automation-Dial | Schalter **„Manuelles Test-Gate"** |
| Feature-Konsole | Feld **„Stack"** (Profil, Dienste, URL, vier Aktionen) über `StackPanel` |
| Worktree-Übersicht | Spalte **Größe** je Eintrag, Kopfzeile mit Plattenwarnung |
| Board / Review-Übersicht | die neue Stufe als Text aus dem Katalog (Ton `human`, amber) |
| Inbox | vier neue Meldungsarten mit Sprung ins passende Ziel |

---

## 2. Testing-Lane — `TestingLane.tsx`

Aufbau je Eintrag (die **fünf Pflichtangaben** in einer Ansicht, SC-009):

```text
┌────────────────────────────────────────────────────────────────────────┐
│ mein-feature                              wartet auf manuelle Abnahme  │
│ Branch  feature/mein-feature                                           │
│ Ordner  /Users/…/worktrees/projekt-x/mein-feature        [kopieren]    │
│ Angelegt 30.07.2026 14:12                                              │
│ Adresse  http://localhost:21040  ↗                        Stand 3 s    │
│                                                                        │
│ Dienste     web  21040  ● läuft      api  21041  ● läuft               │
│             db   21042  ● läuft      mail 21060  ○ aus  (geteilt)      │
│                                                                        │
│ [Starten] [Stoppen] [Neustarten] [Abbauen]                             │
│ [Abnahme bestätigen]  [Ablehnen …]                                     │
└────────────────────────────────────────────────────────────────────────┘
```

**Zwei Abschnitte**: „Wartet auf Abnahme" (Stufe `awaiting_manual_test`) und darunter „Läuft
gerade" (Features mit betriebenem Stack, die nicht auf der Stufe stehen — damit sichtbar bleibt,
was Ports belegt). Leerzustände: „Nichts wartet auf eine Abnahme." / „Kein Stack läuft."

**Adresse**

| Zustand | Anzeige |
|---|---|
| Haupteingang antwortet | anklickbarer Link `http://localhost:<port>`, öffnet in neuem Tab |
| Haupteingang antwortet nicht | „**nicht erreichbar** — Stack starten?" (kein Link, FR-033) |
| kein Stack konfiguriert | „**Kein Stack konfiguriert** — Profile in den Projekt-Einstellungen hinterlegen." (kein Link, FR-013/FR-033) |

Die URL kommt ausschließlich aus `FeatureStackView.url` (serverseitig aus Portblock + Haupteingang
gebildet) — die Oberfläche rechnet keine Ports (FR-031, SC-002).

**Dienstliste**: je Dienst Name, Port, Status als Punkt (`● läuft` emerald / `○ aus` zinc /
`◌ unbekannt` amber), Kennzeichnung `geteilt` und `Daten` (zustandsbehaftet). Der Stand der Erhebung
wird ausgewiesen; ein Aktualisieren-Knopf erzwingt `refresh=1`.

**Vier Stack-Aktionen** — jeweils nur auf diesen Stack wirksam:

| Schaltfläche | Aktion | gesperrt, wenn |
|---|---|---|
| Starten | `up` (Profil `full`) | kein Stack konfiguriert · kein Arbeitsverzeichnis · Session arbeitet |
| Stoppen | `stop` | zusätzlich: kein Kommando zum Anhalten hinterlegt |
| Neustarten | `restart` | wie Starten; ohne Anhalte-Kommando erscheint vorher eine Rückfrage: „Neustart entfernt die Datenablagen. Fortfahren?" |
| Abbauen | `down` | wie Starten; Rückfrage: „Dienste und Datenablagen dieses Features entfernen?" |

Läuft eine Aktion, zeigt die Karte einen Fortschrittszustand; der Fehlschlag erscheint als Hinweis
**mit dem Ausgabe-Ausschnitt** direkt an der Karte (und zusätzlich in der Inbox).

**Abnahme**

- **Abnahme bestätigen** → Rückfrage mit dem nächsten Schritt im Text („Danach geht das Feature in
  das menschliche Review." bzw. „… in die Merge-Queue."), dann
  `POST …/manual-test/confirm`.
- **Ablehnen …** → Dialog mit **Pflicht**-Textfeld „Was ist nicht in Ordnung?"; ohne Text bleibt die
  Schaltfläche gesperrt. Nach dem Absenden verschwindet der Eintrag aus der Lane, das Feature steht
  wieder in der Umsetzung, und der Grund ist als Prompt in der Feature-Konsole angekommen.
- Eine frühere Ablehnung wird am Eintrag angezeigt („zuletzt abgelehnt am … — <Grund>").

---

## 3. Stack-Feld in der Feature-Konsole — `StackPanel.tsx`

Dieselbe Dienstliste und dieselben vier Aktionen wie in der Lane, kompakt, plus das betriebene
Profil („Profil: `test`" / „Profil: `full`" / „kein Stack betrieben"). Wiederverwendete Komponente —
es entsteht keine zweite Darstellung des Zustands. Sichtbar ab Beginn von `implement`, davor
eingeklappt.

---

## 4. Stack-Profile konfigurieren — `ProjectSettings.tsx`

Abschnitt „Stack-Profile" mit drei Blöcken (`test`, `full`, `down`), je Block:

- **Kommando** (feature-eigen, mehrzeiliges Feld)
- **Kommando für geteilte Dienste** (optional, mit Hinweis „läuft projektweit genau einmal")
- **Zeitlimit** (Minuten, leer = 15)

Darunter **Kommando zum Anhalten** (optional, mit Hinweis „behält die Datenablagen; ohne dieses
Kommando entfernt ein Neustart die Daten") und die **Dienstliste** als Tabelle: Name, Abstand,
Betriebsart (feature-eigen/geteilt), zustandsbehaftet, Haupteingang. Zeilen hinzufügen/entfernen.

Neben jedem Abstand steht der resultierende Beispielport für den aktuell größten belegten Block
(„z. B. 21040 + 1 = 21041"), damit die Ableitung sichtbar ist. Validierungsfehler erscheinen am
Feld mit demselben Satz, den der Server sendet.

Kopfzeile des Abschnitts bei leerer Konfiguration: „Kein Stack konfiguriert. Das Toolkit bringt
bewusst keine Kommandos mit — hinterlege die drei Profile deines Projekts." (FR-012/FR-013)

---

## 5. Automation-Dial — Schalter „Manuelles Test-Gate"

Reiht sich in die bestehende Liste der Einzelschalter ein (keine eigene Bedienung, FR-025):

| Zustand | Beschriftung |
|---|---|
| an | „hält vor dem Review zur Abnahme an" |
| aus | „ohne Halt zur Abnahme" |

Hilfetext aus `AUTOMATION_META.manualTestGate`: „Nach dem Review-Gate hält das Feature an, damit ein
Mensch die laufende Anwendung durchklickt — vor dem menschlichen Review." Die Voreinstellung
wechselt mit den Stufen-Knöpfen mit (Stufe 2 an, Stufe 3 aus — FR-026).

---

## 6. Worktree-Übersicht — Größe und Plattenwarnung

- Je Eintrag eine Spalte **Größe** (`1,4 GB`), bei nicht ermittelbarer Größe **„unbekannt"** in
  gedämpfter Farbe; alle übrigen Angaben bleiben sichtbar (FR-044).
- Je Eintrag der zugewiesene **Portbereich** (`21040–21059`), leer wenn keiner vergeben ist.
- Unterschreitet der freie Platz die Schwelle, steht **über** den Projektblöcken eine Warnung
  (amber, WarnIcon): „**Nur noch 813 MB frei** (Warnschwelle 10 GB). Größte Worktrees:
  `mein-feature` 10,2 GB · `anderes-feature` 3,1 GB · `chat-x9` 0,9 GB." (FR-043)
- Verwaiste Einträge behalten ihre bestehende Kennzeichnung **und** erscheinen zusätzlich in der
  Inbox (FR-039) — die Übersicht verlinkt dorthin.

---

## 7. Board und Review-Übersicht

- **Board**: die Stufe erscheint auf der Kachel als „wartet auf manuelle Abnahme" im Ton `human`
  (amber) — aus `INTEGRATION_STAGE_META`, kein Rohbezeichner. Auf der Kachel liegt eine
  Schaltfläche **„Testing-Lane öffnen"**; die Entscheidung selbst fällt nur in der Lane, damit es
  einen Ort gibt, an dem die Anwendung wirklich geprüft wird.
- **Review-Übersicht**: Features auf `awaiting_manual_test` erscheinen in einem eigenen Abschnitt
  „Wartet auf manuelle Abnahme" **über** „Bereit zum Review" (Reihenfolge des Ablaufs), mit dem
  Verweis in die Lane statt Freigabe-/Ablehnen-Knöpfen.

---

## 8. Inbox

| Art | Nachricht | Sprung |
|---|---|---|
| `manual_test_due` | „`<feature>`: wartet auf manuelle Abnahme — Adresse `http://localhost:21040`" | Testing-Lane |
| `stack_failed` | „`<feature>`: Stack-Profil `full` fehlgeschlagen (exit 1) — Kommando … + letzte Ausgabe" | Testing-Lane (bzw. Läufe-Ansicht über den Lauf) |
| `worktree_cleanup_failed` | „`<feature>`: Worktree konnte nach dem Merge nicht entfernt werden — `<Grund>`. Ordner bleibt: `<pfad>`" | Worktree-Übersicht, mit „Aufräumen erneut anstoßen" |
| `orphan_worktree` | „Verwaister Worktree ohne Feature: `<pfad>` (1,4 GB)" | Worktree-Übersicht |

Alle nutzen die bestehende Inbox, ihre bestehende Sortierung und ihr bestehendes Erledigen — es
entsteht keine eigene Oberfläche (Abhängigkeit der Spec).

---

## 9. Zustände (Zusammenfassung)

| Zustand | Anzeige |
|---|---|
| Kein Projekt gewählt | „Kein Projekt ausgewählt." |
| Lane leer | „Nichts wartet auf eine Abnahme." |
| Stack nicht konfiguriert | Satz statt URL und gesperrte Aktionen mit Grund |
| Stack konfiguriert, nichts läuft | Dienste `○ aus`, Aktion „Starten" verfügbar |
| Stack läuft, Haupteingang antwortet nicht | „nicht erreichbar", Aktion „Neustarten" hervorgehoben |
| Aktion läuft | Karte im Fortschrittszustand, Aktionen gesperrt („Es wird gerade gearbeitet …") |
| Aktion fehlgeschlagen | Hinweis mit Exit-Code und Ausgabe-Ausschnitt an der Karte |
| Größe nicht ermittelbar | „unbekannt" |
| Freier Platz unter der Schwelle | Warnung über den Projektblöcken |
