# Contract: Öffentliche API der Änderungsübersicht

**Modul**: `packages/shared/src/changeOverview.ts`, re-exportiert über
`packages/shared/src/index.ts` (`export * from './changeOverview.js'`)
**Konsumenten**: `packages/web/src/components/review/ChangeOverview.tsx`, Tests in `shared`
**Datenmodell**: [../data-model.md](../data-model.md) · **Entscheidungen**: [../research.md](../research.md)

Reine Funktion über bereits geladene Daten — keine HTTP-Oberfläche, kein Wire-Format, keine
Persistenz. Der Vertrag ist der exportierte Typ plus die Invarianten.

---

## 1. Exportierte Typen

```ts
/** Eine geänderte Datei, wie sie der Diff-Abruf des Portals liefert. */
export interface ChangeFile {
  /** Repo-relativer POSIX-Pfad. */
  path: string;
  /** Hinzugefügte Zeilen; bei Binärdateien 0. */
  additions: number;
  /** Entfernte Zeilen; bei Binärdateien 0. */
  deletions: number;
  /** true, wenn git die Datei als binär ausweist. */
  binary: boolean;
}

/** Ein Commit des Features. */
export interface ChangeCommit {
  sha: string;
  /** Unix-Millisekunden. */
  date: number;
  subject: string;
}

/** Eingabe: strukturell erfüllt von `DiffSummary` aus `packages/web/src/api.ts`. */
export interface ChangeOverviewInput {
  files: readonly ChangeFile[];
  commits: readonly ChangeCommit[];
}

/** Eine Gruppe gezeigter Dateien (Paket bzw. Verzeichnis). */
export interface ChangeGroup {
  /** Gruppenschlüssel nach `overviewGroupKey`. */
  key: string;
  /** Nur die in der Übersicht gezeigten Dateien, Umfang absteigend. */
  files: readonly ChangeFile[];
  /** Summe über `files` dieser Gruppe. */
  additions: number;
  deletions: number;
}

export interface ChangeOverview {
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
    commits: number;
  };
  /** Höchstens MAX_OVERVIEW_FILES Dateien über alle Gruppen zusammen. */
  groups: readonly ChangeGroup[];
  /** Anzahl nicht gezeigter Dateien → Restzeile. 0, wenn alles gezeigt wird. */
  hiddenFiles: number;
  /** Höchstens MAX_OVERVIEW_COMMITS, jüngster zuerst. */
  recentCommits: readonly ChangeCommit[];
  hasChanges: boolean;
  hasCommits: boolean;
}

export const MAX_OVERVIEW_FILES = 10;
export const MAX_OVERVIEW_COMMITS = 3;

/** Schlüssel für Wurzeldateien. */
export const ROOT_GROUP_KEY = '(Wurzel)';
```

## 2. Exportierte Funktionen

```ts
/**
 * Gruppenschlüssel eines Pfades: erste zwei Segmente bei ≥ 3 Segmenten,
 * sonst das erste Segment, bei Dateien in der Wurzel ROOT_GROUP_KEY.
 */
export function overviewGroupKey(path: string): string;

/** Baut die Übersicht. Pur: verändert die Eingabe nicht, liest keine Uhr. */
export function buildChangeOverview(input: ChangeOverviewInput): ChangeOverview;
```

## 3. Vertragsregeln

| # | Regel | Bezug |
|---|---|---|
| R1 | `groups` enthalten zusammen **höchstens** `MAX_OVERVIEW_FILES` Dateien; `hiddenFiles + Σ groups[].files.length === totals.files`. | Klärung, FR-002 |
| R2 | Dateien werden nach `additions + deletions` **absteigend**, bei Gleichstand nach `path` **aufsteigend** sortiert. Gleiche Eingabe ⇒ gleiche Ausgabe. | I2 |
| R3 | Gruppen nach eigener gezeigter Summe absteigend, bei Gleichstand `key` aufsteigend. | I3 |
| R4 | `recentCommits` sind die jüngsten nach `date`, absteigend, höchstens `MAX_OVERVIEW_COMMITS`. Die Funktion **verlässt sich nicht** auf die Sortierung der Eingabe. | I4 |
| R5 | Binärdateien behalten `additions === 0 && deletions === 0` und `binary === true`; die Funktion erfindet keine Zeilenzahlen. | FR-003, I5 |
| R6 | `files: []` ⇒ `hasChanges === false`, `groups: []`, `hiddenFiles === 0`, alle Summen `0`. | FR-005, I7 |
| R7 | `commits: []` ⇒ `hasCommits === false`, `recentCommits: []`; der Dateiteil bleibt vollständig. | Edge Case „ohne Commits" |
| R8 | Pur: kein `Date.now()`, kein DOM, kein Netz; Eingabe-Arrays werden nicht mutiert (Sortierung auf Kopien). | I6 |
| R9 | Negative oder fehlende Zahlen werden **nicht** korrigiert und nicht geworfen — die Funktion rechnet mit dem, was sie bekommt (Anzeige ist kein Validierungsort). | — |

## 4. Testbare Fälle (Mindestdeckung `changeOverview.test.ts`)

| Fall | Erwartung |
|---|---|
| 14 Dateien (Massstab 30.07.) | 10 gezeigt, `hiddenFiles === 4` |
| 90 Dateien | 10 gezeigt, `hiddenFiles === 80`, Kopfzahlen über **alle** 90 |
| genau 10 Dateien | `hiddenFiles === 0` |
| Gleichstand im Umfang | Pfad-Sortierung entscheidet, Ergebnis stabil über zwei Aufrufe |
| Pfade aller vier Formen | Schlüssel `packages/web`, `specs/foo`, `docs`, `(Wurzel)` |
| Gruppenreihenfolge | Gruppe mit grösserer gezeigter Summe zuerst |
| Binärdatei | `binary` erhalten, `0/0`, kein Ausschluss aus der Zählung |
| nur Binärdateien | `hasChanges === true`, Summen `0`, `binaryFiles === totals.files` |
| 0 Dateien | R6 vollständig |
| 0 Commits, Dateien vorhanden | R7 |
| 5 Commits unsortiert | die 3 jüngsten, absteigend |
| Eingabe unverändert | Referenzvergleich der Eingabe-Arrays vor/nach Aufruf |
