# Phase 0 — Research & Leitentscheidungen: Worktree-Übersicht

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-26

Die Spezifikation enthält **keine offenen `[NEEDS CLARIFICATION]`-Marker** (beide Fragen wurden
in Session 2026-07-26 geklärt: Anzeige **und** Entfernen; Warnungen **aktiv** melden). Die
Unbekannten dieses Plans sind daher rein technischer Natur. Jede ist unten mit
Entscheidung, Begründung und verworfenen Alternativen dokumentiert.

---

## D1 — Datenquelle: Git-Realität statt DB-Zustand

**Decision**: Die Übersicht wird bei jeder Erhebung aus `git worktree list --porcelain` je
Projekt aufgebaut und erst danach mit der `features`-Tabelle angereichert. Die DB liefert
Zuordnung und Bearbeitungsstand, **nie** die Existenzaussage.

**Rationale**: Genau die Diskrepanz zwischen DB-Meinung und Festplatte ist der geschilderte
Schmerz (FR-028, SC-002, Edge Cases „Registry-Leiche", „fehlendes Verzeichnis"). Nur die
Git-Sicht kennt extern angelegte Worktrees; nur der Abgleich mit der DB kennt Features, deren
Verzeichnis verschwunden ist. Beide Richtungen des Abgleichs sind erforderlich:

| Fall | git kennt | DB kennt | Ergebnis |
|---|---|---|---|
| Normal | ✅ (Verz. da) | ✅ | `feature`, `dirState: present` |
| Verwaist | ✅ (Verz. da) | ❌ | `orphan` bzw. `chat`, `present` |
| Registry-Leiche | ✅ (Verz. weg / `prunable`) | egal | `registry_only`, nicht entfernbar |
| Fehlender Worktree | ❌ | ✅ (`worktreePath` gesetzt) | `feature`, `dirState: missing` |

**Alternatives considered**:
- *Nur `features.worktreePath` lesen* (schnell, kein git): verworfen — kann Verwaiste und
  Registry-Leichen prinzipiell nicht sehen, also genau das Problem nicht lösen.
- *Verzeichnis-Scan unter `<dataDir>/worktrees/`*: verworfen — kennt weder Branch noch
  Registrierungszustand und verpasst Worktrees außerhalb des Datenverzeichnisses.

---

## D2 — Zuordnung Worktree ↔ Feature über realpath, Fallback Branch

**Decision**: Schlüssel der Zuordnung ist der **kanonisierte Pfad** (`realpathSync`, Fallback
`resolve()` wenn der Pfad nicht existiert). Findet sich darüber kein Feature, wird über
**Branch-Gleichheit** nachgeschlagen. Ohne Treffer: `orphan` (bzw. `chat`, siehe D3).

**Rationale**: `git worktree list` gibt stets aufgelöste Pfade aus. Unter macOS ist
`os.tmpdir()` = `/var/folders/...` → real `/private/var/folders/...`; auch
`~/.sdd-toolkit/worktrees` kann über Symlinks erreichbar sein. Ein naiver String-Vergleich
gegen `feature.worktreePath` erzeugt sonst systematisch falsche „verwaist"-Meldungen — ein
Fehlalarm-Typ, den die Spezifikation ausdrücklich ausschließt (FR-020, SC-010). Der
Branch-Fallback fängt den Fall ab, dass der Worktree extern verschoben wurde.

**Alternatives considered**:
- *Nur Branch-Vergleich*: verworfen — ein Feature kann (nach Abbruch/Neuanlage) mehrere
  Verzeichnisse auf demselben Branch hinterlassen; der Pfad ist die genauere Identität.
- *`git rev-parse --git-common-dir`-Vergleich*: verworfen — zusätzlicher Prozessaufruf je
  Worktree ohne Mehrwert gegenüber realpath.

---

## D3 — Vier Eintragsarten statt „Worktree/kein Worktree"

