# Quickstart — Validierung: Dokument-Upload bei manueller Feature-Erfassung

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/](./contracts/)

Diese Datei beschreibt, wie das fertige Feature end-to-end nachgewiesen wird — welche
Läufe, welche Beobachtung, welches erwartete Ergebnis. Keine Implementierung.

---

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install`)
- Ein im Toolkit registriertes Projekt mit spec-kit-Struktur (`.specify/`)
- **Wichtig**: Für manuelle Durchläufe eine eigene Instanz auf freien Ports starten —
  nicht 4820/4830 (die gehören der laufenden Toolkit-Instanz, siehe `CLAUDE.md`).
  Die eigene Instanz anschließend gezielt über ihren Port beenden:
  `lsof -ti:<port> | xargs -r kill`

---

## Automatisierte Prüfung

```sh
pnpm typecheck                       # alle Pakete
pnpm -r test                         # Vitest: packages/shared + packages/server
pnpm --filter @sdd/shared test       # nur die puren Bausteine (Preamble, Grenzen)
pnpm --filter @sdd/server test       # Routen, Ablage, Dateinamen-Härtung
```

Erwartete neue Testdateien (Web hat konventionsgemäß kein Test-Harness):

| Datei | Deckt ab |
|---|---|
| `packages/shared/src/featureDocuments.test.ts` | Preamble-Format specify vs. übrige Phasen, leerer String ohne Dokumente, kein Dateiinhalt im Text (FR-006/007/009/017) |
| `packages/server/src/services/safeFilename.test.ts` | `..`, Separatoren, führende Punkte, Steuerzeichen, Länge, Kollisions-Suffixe (FR-005) |
| `packages/server/src/services/featureDocuments.test.ts` | Schreiben + Manifest + Commit, Ablehnungsgründe, Teilfehler, Listen aus Manifest (FR-003/011/012/014/016) |
| `packages/server/src/services/orchestrator.test.ts` (erweitert) | Verweis in jedem Phasenstart, auch nach Reset; zeichengleicher Prompt ohne Dokumente (FR-007/008/017, SC-003/006) |
| `packages/server/src/api/server.test.ts` (erweitert) | Contract der drei neuen Routen, Reihenfolge-Guard, kein Schreiben bei fehlgeschlagener Anlage (FR-015) |

---

## Szenario 1 — Dokument mitgeben und in der Spezifikation wiederfinden (US1, P1)

Deckt ab: FR-001…FR-006, FR-010, SC-002, SC-004.

1. Eine Testdatei mit einer **eindeutigen Anforderung** anlegen, die im Beschreibungstext
   nicht vorkommt — z. B. `anforderung.md` mit dem Satz
   „Die Kundennummer ist immer 9-stellig und beginnt mit `K`."
2. In der Seitenleiste **Neues Feature** öffnen, Name `kundenimport` eintragen,
   Beschreibung leer lassen (prüft zugleich FR-010).
3. `anforderung.md` per Dateiauswahl **und** eine zweite Datei per Drag & Drop in den
   Dialog ziehen.
4. **Beobachtung vor dem Anlegen**: Beide Dateien erscheinen mit Name und Größe; die
   Grenzen (25 MB je Datei, 20 Dokumente) sind im Dialog lesbar (FR-002, FR-018).
5. **Anlegen** klicken.

**Erwartetes Ergebnis**

- Branch, Worktree und Feature-Konsole entstehen wie bisher.
- Im Worktree liegt `specs/kundenimport/docs/` mit beiden Dateien; ein Byte-Vergleich mit
  den Originalen ist identisch (SC-002):
  ```sh
  diff anforderung.md "<worktree>/specs/kundenimport/docs/anforderung.md" && echo identisch
  ```
- `git -C <worktree> log --oneline -1` zeigt den Dokument-Commit (R1).
- In der Feature-Konsole steht im gesendeten Prompt der Block
  `[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt …` mit der Schlusszeile
  „Verwende dieses Material als Ausgangsbasis der Spezifikation." (FR-006).
- Nach Abschluss des Specify-Laufs enthält `specs/kundenimport/spec.md` die
  9-stellige-Kundennummer-Anforderung (SC-004).

---

## Szenario 2 — Verweis bleibt über alle Schritte erhalten (US2, P2)

Deckt ab: FR-007, FR-008, SC-003.

1. Feature aus Szenario 1 weiterlaufen lassen: `plan`, `tasks`, `implement` nacheinander
   starten (oder Auto-Progress aktivieren).
2. Vor dem `plan`-Schritt die Kontext-Optimierung auf `compact` bzw. `fresh` stellen
   (Feature-Einstellungen → Optimierung), damit ein Reset zwischen zwei Schritten liegt.
3. Jeden gesendeten Prompt in der Konsole prüfen.

**Erwartetes Ergebnis**

- **Jeder** Phasenstart enthält den `[Dokumente]`-Block mit derselben Liste und Fundorten,
  auch der Schritt direkt nach `/compact` bzw. `/clear` (FR-008).
- Ab `plan` lautet die Schlusszeile „Berücksichtige dieses Material bei diesem Schritt …".
- Der Block enthält **keinen** Dateiinhalt (FR-009) — Gegenprobe: die Prompt-Länge wächst
  nicht mit der Dateigröße. Eine 20-MB-Datei erzeugt denselben Blocktext wie eine 2-KB-Datei,
  abgesehen von der Größenangabe.

**Nach der Integration** (US2-AS4, SC-007): Feature integrieren und mergen. Im Zielbranch
liegt `specs/kundenimport/docs/` mit den Dokumenten und `documents.json` — nachvollziehbar,
welches Material der Umsetzung zugrunde lag. `GET /api/features/:id/documents` liefert die
Liste weiterhin, obwohl der Worktree entfernt ist.

---

## Szenario 3 — Auswahl korrigieren, Grenzen, Kollisionen, Ansicht (US3, P3)

Deckt ab: FR-002, FR-005, FR-011, FR-012, FR-016, SC-001, SC-005.

Vorbereitung:

```sh
mkdir -p /tmp/doc-test && cd /tmp/doc-test
mkdir -p a b
printf 'Version A' > a/bericht.txt
printf 'Version B' > b/bericht.txt         # gleicher Name, anderer Inhalt
: > leer.txt                                # 0 Byte
mkfile 30m zu-gross.bin 2>/dev/null || head -c 31457280 /dev/urandom > zu-gross.bin
```

1. Dialog öffnen, Name `grenztest` eintragen.
2. Vier Dateien wählen: `a/bericht.txt`, `b/bericht.txt`, `leer.txt`, `zu-gross.bin`.
3. Eine beliebige weitere Datei hinzufügen und wieder **entfernen**.
4. Feature anlegen.

**Erwartetes Ergebnis**

- Beim Entfernen verschwindet genau diese eine Datei aus der Liste, die übrigen bleiben
  (FR-002).
- `leer.txt` und `zu-gross.bin` werden gemeldet — mit Dateiname und Grenze
  („zu groß (30.0 MB, max. 25 MB)", „leere Datei (0 Byte)") — und blockieren das Anlegen
  **nicht** (FR-011, FR-012, SC-005).
- Beide `bericht.txt` liegen unterscheidbar im Worktree: `bericht.txt` und `bericht-2.txt`,
  mit den korrekten, unterschiedlichen Inhalten — keine stille Überschreibung (FR-005).
- Am angelegten Feature ist die Dokumentliste einsehbar; ein Klick öffnet das Dokument mit
  der Systemanwendung (FR-016).
- Der gesamte Vorgang vom Öffnen des Dialogs bis zur angelegten Feature-Konsole dauert
  unter 60 Sekunden (SC-001).

**Pfad-Härtung** (FR-005) — ohne Browser prüfbar, da der Dateiname aus dem
multipart-Body stammt:

```sh
curl -sS -X POST "http://localhost:<port>/api/projects/<projectId>/features/with-documents" \
  -F "name=pfadtest" \
  -F "description=" \
  -F "files=@/etc/hostname;filename=../../../../tmp/entkommen.txt"
```

Erwartung: `200` mit einem Dokument, dessen `storedName` keine Pfadanteile mehr enthält;
`/tmp/entkommen.txt` existiert **nicht**; die Datei liegt ausschließlich unter
`specs/pfadtest/docs/`.

---

## Szenario 4 — Ohne Dokumente ändert sich nichts (FR-017, SC-006)

1. Feature `ohne-docs` mit Name und Beschreibung anlegen, **keine** Datei auswählen.

**Erwartetes Ergebnis**

- Der Netzwerk-Aufruf geht an `POST /api/projects/:id/features` (JSON) — nicht an die
  multipart-Route (R9; im Browser-Netzwerk-Tab sichtbar).
- Es entsteht **kein** `specs/ohne-docs/docs/`-Ordner und kein zusätzlicher Commit.
- Der an die Session gesendete Prompt ist zeichengleich mit dem vor dieser Erweiterung:
  `/speckit-specify specs/ohne-docs <Beschreibung>` + Vorlagen-Hinweis, kein
  `[Dokumente]`-Block, kein leerer Abschnitt.

Diese Gleichheit wird zusätzlich als Test festgehalten (`orchestrator.test.ts`), damit sie
nicht durch eine spätere Änderung still verlorengeht.

---

## Szenario 5 — Fehlerfälle beim Anlegen (FR-014, FR-015)

1. **Name existiert bereits**: Ein Feature `kundenimport` (aus Szenario 1) erneut mit
   demselben Namen und einer Datei anlegen.
   **Erwartet**: Fehlermeldung „Feature 'kundenimport' existiert bereits"; im vorhandenen
   Worktree ist **keine** neue Datei aufgetaucht, kein verwaister Ordner entstanden
   (FR-015).
2. **Schreibfehler simulieren**: Nach dem Anlegen den `docs/`-Ordner schreibgeschützt
   setzen (`chmod 500`) und den Vorgang mit einem weiteren Feature wiederholen, dessen
   Zielordner ebenso geschützt ist.
   **Erwartet**: Das Feature ist angelegt und die Konsole nutzbar; die Meldung nennt
   konkret, welche Dokumente nicht übernommen wurden (FR-014).

Aufräumen: `rm -rf /tmp/doc-test` und die Testfeatures im Toolkit löschen.
