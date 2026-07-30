# Abnahmeprotokoll: Ehrlichkeit vor dem Merge

**Datum**: 30.07.2026 · **Branch**: `feature/ehrlichkeit-vor-dem-merge`

Durchgeführt nach [quickstart.md](./quickstart.md). Eigene Instanz, eigenes Datenverzeichnis,
eigenes Probe-Repo; danach ausschließlich über die eigenen Ports abgeräumt.

## 0. Ports: Abweichung von der Vorgabe

`quickstart.md` nennt 4899/4898. **Beide waren belegt** — von der Testinstanz eines parallel
laufenden Feature-Worktrees (`plausibilitaetspruefung`, seit 18:07, eigenes Datenverzeichnis).
Der erste Startversuch scheiterte deshalb mit `EADDRINUSE`, während Vite auf 4899 auswich; die
ersten Anfragen liefen dadurch gegen die **fremde** Instanz. Das dort versehentlich angelegte
Projekt wurde sofort wieder entfernt, der fremde Stand ist unverändert.

Gelaufen ist die Abnahme dann auf **4875 (API) / 4874 (Web)** mit
`SDD_DATA_DIR=/tmp/sdd-abnahme-ehrlichkeit`. Vor jeder Prüfung wurde über die Prozess-Umgebung
belegt, dass die Ports der eigenen Instanz gehören.

> **Für quickstart.md**: feste Portnummern taugen auf diesem Rechner nicht — vor dem Start prüfen
> (`lsof -ti:PORT`) und einen freien Port wählen. Vite weicht bei belegtem Port stumm aus und kann
> dabei den API-Port des eigenen Servers besetzen.

## 0b. Voraussetzungen

- `pnpm install` war nötig (der Worktree hatte keine `node_modules`)
- `pnpm typecheck` grün · `pnpm test` grün (shared 426, server 552)

## 1. Sichtprüfung A — Projekt ohne Verifikation

| # | Prüfung | Ergebnis |
|---|---|---|
| A.1 | Board/Sidebar nennt die Stufe im Klartext | ✅ „wartet auf menschliches Review" statt Rohbezeichner (Sidebar-Leck aus T039 behoben) |
| A.2 | Genau **ein** Eintrag „Verifikation fehlt" ⚠ amber | ✅ mit dem Wortlaut aus FR-004, `featureId === null` |
| A.2b | Zweites Feature integrieren ⇒ kein weiterer Eintrag | ✅ bleibt bei einem (FR-005) |
| A.3 | Review-Übersicht zeigt `Verify nicht konfiguriert` | ✅ amber, sichtbar anders als `Verify ✓` in derselben Liste |
| A.4 | Reiter *Tests*: Lücke benannt statt leerer Ansicht | ✅ „Für dieses Projekt ist keine Verifikation konfiguriert — es wurde nichts geprüft." |
| A.4b | Kopfzeile `Verify nicht konfiguriert` | ✅ ohne Reiterwechsel sichtbar |
| A.5 | Meldung „Review fällig" ohne „verifiziert" | ✅ „keine Verifikation konfiguriert — es wurde nichts geprüft; bereit für dein Review & Merge · 68/76 erledigt, 8 offen" |
| A.6 | Durchlauf ungehindert bis „gemergt" | ✅ `awaiting_human_review → queued → merged`, Commit liegt in `main` (SC-005) |
| A.7 | Verify-Kommando hinterlegen ⇒ Eintrag ohne Zutun weg | ✅ 1 → 0 ohne Abhaken, Stufen unverändert (FR-007) |
| A.8 | Eintrag übersteht die Stufenwanderung bis `merged` | ✅ noch offen, nachdem ein Feature durchgemergt war (FR-006) |

