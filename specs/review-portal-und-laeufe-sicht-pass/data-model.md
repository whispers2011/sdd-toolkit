# Phase 1 — Datenmodell: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Feature**: `review-portal-und-laeufe-sicht-pass` · **Datum**: 2026-07-30
**Spec**: [spec.md](./spec.md) · **Entscheidungen**: [research.md](./research.md)

Dieses Feature führt **keinen neuen Datenbestand** ein: keine Tabelle, keine Migration, kein
Feld an der HTTP- oder WS-Schnittstelle. Alle Entitäten sind **abgeleitete Sichten** auf Daten,
die das Portal bzw. die Läufe-Ansicht heute schon lädt, plus **Anzeigezustände**, die nur zur
Laufzeit im Browser existieren.

---

## 1. Änderungsübersicht (abgeleitet, ohne Persistenz)

**Quelle**: `DiffSummary` aus `GET /api/features/:id/diff` (`packages/web/src/api.ts:530`) —
bereits ab `ReviewPortal.tsx:62` geladen. Kein zusätzlicher Abruf (FR-006, SC-009).

### Eingabe

| Feld | Typ | Herkunft / Bedeutung |
|---|---|---|
| `files[].path` | `string` | Repo-relativer POSIX-Pfad |
| `files[].additions` | `number` | hinzugefügte Zeilen; bei Binärdateien `0` |
| `files[].deletions` | `number` | entfernte Zeilen; bei Binärdateien `0` |
| `files[].binary` | `boolean` | git weist die Datei als binär aus |
| `commits[].sha` | `string` | vollständiger Hash |
| `commits[].date` | `number` | Unix-Millisekunden |
| `commits[].subject` | `string` | Betreffzeile |

### Abgeleitete Felder

| Feld | Regel |
|---|---|
| `totals.files` | `files.length` |
| `totals.additions` / `totals.deletions` | Summe über alle Dateien |
| `totals.binaryFiles` | Anzahl `files` mit `binary === true` |
| `totals.commits` | `commits.length` |
| `volume(file)` | `additions + deletions` — Sortiermass, **kein** Ausgabefeld |
| `groups[]` | die **höchstens 10** umfangreichsten Dateien, gruppiert nach `groupKey` |
| `groups[].key` | Gruppenschlüssel nach D2 |
| `groups[].additions` / `.deletions` | Summe **der in der Gruppe gezeigten** Dateien |
| `hiddenFiles` | `max(0, files.length − 10)` → Restzeile „+N weitere Dateien" |
| `recentCommits[]` | die **höchstens 3** jüngsten Commits, jüngster zuerst |
| `hasChanges` | `files.length > 0` |
| `hasCommits` | `commits.length > 0` |

### Gruppenschlüssel (D2)

| Pfad | Segmente | Schlüssel |
|---|---|---|
| `packages/web/src/components/X.tsx` | ≥ 3 | `packages/web` |
| `specs/foo/spec.md` | 3 | `specs/foo` |
| `docs/x.md` | 2 | `docs` |
| `README.md` | 1 | `(Wurzel)` |

### Invarianten

- **I1**: `groups` enthält zusammen **höchstens 10** Dateien; `hiddenFiles` zählt genau die
  nicht gezeigten. Summe = `totals.files`.
- **I2**: Sortierung ist **deterministisch**: Umfang absteigend, bei Gleichstand Pfad
  aufsteigend (lexikografisch). Gleiche Eingabe ⇒ gleiche Ausgabe.
- **I3**: Gruppen sind nach ihrer gezeigten Summe absteigend sortiert, bei Gleichstand
  Schlüssel aufsteigend.
- **I4**: `recentCommits.length ≤ 3` und `≤ totals.commits`; absteigend nach `date`.
- **I5**: Binärdateien behalten `additions === 0 && deletions === 0` und tragen `binary`; die
  Anzeige schreibt **„binär"** statt einer Zeilenbilanz (FR-003).
- **I6**: Die Funktion ist **pur** — kein `Date.now()`, kein Zugriff auf DOM oder Netz; die
  Eingabe wird nicht verändert.
- **I7**: `hasChanges === false` ⇒ `groups` leer, `hiddenFiles === 0`, alle Summen `0`.

### Zustände der Anzeige

| Zustand | Bedingung | Aussage in der Mitte |
|---|---|---|
| lädt | `summary === null` | „Lade Änderungen …" (kein eigener Ladeschritt, D4) |
| leer | `hasChanges === false` | „Keine Änderungen gegenüber `<Ziel-Branch>`." (FR-005) |
| ohne Commits | `hasChanges && !hasCommits` | Dateiteil normal, Commit-Teil benennt das Fehlen |
| vollständig | `hasChanges && hasCommits` | Kennzahlen + Gruppen + Restzeile + 3 Commits |
| Datei gewählt | `selectedFile !== null` | Diff **an derselben Stelle** (FR-004) |

