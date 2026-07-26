# Quickstart / Validierung: Worktree-Übersicht

Nachweis, dass das Feature end-to-end funktioniert. Contracts:
[http-api.md](./contracts/http-api.md), [ui-contract.md](./contracts/ui-contract.md);
Datenmodell: [data-model.md](./data-model.md); Entscheidungen: [research.md](./research.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10, git ≥ 2.40
- Dev-Server: `pnpm dev` (Server 4820 + Web 4830) → <http://localhost:4830>
- Mindestens **ein** Toolkit-Projekt mit `defaultBranch` `main` und **zwei** Features mit
  Worktree (für Überschneidungs- und Zuordnungsprüfungen)
- Für Stufe 4 hilfreich: ein zweites Projekt, dessen Pfad danach umbenannt wird

---

## Stufe 1: Automatisierte Checks

```bash
pnpm -r typecheck && pnpm -r test
```

**Erwartung**: grün. Neu bzw. relevant:

| Testdatei | Deckt ab |
|---|---|
| `packages/shared/src/worktreeStatus.test.ts` | Parser `--name-status -z` / `status --porcelain -z` (inkl. Rename-Paare, Löschungen, Pfade mit Leerzeichen/Umlauten), `mergeFileChanges` (`committed`/`uncommitted`/`both`), `detectOverlaps` (inkl. „`oldPath` erzeugt keinen Treffer") |
| `packages/shared/src/workflowModel.test.ts` | `featureProgressLabel` für Phasenlauf, Integration, `merged` |
| `packages/server/src/git/worktreeInventory.test.ts` | Porcelain-Parser inkl. `detached`, `bare`, `locked`, `prunable`; `WorktreeManager.list()` weiterhin identisch |
| `packages/server/src/services/worktreeChanges.test.ts` | Erhebung gegen echtes Temp-Repo: neu/geändert/gelöscht/umbenannt, untracked, committet vs. uncommittet |
| `packages/server/src/services/worktreeOverviewService.test.ts` | Zuordnung über realpath (Temp-Repo unter `/private/var` ⇒ **kein** falsches „verwaist"), `dirState`-Fälle, Warnungen, Entfernen-Guards |
| bestehende Suites | `git/worktreesCreate.test.ts`, `services/mergeQueueService.test.ts` unverändert grün |

---

## Stufe 2: API-Rauchtest (ohne UI)

```bash
# Vollständige Momentaufnahme
curl -s localhost:4820/api/worktrees | jq '.collectedAt, [.groups[] | {p:.projectName, n:.worktreeCount, err:.error}]'

# Ein Projekt im Detail
curl -s localhost:4820/api/worktrees | jq '.groups[0].worktrees[] | {label, branch, dirState, changedFileCount, warnings: [.warnings[].kind]}'

# Cache-Umgehung
curl -s "localhost:4820/api/worktrees?refresh=1" | jq '.collectedAt'
```

**Erwartung**

1. Jedes konfigurierte Projekt erscheint als Block — auch ein unerreichbares (mit `error`).
2. Der Haupt-Checkout steht in `groups[].main` mit aktuellem Branch und `uncommittedFileCount`.
3. `worktreeCount === (worktrees | length)`.
4. Vergleich gegen die Wahrheit: `git -C <projektpfad> worktree list` listet **genau** die
   Pfade aus `main.path` + `worktrees[].path` (abzüglich `dirState: "missing"`-Einträge, die
   aus der DB stammen) — Nachweis für SC-002.
5. Zwei aufeinanderfolgende Abrufe innerhalb von 2 s liefern denselben `collectedAt`
   (TTL-Cache); mit `?refresh=1` steigt er.

---

## Stufe 3: Manuelle End-to-End-Flows (UI)

### (a) US1 — Zuordnung Feature ↔ Worktree

1. Sidebar unten links → **Einstellungen** → **Worktree-Übersicht**.
2. **Erwartung**: Ansicht öffnet sich nach genau zwei Klicks (SC-001) und ist in < 2 s
   vollständig nutzbar (SC-003). Jedes Projekt zeigt seinen Haupt-Checkout (optisch
   abgesetzt) und alle offenen Worktrees mit Feature-Name, Branch, Pfad und
   Bearbeitungsstand.
3. Klick auf einen zugeordneten Eintrag → springt in die Feature-Konsole; das Projekt wird
   dabei zum aktiven Kontext (FR-010).

### (b) US1 — Verwaist / fehlend / Registry-Leiche

```bash
# verwaist: Worktree ohne Feature anlegen
git -C <projektpfad> worktree add /tmp/verwaister-worktree -b tmp/verwaist main

# fehlendes Verzeichnis: Worktree-Ordner eines Features hart löschen
rm -rf ~/.sdd-toolkit/worktrees/<projectId>/<feature>
```

**Erwartung**: Der verwaiste Eintrag erscheint mit „ohne Feature-Zuordnung" (FR-008); das
Feature mit gelöschtem Ordner erscheint als „Worktree-Verzeichnis fehlt" (FR-009) — **nicht**
als intakter Worktree. Ein von git noch geführter, aber verschwundener Worktree
(`registry_only`) meldet den Widerspruch und bietet **keine** Entfernen-Aktion.

Aufräumen: `git -C <projektpfad> worktree remove /tmp/verwaister-worktree --force`

### (c) US2 — Dateiebene

Im Worktree eines Features: eine bestehende Datei ändern **und** committen, eine zweite
ändern **ohne** Commit, eine dritte neu anlegen (untracked), eine vierte per
`git mv` umbenennen.

**Erwartung** nach Aufklappen des Eintrags:
- alle vier Dateien mit korrekter Änderungsart (`~`, `+`, `→` mit altem Pfad);
- committet / uncommittet / „committet + geändert" unterscheidbar (FR-013);
- die Anzahl war bereits **vor** dem Aufklappen sichtbar (FR-014);
- ein Worktree ohne jede Änderung meldet ausdrücklich „Keine Änderungen gegenüber `main`"
  (FR-015) — starker Hinweis auf einen überflüssigen Worktree;
- bei sehr vielen Dateien bleibt die Liste scrollbar und nennt die Gesamtzahl (FR-016).

### (d) US3 — Warnungen

| Aufbau | Erwartung |
|---|---|
| Dieselbe Datei in **zwei** offenen Worktrees ändern | Beide Einträge zeigen „Überschneidung" mit Dateinamen **und** dem jeweils anderen Feature (FR-017, SC-006) |
| Im Worktree Datei X ändern, dieselbe Datei auf `main` committen | Eintrag zeigt „gegenüber main veraltet" mit Nennung von X (FR-018) |
| Feature-Branch nach `main` mergen, Worktree bestehen lassen | Eintrag zeigt „bereits integriert — Worktree kann entfernt werden" (FR-019, SC-007) |
| Frischer Worktree ohne Überschneidung/Rückstand/Integration | **Keine** Warnung (FR-020) |
| Zwei Lagen gleichzeitig (Überschneidung + veraltet) | Beide Hinweise sichtbar und unterscheidbar (FR-021) |

### (e) US4 — Entfernen

1. Sauberer, bereits integrierter Worktree ohne laufende Session → „Entfernen" →
   Bestätigung nennt Feature, Branch, Pfad, Anzahl Änderungen (FR-023) → bestätigen.
   **Erwartung**: Eintrag verschwindet; `ls <pfad>` schlägt fehl;
   `git -C <projektpfad> worktree list` führt ihn nicht mehr (SC-008).
2. Worktree mit uncommitteten Änderungen → „Entfernen" → erste Bestätigung → **zweite**,
   deutlich formulierte Bestätigung mit der Anzahl uncommitteter Dateien; erst diese führt
   aus (FR-024, SC-009). Abbrechen lässt den Worktree unangetastet.
3. Worktree mit laufender Session (Feature-Konsole geöffnet und arbeitend) → Aktion ist
   gesperrt mit verständlicher Begründung (FR-025).
4. Haupt-Checkout → **keine** Entfernen-Aktion vorhanden (FR-026).
5. Fehlschlag provozieren (z. B. Worktree-Ordner währenddessen im Terminal sperren/löschen)
   → Klartext-Fehlermeldung, Übersicht lädt neu und zeigt den tatsächlichen Zustand (FR-027).

### (f) US5 — Selbstaktualisierung

1. Übersicht geöffnet lassen. In einem Terminal ein neues Feature im Toolkit anlegen
   **oder** `git -C <projektpfad> worktree add …` ausführen.
   **Erwartung**: Der Eintrag erscheint **ohne** Zutun innerhalb von 5 s (SC-004, FR-029) —
   auch bei extern (Terminal) angelegten Worktrees.
2. Ein Feature mergen lassen → der Eintrag verschwindet bzw. wird als „bereits integriert"
   markiert, ohne die Ansicht neu zu öffnen.
3. „↻ Aktualisieren" klicken → Ladefortschritt sichtbar, „Stand" springt auf die aktuelle
   Uhrzeit (FR-030, FR-031).
4. Während des Ladens werden alte Daten **nicht** als aktuell ausgegeben (Kopfzeile
   „wird aktualisiert …").

---

## Stufe 4: Robustheit / Edge Cases

| Aufbau | Erwartung | Anforderung |
|---|---|---|
| Projektordner umbenennen (Pfad existiert nicht mehr) | Nur dieser Block zeigt eine verständliche Fehlermeldung; alle anderen Projekte bleiben nutzbar | FR-032 |
| Verzeichnis ohne `.git` als Projekt | Block meldet „kein Git-Repository", kein 5xx | FR-032 |
| Gleichnamige Features in zwei Projekten | Einträge bleiben durch Projektgruppierung und Pfad eindeutig | Edge Case |
| Feature mit abweichendem `integrationTarget` | Dateiliste und Warnungen vergleichen gegen **dieses** Ziel, nicht gegen `main` | Edge Case |
| Worktree unter macOS-`/var`-Symlink (Temp-Repo) | Zuordnung greift trotzdem; **kein** falsches „verwaist" | research.md D2 |
| Wissens-Chat-Worktree (`chat-<id>`) | Erscheint als „Wissens-Chat", nicht als verwaist | research.md D3 |
| Übersicht 60 s offen lassen | Konstante Last, keine wachsende Prozesszahl (`pgrep -c git` bleibt niedrig) — TTL-Cache + Nebenläufigkeitslimit greifen | SC-003 |

---

## Abnahmekriterien (Zusammenfassung)

- [ ] SC-001: Übersicht in zwei Interaktionen erreichbar, Feature↔Worktree sofort ablesbar
- [ ] SC-002: 100 % der bestehenden Worktrees gelistet; kein entfernter wird als bestehend gemeldet
- [ ] SC-003: < 2 s bis vollständig nutzbar (10 Projekte / 30 Worktrees)
- [ ] SC-004: Anlegen/Entfernen wird ≤ 5 s ohne Nutzerzutun sichtbar
- [ ] SC-005: Geänderte Dateien und deren Anzahl ohne Terminal feststellbar
- [ ] SC-006: Jede doppelt geänderte Datei ist als Überschneidung markiert, mit beteiligten Features
- [ ] SC-007: Jeder integrierte Branch mit Worktree ist als bereinigungsfähig gekennzeichnet
- [ ] SC-008: Entfernen vollständig innerhalb der Anwendung möglich
- [ ] SC-009: Kein Verlust uncommitteter Arbeit ohne Warnung **und** zusätzliche Bestätigung
- [ ] SC-010: Alle Ausnahmefälle sind gekennzeichnet oder begründet — nie stille Auslassung
