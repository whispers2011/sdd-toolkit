# Vertrag: Auslöser-Katalog & Kommando-Umgebung

Dies ist der **nach außen wirksame Vertrag** dieses Features: Personen hinterlegen Kommandos,
die sich auf ihn verlassen. Änderungen daran sind Vertragsänderungen.

---

## 1. Auslöser-Katalog

| ID | Titel (UI) | Feuert | Arbeitsverzeichnis | Bezug |
|---|---|---|---|---|
| `before_worktree_create` | Vor Worktree-Anlage | bevor `git worktree add` läuft | **Haupt-Checkout** des Projekts | — |
| `after_worktree_create` | Nach Worktree-Anlage | nachdem der Worktree existiert, **vor** Session und erster Phase | Worktree | — |
| `before_phase` | Vor Phase … | bevor die Phase startet, **vor** den `before_phase`-Agents | Worktree | Phase (Pflicht) |
| `after_phase` | Nach Phase … | nach Abschluss der Phase, **vor** den `after_phase`-Agents und vor dem Auto-Progress | Worktree | Phase (Pflicht) |
| `before_stage` | Vor Stufe … | bevor die Arbeit der Stufe beginnt | Worktree | Stufe (Pflicht) |
| `after_stage` | Nach Stufe … | nachdem die Stufe erfolgreich beendet ist, vor dem Weiterlauf | Worktree (Ausnahme: `merged` → Haupt-Checkout) | Stufe (Pflicht) |

**Phasen** (`FEATURE_PHASES`): `specify`, `clarify`, `plan`, `checklist`, `analyze`, `tasks`,
`implement`.

**Stufen** (`INTEGRATION_STAGE_IDS`, = IDs der Integrations-Pipeline):

| ID | Titel | `before_stage` läuft | `after_stage` läuft |
|---|---|---|---|
| `verify` | Verifikation | vor Test/Build/Lint | nach grüner Verifikation |
| `review_gate` | Review-Gate | vor den Review-Agents | nach bestandenem Gate |
| `human_review` | Menschliches Review | vor der Übergabe an den Menschen | nach der Freigabe, vor dem Einreihen |
| `merge_queue` | Merge-Queue | vor dem Rebase | nach erfolgreichem Merge |
| `merged` | Abschluss | nach dem Merge, vor dem Worktree-Cleanup | nach dem Cleanup, **vor** dem Abschluss-Vermerk |

**Erweiterungs-Zusicherung (FR-008)**: Der Katalog ist über `Record<LifecycleTriggerKind, …>` und
`Record<LifecycleStageId, …>` getypt und zusätzlich durch Laufzeit-Exhaustiveness in
`workflowModel.test.ts` abgesichert. Eine neue Auslöser-Art oder eine neue Pipeline-Stufe bricht
`pnpm typecheck` bzw. `pnpm test`, solange die Workflow-Übersicht nicht mitgezogen ist.

---

## 2. Umgebung des Kommandos

Gesetzt werden **genau** diese Variablen (zusätzlich zur normalen Login-Shell-Umgebung):

| Variable | Inhalt | leer, wenn |
|---|---|---|
| `SDD_WORKTREE` | absoluter Worktree-Pfad des Features; bei `before_worktree_create` der **künftige** Pfad | nie |
| `SDD_PROJECT` | Projektname | nie |
| `SDD_FEATURE` | Feature-Slug (= Ordnername unter `specs/`) | nie |
| `SDD_BRANCH` | Feature-Branch (`feature/<slug>`) | nie |
| `SDD_PHASE` | betroffene Phase | am Auslöser existiert keine Phase |
| `SDD_STAGE` | betroffene Stufen-ID | am Auslöser existiert keine Stufe |

**Zusicherungen**
- Nicht zutreffende Angaben sind der **leere String**, nie ein Platzhalter und nie ein Wert aus
  einem anderen Vorgang (FR-012). Alle sechs Schlüssel sind immer vorhanden — `set -u` ist
  gefahrlos.
