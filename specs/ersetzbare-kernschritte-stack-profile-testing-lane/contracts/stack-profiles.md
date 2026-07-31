# Vertrag: Stack-Profile, Portbereich und Kommando-Umgebung

Dieser Vertrag beschreibt, was ein **Projekt** zusichern muss, wenn es Stack-Profile hinterlegt, und
was das **Toolkit** dafür zusichert. Er ist die Schnittstelle zwischen beiden — das Toolkit bringt
keine Kommandos mit und setzt keine Container- oder Orchestrierungstechnik voraus (FR-012).

---

## 1. Die drei Profile

| Profil | Wann | Zusicherung des Kommandos |
|---|---|---|
| `test` | ab Beginn der Phase `implement`, bleibt stehen | fährt genau die Dienste hoch, die die Testsuite braucht; **idempotent** |
| `full` | nur auf Anforderung aus der Testing-Lane | fährt den vollständigen Stack hoch; **idempotent** |
| `down` | Session-Ende, Merge, Worktree-Entfernen, Archivieren/Löschen | baut ab **einschließlich der Datenablagen (Volumes)**; **idempotent** |

Zusätzlich optional: **`stopCommand`** — hält die Dienste an und **behält** die Daten. Es ist kein
Profil, sondern die Umsetzung der Lane-Aktion „Stoppen"; `$SDD_PROFILE` ist dabei `down`.

**Idempotenz ist Pflicht** (FR-015): ein erneuter Aufruf darf keinen zweiten Satz Dienste erzeugen
und nicht fehlschlagen. Bei Compose leistet das `up -d` bzw. `down` von sich aus.

Je Profil gibt es zwei Kommandos:

- **`command`** — die feature-eigenen Dienste. Läuft immer.
- **`sharedCommand`** (optional) — die projektweit geteilten Dienste. Das **Toolkit** entscheidet, ob
  es läuft: beim Hochfahren nur, wenn die geteilten Dienste nicht erreichbar sind; beim Abbau nur,
  wenn kein weiteres Feature des Projekts noch einen Stack betreibt (FR-022).

---

## 2. Umgebung des Kommandos

Alle Kommandos erhalten **acht** Variablen — dieselben sechs wie jeder Lebenszyklus-Schritt aus F1b
plus die zwei, die dieses Feature ergänzt. Sie entstehen an genau einer Stelle
(`buildLifecycleEnv()` in `packages/shared/src/lifecycleSteps.ts`, FR-007).

| Variable | Inhalt | bei Profilläufen |
|---|---|---|
| `SDD_WORKTREE` | absoluter Pfad des Worktrees | gesetzt (leer beim geteilten Kommando ohne Feature-Bezug) |
| `SDD_PROJECT` | Projektname | gesetzt |
| `SDD_FEATURE` | Feature-Slug (= Ordner unter `specs/`) | gesetzt (leer beim geteilten Kommando) |
| `SDD_BRANCH` | Branch des Features | gesetzt (leer beim geteilten Kommando) |
| `SDD_PHASE` | Phase, falls fachlich vorhanden | leer |
| `SDD_STAGE` | Pipeline-Stufe, falls fachlich vorhanden | leer |
| **`SDD_PORT_BASE`** | Anfang des exklusiven Portblocks | feature-eigen: Block des Worktrees; geteilt: Block des **Projekts** |
| **`SDD_PROFILE`** | `test` \| `full` \| `down` | immer gesetzt |

**Immer alle acht Schlüssel vorhanden.** Nicht zutreffende Angaben sind der **leere String**, nie
ein Platzhalter und nie ein Wert aus einem anderen Vorgang — `set -u` ist damit gefahrlos, und
`[ -z "$SDD_PROFILE" ]` unterscheidet einen gewöhnlichen Schritt von einem Profillauf.

Zusätzlich liegt im Worktree `.sdd/env` mit den **stabilen** Angaben (`SDD_PORT_BASE`,
`SDD_PORT_SPAN`, `SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`, `SDD_BRANCH`) — für Werkzeuge und
Agents, die ohne das Toolkit laufen (FR-006). Die Datei ist ein **Erzeugnis**: sie wird
überschrieben, ist über `info/exclude` vom Repo ausgeschlossen und darf nicht bearbeitet werden
(FR-009).

**Es wird nichts in den Kommandotext interpoliert.** Kontext kommt ausschließlich über
Umgebungsvariablen — quoting-sicher und ohne Injection-Fläche.

---

## 3. Portbereich

- `$SDD_PORT_BASE` ist der **Anfang** eines zusammenhängenden Blocks der Breite `SDD_PORT_SPAN`
  (Vorgabe 20), der dem Worktree exklusiv gehört.
- Der Port eines Dienstes ist `SDD_PORT_BASE + <Abstand>`; die Abstände stehen in der Dienstliste
  des Projekts und sind dort die einzige Wahrheit — das Kommando muss dieselbe Ableitung verwenden.
- Der Block ist über alle Läufe und Sitzungen **stabil**, solange der Worktree besteht (FR-004).
- Projektweit geteilte Dienste liegen im Block des **Projekts**, nicht im Block eines Features —
  sonst stürben sie mit dessen Abbau.

Beispiel-Dienstliste (Projekt-Einstellungen):

| Dienst | Abstand | Betriebsart | zustandsbehaftet | Haupteingang |
|---|---|---|---|---|
| `web` | 0 | feature-eigen | nein | **ja** |
| `api` | 1 | feature-eigen | nein | nein |
| `db` | 2 | feature-eigen | **ja** | nein |
| `mail` | 0 | geteilt | nein | nein |