**Decision**: `kind ∈ { main, feature, chat, orphan }`. Verzeichnisnamen der Form
`chat-<conversationId>` bzw. Branches `chat/<id>` (siehe `chatWorkService.ts`) werden als
**„Wissens-Chat"** ausgewiesen, nicht als verwaist.

**Rationale**: Chat-Arbeitskopien sind ein reguläres, vom Toolkit selbst erzeugtes Artefakt.
Sie als „verwaist" zu melden wäre ein Fehlalarm und würde die Kernaussage der Ansicht
verwässern. Der Haupt-Checkout ist ohnehin eine eigene Entität (FR-003, keine
Entfernen-Aktion, FR-026).

**Alternatives considered**:
- *Chat-Worktrees ausblenden*: verworfen — sie belegen Platz und Branches; „100 % der
  bestehenden Worktrees erscheinen" (SC-002) verlangt ihre Sichtbarkeit.
- *Nur `feature | other`*: verworfen — verliert die Unterscheidung, die dem Nutzer die
  Entscheidung „aufräumen ja/nein" abnimmt.

---

## D4 — Dateiebene: Änderungsart und Commit-Zustand aus drei git-Abfragen

**Decision**: Vergleichsbasis ist `base = merge-base(<target>, HEAD)` mit
`target = feature.integrationTarget ?? project.defaultBranch`. Je Worktree:

1. `git diff --name-status -M -z <base>` → **Netto-Änderung inkl. Arbeitsbaum** (ohne End-Ref
   fließen ungestagte Änderungen ein) ⇒ liefert `kind` (`added|modified|deleted|renamed`).
2. `git ls-files --others --exclude-standard -z` → **untracked** Dateien ⇒ `kind: 'added'`.
3. `git diff --name-only -z <base>..HEAD` → Pfade mit **committeten** Anteilen.
4. `git status --porcelain -z` → Pfade mit **uncommitteten** Anteilen.

Zusammenführung (pure Funktion `mergeFileChanges`): `state = 'committed' | 'uncommitted' |
'both'`. Eine Datei, die committet **und** danach erneut verändert wurde, ist ehrlich `both`.