- `SDD_PORT_BASE` und `SDD_PROFILE` sind **nicht Teil dieses Vertrags** (FR-013/FR-014). Sie
  werden von F1c ergänzt; ein Kommando darf sich heute nicht darauf verlassen.
- Es findet **keine Textersetzung im Kommando** statt. Der Kontext kommt ausschließlich als
  Umgebungsvariable — Pfade mit Leerzeichen sind damit sicher (`"$SDD_WORKTREE"`).

---

## 3. Ausführung

| Eigenschaft | Wert |
|---|---|
| Shell | Login-Shell des Nutzers: `$SHELL -l -c "<command>"` (Fallback `/bin/zsh`) |
| Arbeitsverzeichnis | siehe Katalog (§1) |
| Umgebung | Login-Shell-Umgebung + die sechs Variablen aus §2 |
| stdin | geschlossen (`ignore`) — Kommandos dürfen nicht interaktiv sein |
| stdout + stderr | gemeinsam nach `<dataDir>/logs/<executionId>.log` |
| Reihenfolge | **sequentiell**: global vor Projekt, je Gruppe nach Position, bei Gleichstand nach Name |
| Zeitlimit | pro Schritt konfigurierbar; Vorgabe **15 min**; Überschreitung ⇒ SIGKILL, Lauf `failed` (Exit-Code `137`) |
| Bewertung | **ausschließlich** Exit-Code und Zeitlimit — die Ausgabe wird nie interpretiert |
| Verbrauch | keiner: Tokens/Betrag bleiben leer, nie 0 und nie geschätzt |

**Log-Kopf** (erste Zeile jeder Log-Datei, Muster aus `verifyService`):

```
=== <name>: <command> ===
```

**Erfolg** heißt ausschließlich „Exit-Code 0 innerhalb des Zeitlimits". Ein Erfolgsvermerk ist
**keine** inhaltliche Aussage über die Wirkung des Kommandos (Edge Case „läuft ohne Fehler,
produziert aber keine Wirkung").

---

## 4. Fehlerverhalten

| Fall | Wirkung |
|---|---|
| Exit 0 | nächster Schritt des Auslösers; nach dem letzten Schritt werden offene Schritt-Meldungen des Features aufgelöst |
| Exit ≠ 0, **beratend** | Lauf ist `failed`; Ablauf läuft ohne Eingriff weiter; **kein** Inbox-Item |
| Exit ≠ 0, **blockierend** | Kette bricht ab (folgende Schritte desselben Auslösers laufen **nicht**); der zugehörige Vorgang startet/setzt nicht fort; Inbox-Item mit Name, Kommando, Exit-Code und den letzten Ausgabezeilen |
| Zeitlimit | Kommando wird beendet, Lauf `failed`, danach greift das konfigurierte Fehlerverhalten wie bei jedem anderen Fehlschlag |
| Kommando existiert nicht | Exit-Code `127` ⇒ regulärer Fehlschlag, nie ein stiller Erfolg |
| Worktree fehlt unerwartet | **behebbarer Infrastrukturfehler**: Meldung „erneut anstoßen", **kein** Schritt-Lauf, **kein** FAIL |
| Toolkit endet während des Laufs | Lauf ist beim Neustart als `orphaned` erkennbar, nie dauerhaft „läuft" |

**Wiederanlauf**: Es gibt bewusst **kein** Wiederholen eines einzelnen Schritts. Die betroffene
Stufe wird als Ganzes erneut angestoßen (Phase starten, Integration wiederaufnehmen, Session für
das Feature anfordern); läuft der Auslöser dabei vollständig durch, verschwindet das Inbox-Item.

---

## 5. Beispiel

Schritt am Projekt: Name `Abhängigkeiten installieren`, Auslöser `after_worktree_create`,
blockierend, Zeitlimit 10 min:

```sh
pnpm install --frozen-lockfile
```

Schritt, der den Kontext auswertet (Auslöser `after_phase` / `implement`, beratend):

```sh
echo "Feature $SDD_FEATURE auf $SDD_BRANCH, Phase '$SDD_PHASE', Stufe '$SDD_STAGE'"
test -d "$SDD_WORKTREE/specs/$SDD_FEATURE"
```