**Gegenprobe FR-011** (Projekt **mit** Verify-Kommando, in derselben Inbox nebeneinander sichtbar):
„drittes-feature: verifiziert — bereit für dein Review & Merge · 40/50 erledigt, 10 offen" —
der Teil vor `·` ist **zeichengleich** mit dem in T001 gesicherten Wortlaut (INV-4). Kein
Aufmerksamkeits-Eintrag für dieses Projekt.

**Edge Cases**, zusätzlich live geprüft:

- Kommandos nach grünem Lauf entfernt ⇒ die Zeile mit Lauf behält `Verify ✓`, die anderen fallen
  auf `unconfigured` zurück (R4.1)
- Leeren allein erzeugt **keinen** Eintrag — erst der nächste Integrationsversuch (FR-004)
- nach Konfigurieren + erneutem Leeren entsteht der Eintrag wieder
- Abhaken lässt Stufe und Meldung unverändert; kein neuer Eintrag (R3.4, Clarification)
- zwei unkonfigurierte Projekte werden auseinandergehalten

## 2. Sichtprüfung B — Aufgabenstand an der Entscheidungsstelle

| # | Prüfung | Ergebnis |
|---|---|---|
| B.1 | Meldung nennt `68/76 erledigt, 8 offen` | ✅ |
| B.2 | Portal-Kopfzeile `Aufgaben 40/50`, offene amber | ✅ ohne Reiterwechsel, ohne Klick (FR-014/FR-015) |
| B.2b | Vollständige Liste ohne Hervorhebung | ✅ `Aufgaben 5/5` neutral |
| B.3 | Freigabe funktioniert unverändert | ✅ „Freigeben & Integrieren" aktiv, Merge lief durch (FR-016) |
| B.4 | Übersicht zeigt den Stand je Zeile | ✅ `5/5` · `40/50` (amber) · `1/1` |

Nicht per Auge geprüft, weil ohne echten Agenten-Lauf nicht herstellbar: der Auto-Merge-Pfad
(B.7) und der Fall ohne `tasks.md`. Beide Texte stammen aus `mergedNotificationBody` bzw.
`taskProgressText` und sind in `integrationMessages.test.ts` zeichengenau abgedeckt.

## 3. Sichtprüfung C — Läufe mit Bezugsgrösse

| # | Prüfung | Ergebnis |
|---|---|---|
| C.1 | Aufgabenstand ohne Aufklappen | ✅ `40/50 Aufgaben` in der Zeile |
| C.2/C.4/C.5 | Kosten pro Aufgabe, Strich wo unbestimmbar | ✅ `— / Aufgabe · unvollständig` (kein Betrag gemeldet ⇒ Strich, nicht 0; INV-6/FR-021) |
| C.3 | Dashboard nennt denselben Wert | ✅ `Aufgaben 40/50   Kosten — / Aufgabe · unvollständig` — dieselbe Funktion (FR-019) |
| C.8 | Feature-Dashboard erbt die Anzeige | ✅ strukturell: dieselbe `RunCard`-Komponente (`FeatureDashboard.tsx:105`) |

Die Betrags-Variante (`Kosten/Aufgabe` als Zahl) war nicht herstellbar — in dieser Instanz meldete
keine Ausführung einen Betrag. Die Division ist über `runSummary.test.ts` abgedeckt (u. a.
6 800 000 / 68 = 100 000).

`/api/runs` trug `tasksDone: 40`, `tasksTotal: 50` **ohne Server-Änderung** (contracts/http.md §5).

## 4. Abschlussprüfung SC-008 (keine neue Erhebung)

Gegen den Abzweigpunkt (`git merge-base main HEAD`) statt gegen `main` — `main` ist inzwischen
weitergelaufen, ein `git diff main` zeigt dessen Änderungen mit und ist als Nachweis unbrauchbar:

- `packages/server/src/telemetry`, `costMeter.ts`, `transcriptUsage.ts`, `telemetryAttribution.ts`,
  `db/database.ts` — **keine Ausgabe** ✅
- neue Route in `server.ts` — **keine** ✅ (`server.ts` ist gar nicht angefasst)