Bei `SDD_PORT_BASE=21040` ergibt das `web` → 21040, `api` → 21041, `db` → 21042 und die klickbare
URL `http://localhost:21040`.

---

## 4. Ausführung

| Eigenschaft | Festlegung |
|---|---|
| Shell | `$SHELL -l -c "<command>"` (Login-Shell — Version-Manager wie nvm/mise hängen in `.zprofile`) |
| Arbeitsverzeichnis | der Worktree des Features; beim geteilten Kommando der Haupt-Checkout des Projekts |
| Reihenfolge | geteiltes Kommando **vor** dem feature-eigenen beim Hochfahren, **danach** beim Abbau |
| Nebenläufigkeit | je Feature sequentiell; das geteilte Kommando ist pro Projekt serialisiert (es entsteht genau einmal) |
| Zeitlimit | `timeoutMs` des Profils, Vorgabe 15 min (identisch mit Verifikations-Kommandos) |
| Bei Zeitlimit | die **eigene Prozessgruppe** wird beendet (`kill(-pid)`), Lauf als Fehlschlag verbucht (exit 137) |
| Ausgabe | vollständig gestreamt nach `<dataDir>/logs/<execId>.log`, über die Läufe-Ansicht einsehbar |
| Buchführung | eine Execution der Art `lifecycle_step` mit `label: "Stack: <profil>"`, **ohne** Verbrauchswert (`tokens`/`cost_micros` bleiben NULL) |

**Niemals** wird ein Prozess über ein Namensmuster beendet (`pkill`, `killall`) — weder vom Toolkit
noch in einem empfohlenen Kommando (FR-040/FR-041; Projektregel `CLAUDE.md`).

---

## 5. Bewertung

Bewertet werden **ausschließlich Exit-Code und Zeitlimit**. Die Ausgabe wird nie interpretiert.

| Ergebnis | Wirkung |
|---|---|
| exit 0 | Profil gilt als betrieben; die Absicht wird festgehalten; offene `stack_failed`-Meldungen des Features werden aufgelöst |
| exit ≠ 0 | `stack_failed`-Meldung mit Profil, Kommando, Exit-Code und den letzten 20 Ausgabezeilen; der Ablauf läuft **nicht** auf einem halben Stack weiter (FR-019) |
| Zeitüberschreitung | wie exit ≠ 0, Meldung nennt das Zeitlimit |
| Kommando existiert nicht | exit 127 — regulärer Fehlschlag, nie ein stiller Erfolg |

Wirkung je Anlass:

| Anlass | Fehlschlag bedeutet |
|---|---|
| `test` bei Beginn `implement` | die Phase startet **nicht**, sie bleibt `idle` (Wiederanlauf über manuelles Starten) |
| `full`/`stop`/`restart` aus der Lane | die Aktion antwortet mit Fehler; der bisherige Zustand bleibt |
| `down` beim Merge | der Merge bleibt bestehen, der Worktree-Pfad wird **nicht** geleert; die Meldung steht in der Inbox |
| `down` beim Entfernen aus der Übersicht | das Entfernen wird abgelehnt und nennt den Grund |

---

## 6. Beispiel (Docker Compose — eine mögliche Umsetzung, keine Vorgabe)

Profil `test`:

```sh
# feature-eigen
docker compose -p "sdd-$SDD_FEATURE" \
  --env-file "$SDD_WORKTREE/.sdd/env" \
  up -d --wait api db
```

Profil `full`:

```sh
docker compose -p "sdd-$SDD_FEATURE" --env-file "$SDD_WORKTREE/.sdd/env" up -d --wait
```

Profil `down` (feature-eigen, **mit** Volumes):

```sh
docker compose -p "sdd-$SDD_FEATURE" down -v --remove-orphans
```

`stopCommand` (anhalten, Daten behalten):

```sh
docker compose -p "sdd-$SDD_FEATURE" stop
```

Geteiltes Kommando (`sharedCommand` von `full`, im Haupt-Checkout, mit dem **Projektblock**):

```sh
docker compose -p sdd-shared -f docker-compose.shared.yml up -d --wait
```

Die `compose.yaml` leitet ihre Ports aus dem Block ab:

```yaml
services:
  web:
    ports: ["${SDD_PORT_BASE}:3000"]
  api:
    ports: ["$$(( SDD_PORT_BASE + 1 )):8080"]   # bzw. vorberechnet in .sdd/env
```

> Hinweis für Projekte: Compose rechnet in `ports:` nicht. Entweder das Kommando berechnet die Ports
> vorab (`WEB_PORT=$SDD_PORT_BASE API_PORT=$((SDD_PORT_BASE+1)) docker compose …`) oder die
> Dienstliste im Toolkit bleibt die einzige Quelle und das Projekt liest `.sdd/env`. Das Toolkit
> schreibt bewusst keine Compose-Datei — es kennt die Technik nicht.

---

## 7. Was das Toolkit **nicht** zusichert

- Keine Prüfung, ob das Kommando wirklich die konfigurierten Dienste startet. Der abgeleitete Port
  wird geprobt; antwortet dort nichts, zeigt die Lane „nicht erreichbar" (FR-033).
- Kein Warten auf Startbereitschaft über das Kommando hinaus. Wer Bereitschaft braucht, baut sie ins
  Kommando (`--wait`, `wait-for-it`).
- Keine Reihenfolge zwischen Diensten. Das ist Sache des Kommandos.
- Kein Betrieb auf anderen Maschinen (Out of Scope der Spec).