---

## 2. Prüfstand der rechten Spalte (Anzeigezustand, ohne Persistenz)

Kein gespeicherter Wert — ein Zustand, der sich aus dem Abruf `GET
/api/features/:id/agent-runs` und dessen Fehler ergibt.

| Zustand | Bedingung (Portal-State) | Aussage (FR-007 – FR-009) |
|---|---|---|
| Fehler | `runsError !== null` | „Audits konnten nicht geladen werden." + Grund |
| lädt | `runsError === null && runs === null` | „Lade Audits …" |
| keine Läufe | `runs !== null && runs.length === 0` | benannter Zustand **und** Bedeutung: niemand hat geprüft, das eigene Urteil ist das einzige Gate |
| Läufe vorhanden | `runs.length > 0` | Gruppen nach Auslöser, Urteil je Lauf |

**Invarianten**

- **I8**: Die drei Zustände Fehler / lädt / keine Läufe sind **paarweise verschieden
  formuliert** und schliessen sich aus (Prüfreihenfolge wie in der Tabelle).
- **I9**: Ein Fehler beendet den Ladezustand endgültig — kein dauerhaftes „Lade Audits …"
  (FR-009).
- **I10**: `verdict === null` („unklar") zählt **nie** in `passed` (FR-011); nur `'PASS'` zählt.
- **I11**: Der Kommentarbereich benennt den leeren Fall eigenständig (FR-010) — bereits
  vorhanden (`CommentsPanel.tsx:96–100`), gilt als Invariante, nicht als Neubau.

---

## 3. Herkunft einer Verbrauchszahl (bestehend, inhaltlich unverändert)

`ExecutionInfo['tokensSource'] ∈ { 'telemetry', 'transcript', 'parsed', 'estimated' }` — Wert,
Ermittlung und Vorrangregel (`dominantSource`) bleiben **unangetastet** (FR-018). Gegenstand
sind nur Beschriftung und Darstellung:

| Wert | Etikett (neu) | Etikett (alt) | Farbmittel |
|---|---|---|---|
| `telemetry` | **gemeldet** | von der CLI gemeldet | teal (kräftig, mit Ring) |
| `transcript` | gemessen | gemessen | emerald |
| `parsed` | geparst | geparst | sky |
| `estimated` | geschätzt | geschätzt | zinc |

**Invarianten**

- **I12**: Vier Werte, vier **einzelne** Wörter auf derselben sprachlichen Ebene (FR-017).
- **I13**: `telemetry` bleibt von `transcript` **farblich** unterscheidbar — in beiden Modi
  (FR-018, FR-019); die vollständige Aussage steht im `title` (D13).
- **I14**: Die Aggregatzeile trennt weiter „% gemessen" (telemetry + transcript) von
  „% gemeldet" (nur telemetry) — unverändert.

---

## 4. Darstellungs-Ton eines Diagramm-Segments (neu, rein darstellend)

Ersetzt den Hex-String in `Segment` (D9). Kein Datenwert, sondern die Bindung einer Bedeutung
an eine Skalenstufe.

| Feld | Typ | Bedeutung |
|---|---|---|
| `bg` | `string` (literale Tailwind-Klasse) | Fläche: Balken, Legendenpunkt |
| `stroke` | `string` (literale Tailwind-Klasse) | Ring: Donut-Segment, Fortschrittsring |

Belegung (Stufen nach der Regel aus D6):

| Bedeutung | Ton | vorher |
|---|---|---|
| Spezifikation | `sky-400` | `#38bdf8` |
| Coding | `emerald-400` | `#34d399` |
| Overhead | `amber-300` | `#fbbf24` (amber-400 — 2.98:1 im Hellmodus) |
| Chat | `violet-400` | `#c084fc` (purple — Skala nicht invertiert) |
| Input | `sky-400` | `#38bdf8` |
| Output | `emerald-400` | `#34d399` |
| Cache-Read | `zinc-500` | `#52525b` (zinc-600 — 2.4:1) |
| Cache-Write | `amber-300` | `#f59e0b` |
| Spur / Rest | `zinc-800` | `#27272a` |
| Ring vollständig / unvollständig | `emerald-400` / `amber-300` | `#10b981` / `#f59e0b` |

**Invarianten**

- **I15**: Klassennamen sind **vollständig ausgeschrieben** (kein Template-String), damit der
  Tailwind-Scanner sie findet (D9).
- **I16**: Jede Fläche erreicht ≥ 3:1 gegen ihren Hintergrund in **beiden** Modi (Messwerte in
  [research.md](./research.md), D6).
- **I17**: Benachbarte Segmente eines gestapelten Balkens bleiben unterscheidbar; Reihenfolge
  der Segmente bleibt wie heute.