**Rationale**: FR-011/012/013 verlangen Pfad, Änderungsart **und** die Unterscheidung
committet/uncommittet. `collectUnmergedChanges()` (bestehend, für das Review-Portal) liefert
Additions/Deletions, aber weder Änderungsart noch diese Unterscheidung — es wird deshalb
**nicht erweitert** (Rückwirkungsfreiheit auf Review-Portal und Merge-Queue), sondern ein
eigener Leser ergänzt. `-M` aktiviert Rename-Erkennung (Edge Case „umbenannte Dateien").

**Alternatives considered**:
- *`collectUnmergedChanges` erweitern*: verworfen — zwei Verbraucher mit anderer Semantik;
  Änderungsrisiko an einem Pfad, der die Merge-Queue speist.
- *Dateiliste erst beim Aufklappen laden (Lazy-Endpoint)*: verworfen — die
  Überschneidungs-Warnung (FR-017) braucht die Listen **aller** Worktrees ohnehin bereits
  beim Aufbau der Übersicht; ein zweiter Endpunkt würde dieselbe Arbeit doppelt tun.

---

## D5 — `-z`-Ausgaben parsen, Parser pure und getestet

**Decision**: Alle Dateilisten werden mit `-z` (NUL-separiert) gelesen; die Parser leben als
pure Funktionen in `packages/shared/src/worktreeStatus.ts` mit vitest-Tests.

**Rationale**: Ohne `-z` quotiert git Pfade mit Sonderzeichen/Umlauten (`core.quotepath`) und
Renames erscheinen als `alt -> neu` in einer Zeile — beides fehleranfällig. Mit `-z` sind
Rename-Paare zwei aufeinanderfolgende Felder, Pfade bleiben roh. Die Parser sind reine
String-Verarbeitung ⇒ gehören nach `shared` (Repo-Konvention, testbar ohne Git-Fixture).

**Alternatives considered**:
- *Zeilenweise Ausgabe + Unquoting selbst implementieren*: verworfen — repliziert
  git-Quoting-Regeln fehleranfällig.
- *`--numstat` wiederverwenden*: verworfen — kennt keine Änderungsart.

---

## D6 — Warnlogik und Fehlalarm-Vermeidung

**Decision**: Drei Warnarten, in dieser Reihenfolge ausgewertet:

| Art | Bedingung | Datenquelle |
|---|---|---|
| `already_merged` | Branch existiert nicht mehr **oder** ist Vorfahre des Zielbranchs | `isBranchMergedInto(project.path, branch, target)` (bestehend) |
| `behind_target` | Schnittmenge aus geänderten Worktree-Dateien und `git diff --name-only -z <base>..<target>` ist nicht leer | je (Projekt, target, base) **einmal** erhoben und gecacht |
| `overlap` | Derselbe Dateipfad ist in ≥ 2 offenen Worktrees **desselben Projekts** geändert | pure `detectOverlaps()` über alle Einträge des Projekts |

Fehlalarm-Regeln (FR-020, SC-010):
- Ein Eintrag mit `already_merged` erhält **keinen** zusätzlichen `behind_target`-Hinweis —
  bei integrierter Arbeit ist „Zielbranch hat sich bewegt" die triviale Folge, nicht das
  Risiko. Beide zugleich wären Rauschen.
- Überschneidungs-Schlüssel ist der **neue** Pfad einer Umbenennung; `oldPath` bleibt
  informativ und erzeugt keinen Treffer.
- Der Haupt-Checkout nimmt an keiner Warnung teil (D7).
- Einträge mit `dirState ≠ present` erzeugen und empfangen keine Warnungen (nichts messbar).
- Mehrere zutreffende Warnungen werden **alle** transportiert (FR-021), jede mit eigener
  Dateiliste und — bei `overlap` — den beteiligten anderen Einträgen.

**Rationale**: Direkt aus FR-017…FR-021 abgeleitet. Die Aussage „bereits integriert" ist die
handlungsleitende (Worktree kann weg); sie darf nicht in Folge-Rauschen untergehen.

**Alternatives considered**:
- *Inhaltliche Konflikterkennung (Probe-Merge je Worktree)*: verworfen — teuer (Merge je
  Worktree), riskant (Arbeitsbaum-Zustände) und über die Spezifikation hinaus, die
  ausdrücklich keine Diffs/Inhaltsprüfung will.
- *Überschneidung projektübergreifend*: verworfen — verschiedene Repos, keine gemeinsame Datei.

---

## D7 — Haupt-Checkout als eigene, schlanke Entität

**Decision**: Der Haupt-Checkout wird als eigener Typ `MainCheckoutInfo` transportiert
(Projektname, Pfad, aktueller Branch, Default-/Zielbranch, Anzahl uncommitteter Dateien) —
ohne Dateiliste, ohne Warnungen, ohne Entfernen-Aktion.

**Rationale**: Entspricht exakt der Entitätsbeschreibung der Spezifikation und FR-026. Ein
gemeinsamer Typ mit Worktrees müsste „0 geänderte Dateien" melden, was die Aussage
„änderungsfrei" (FR-015) fälschlich auf den Haupt-Checkout ausdehnen würde. Getrennte Typen
machen im UI wie im Vertrag unmissverständlich, dass hier nichts entfernbar ist.

**Alternatives considered**:
- *Ein Typ mit `kind: 'main'`*: verworfen — lädt zu unehrlichen Nullwerten und
  versehentlichen Aktionen ein.

---

## D8 — Aktualität: Polling 5 s + Refetch auf Feature-Events, kein neues WS-Event

**Decision**: Die View lädt beim Öffnen, danach alle **5 Sekunden** (nur solange sie sichtbar
ist), zusätzlich bei jeder Änderung der Feature-Signatur aus dem Store (WS-getrieben, Muster
`ReviewOverview`) und auf Knopfdruck (`↻ Aktualisieren`, mit `?refresh=1`). Serverseitig
schützt ein **TTL-Cache (2 s) mit In-Flight-Dedupe** vor Stampede.

**Rationale**: SC-004 verlangt ≤ 5 s ohne Nutzerzutun. Extern (Terminal) angelegte Worktrees
erzeugen **kein** Toolkit-Event — nur Polling erfasst sie, was FR-029 ausdrücklich fordert
(„wenn Worktrees angelegt oder entfernt werden", nicht „durch das Toolkit angelegt"). Ein
zusätzliches `worktrees_updated`-Event würde diesen Fall nicht abdecken und trotzdem
Bus/Store/Reducer erweitern. Das Refetch auf `feature_updated`/`feature_deleted` bringt die
toolkit-eigenen Änderungen (Merge, Cleanup) sofort. Polling-Intervall und Cache-TTL folgen
dem bestehenden `ExecutionsView`-Muster (5 s).

**Alternatives considered**:
- *Neues WS-Event `worktrees_updated`*: verworfen — erfasst externe Änderungen nicht, kostet
  Vertragsfläche in `events.ts`, Store und Reducer.
- *chokidar auf `<dataDir>/worktrees` + `.git/worktrees`*: verworfen — Watcher-Aufwand,
  Plattform-Eigenheiten und Race-Fälle für einen Gewinn von wenigen Sekunden.
- *Nur manuelles Aktualisieren*: verworfen — verletzt FR-029/SC-004.

---

## D9 — Performance: Nebenläufigkeit 6, TTL-Cache, gekürzte Dateilisten

**Decision**: Erhebung je Worktree parallel mit **Limit 6**; Ergebnis 2 s gecacht;
`?refresh=1` umgeht den Cache; je Worktree werden höchstens **300** Dateien transportiert
(`filesTruncated: true`, `changedFileCount` nennt die Gesamtzahl).

**Rationale**: ~7 git-Aufrufe je Worktree × 30 Worktrees ≈ 210 Prozesse; bei ~25 ms und
6-facher Nebenläufigkeit ≈ 0,9 s — innerhalb SC-003 (< 2 s). Unbegrenzte Parallelität würde
bei vielen Worktrees Prozesse und Dateideskriptoren sprengen; strikt seriell wäre zu langsam.
Die Kürzung erfüllt FR-016 ohne Paginierungs-Apparat; die **Warnberechnung nutzt intern die
ungekürzten** Listen, damit keine Überschneidung durch die Kürzung verloren geht.

**Alternatives considered**:
- *Persistenter Cache in SQLite*: verworfen — die Ansicht muss die Realität abbilden, nicht
  einen Zwischenstand (FR-028).
- *Lazy-Load der Dateilisten je Eintrag*: verworfen (siehe D4).

---

## D10 — Entfernen: bestehender `WorktreeManager`, drei Guards, zweistufige Bestätigung

**Decision**: `POST /api/worktrees/remove { projectId, path, force? }`. Der Server

1. liest die Worktree-Liste des Projekts **frisch** und akzeptiert nur einen dort geführten,
   existierenden Pfad (sonst 400) — der Client kann keinen beliebigen Ordner adressieren;
2. lehnt den Haupt-Checkout ab (400, FR-026);
3. lehnt ab, wenn eine nicht beendete PTY-Session mit `cwd` innerhalb des Worktrees läuft
   (409 `session_active`, FR-025);
4. antwortet ohne `force` bei uncommitteten Änderungen mit 409 `uncommitted` **inkl. Anzahl**
   (FR-024) — erst `force: true` führt `git worktree remove --force` aus;
5. ruft `WorktreeManager.remove(projectPath, path, { force })` (bestehend, bewährt),
   setzt bei zugeordnetem Feature `features.setWorktree(id, null)`, sendet `feature_updated`
   und verwirft den Cache;
6. meldet Fehlschläge als 500 mit Klartext, ohne die Übersicht zu verfälschen (FR-027).

Branch-Löschen, `prune` und Reparatur bleiben **außerhalb** des Umfangs — deshalb bietet ein
`registry_only`-Eintrag (Verzeichnis fehlt) **keine** Entfernen-Aktion an.

**Rationale**: Der doppelte Schutz (Session, Zweitbestätigung) ist die direkte Umsetzung von
SC-009 („in 0 Fällen unbemerkter Verlust"). Der Server ist Wahrheitsquelle für „dirty" — die
UI muss den Zustand nicht raten, und ein zwischenzeitlich schmutzig gewordener Worktree
löst zuverlässig die Zweitbestätigung aus.

**Alternatives considered**:
- *`DELETE /api/worktrees?path=…`*: verworfen — Hausstil nutzt POST für Aktionen mit Körper;
  ein Löschpfad im Query-String lädt zu Missgriffen ein.
- *Dirty-Prüfung im Client*: verworfen — TOCTOU; der Client kennt den Arbeitsbaum nicht.
- *Beim Entfernen auch den Branch löschen*: verworfen — von der Spezifikation ausgeschlossen
  (Assumptions), und irreversibel.

---

## D11 — Bearbeitungsstand ohne neue Serverlogik

**Decision**: Der Server liefert nur `featureId`. Das Label („Umsetzen läuft",
„Bereit zum Review", „Abgeschlossen") berechnet eine neue pure Funktion
`featureProgressLabel(feature)` in `packages/shared/src/workflowModel.ts`, gespeist aus dem
ohnehin im Store vorhandenen Feature-Objekt (`/api/state` liefert **alle** Projekte).

**Rationale**: FR-007 verlangt den Bearbeitungsstand; `PHASE_META` und
`INTEGRATION_STAGE_META` existieren bereits in `shared`. Die Ableitung dort zu bündeln
vermeidet Duplikate (Kanban nutzt heute ein lokales `columnOf`) und hält den
Worktree-Endpunkt frei von Phasen-Semantik.

**Alternatives considered**:
- *Phasenzustand mit ausliefern*: verworfen — Redundanz zu `/api/state`, zusätzliche
  Konsistenzpflicht bei Phasenwechseln.

---

## D12 — Einstiegspunkt und Ansichtsform

**Decision**: Neuer Eintrag **„Worktree-Übersicht"** im bestehenden Dialog *Einstellungen*
(Sidebar unten links, Komponente `ToolSettings`). Klick schließt den Dialog und öffnet eine
**Top-Level-View** `{ kind: 'worktrees' }` im Hauptbereich (kein Modal).

**Rationale**: FR-001 nennt den Ort; SC-001 verlangt **zwei** Interaktionen
(Einstellungen öffnen → Eintrag wählen) — exakt erfüllt. Der Inhalt (mehrere Projekte,
aufklappbare Dateilisten, Warnungen, Aktionen) sprengt einen 28-rem-Dialog; die vorhandenen
Top-Level-Views (`review`, `workflow`, `agents`) sind das etablierte Muster für solche
Übersichten. Die View ist bewusst **nicht** als Tab in der Kopfleiste sichtbar, weil sie
tool-weit (projektübergreifend) ist, während die Tabs projektbezogen sind.

**Alternatives considered**:
- *Großer Dialog (`wide`)*: verworfen — schlechte Bedienbarkeit bei langen Listen, kein
  stabiler Deep-Link-Zustand.
- *Zusätzlicher Tab in der Kopfleiste*: verworfen — widerspricht dem Projekt-Scope der Tabs
  und dem in FR-001 geforderten Einstiegspunkt.

---

## Offene Punkte

Keine. Alle in der Technical Context aufgeworfenen Unbekannten sind durch D1–D12 entschieden;
`[NEEDS CLARIFICATION]` verbleibt nirgends.
