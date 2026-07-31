# Messwerte der Browser-Prüfung

**Feature**: `review-portal-und-laeufe-sicht-pass` · **Datum**: 2026-07-31
**Prüfinstanz**: Vite auf `http://localhost:4880` (eigener freier Port, `--strictPort`),
API per Proxy auf den laufenden Server 4820 · Chromium, Fensterbreite 1600 px
(Tabellenprüfung 1280 px) · Belege: siehe Dateien in diesem Ordner

Soll aus FR-013 / C1: **Text 4.5:1**, **Zeilennummern und Abschnittsköpfe 3:1**,
**Grafikflächen 3:1**, **Schrift ≥ 12 px**, **Kennzahlen 14 px**, **Marker ≥ 10 px**.
Rechenwerte zum Vergleich aus [research.md](../research.md) D6.

---

## Zur Messmethode: das Schnipsel aus quickstart.md Stufe 3a ist für diesen Stack unbrauchbar

Das dort abgedruckte Schnipsel liest `getComputedStyle(el).color` und zieht mit
`s.match(/\d+(\.\d+)?/g)` die ersten drei Zahlen als R/G/B heraus. Tailwind v4 liefert
Farben aber als **`oklch(0.746 0.16 232.661)`** — die drei Zahlen sind Lightness, Chroma und
Hue, keine RGB-Kanäle. Ergebnis: Verhältnisse um **1.0** für offensichtlich gut lesbaren Text.

Ersetzt durch eine Messung, die dieselbe WCAG-Formel benutzt, die Farbwerte aber über ein
**1×1-Canvas** in echte sRGB-Bytes auflöst und dabei die Deckschichten (`emerald-950/60` &
Co.) in der richtigen Reihenfolge übereinanderlegt. Alle Werte unten stammen aus dieser
Messung. **Empfehlung**: das Schnipsel in quickstart.md ersetzen, sonst misst die nächste
Prüfung wieder Unsinn.

---

## 1. Diff (US2) — `portal-diff-dark.png`, `portal-diff-light.png`

Datei mit 42 hinzugefügten und 16 entfernten Zeilen, `ReviewPortal.tsx`.

| Element | Soll | dunkel | hell | Rechenwert D6 | Urteil |
|---|---|---|---|---|---|
| Fläche | folgt der Skala | `rgb(9,9,11)` | `rgb(250,250,250)` | zinc-950 | erfüllt |
| Kontextzeile | 4.5 | **7.59** | **7.41** | 7.4–7.6 | erfüllt |
| Hinzugefügte Zeile | 4.5 | **11.36** | **5.23** | 11.42 / 5.23 | erfüllt |
| Entfernte Zeile | 4.5 | **9.72** | **6.05** | 9.75 / 6.05 | erfüllt |
| Zeilennummer | 3 | **4.12** | **4.63** | 4.12 / 4.63 | erfüllt |
| Abschnittskopf `@@` | 3 | **8.51** | **3.79** | 8.27 / 3.73 | erfüllt |
| Schriftgrösse Code | ≥ 12 px | 12 px | 12 px | — | erfüllt |

Vorher trug die Fläche den festen Wert `#0a0a0c` und blieb im Hellmodus schwarz;
die Zeilennummern standen auf `zinc-600` = **2.57:1**.

**Moduswechsel bei offenem Diff**: Fläche folgt sofort, Scroll-Position 400 → 400,
kein Neuladen (FR-026, US2-AS2/AS6).

**Ohne Farbwahrnehmung** (`portal-diff-graustufen.png`, SC-005): add- und del-Zeilen bleiben
am führenden `+`/`-` unterscheidbar; der Filter wurde nach der Aufnahme zurückgesetzt.

### Offener Punkt: Kommentar-Markierung im Hellmodus

`ring-1 ring-sky-500` (C5, FR-015) misst gegen die **neue helle** Fläche:

| | dunkel | hell | Soll (C1, Grafik) |
|---|---|---|---|
| `ring-sky-500` auf `zinc-950` | 7.18 | **2.66** | 3 |

C5 legt genau diese Klasse fest („bleibt", Begründung: Stufe 500 ist in beiden Modi mittig).
Das stimmt gegen mittlere Flächen — gegen `#fafafa` reicht es nicht. **Unverändert gelassen**,
weil der Vertrag die Klasse ausdrücklich benennt; zur Entscheidung vorgelegt. `ring-sky-400`
(im Hellmodus `#0284c7`) würde das Soll erfüllen, ohne die Textfarbe anzufassen.

---

## 2. Rechte Portal-Spalte (US3) — `portal-ohne-laeufe*.png`, `portal-laeufe-laedt.png`, `portal-laeufe-fehler.png`

| Element | Soll | dunkel | hell | Urteil |
|---|---|---|---|---|
| Fehlersatz (`amber-300`) | 4.5 | **13.32** | — | erfüllt |
| Fehlergrund (`zinc-400`) | 4.5 | **7.35** | — | erfüllt |
| `VerdictPill` PASS | 4.5 | **7.54** | — | erfüllt |
| `VerdictPill` FAIL | 4.5 | **6.31** | — | erfüllt |
| `VerdictPill` unklar | 4.5 | **5.68** | — | erfüllt |
| Entscheidungs-Etikett | 4.5 | **13.32** | — | erfüllt |
| `ProgressRing` Bogen | 3 | **13.32** | folgt dem Modus | erfüllt |
| `ProgressRing` Spur | — | 1.29 | `rgb(228,228,231)` | siehe unten |

Die **Spur** des Rings erreicht 1.29 gegen die Karte. Das ist unverändert der Wert von vorher:
C6 schreibt den Austausch `stroke="#27272a"` → `stroke-zinc-800` fest, und `#27272a` **ist**
`zinc-800`. Die Spur ist ein zurückhaltender Hintergrund, keine Aussage — der farbige Bogen
darüber trägt die Information und misst 13.32.

**Zustände** (alle drei ausgelöst, FR-007–FR-009):

| Zustand | ausgelöst durch | Ergebnis |
|---|---|---|
| keine Läufe | echtes Feature ohne Agent-Läufe | Aussage **samt Bedeutung**, dass das eigene Urteil das einzige Gate ist |
| wird geladen | `/agent-runs` um 20 s verzögert | „Lade Audits …" |
| nicht ladbar | `/agent-runs` blockiert | Fehlersatz + Grund, **kein** Ladezustand mehr |

**FR-011**: In den Live-Daten gibt es über alle 96 Features **null** Agent-Läufe, deshalb mit
drei gestubbten Läufen geprüft (PASS / FAIL / `verdict: null`) → Kopfzeile **„1/3 bestanden"**.
Die Pille „unklar" zählt nicht als bestanden.

---

## 3. Läufe-Ansicht (US4) — `laeufe-dark.png`, `laeufe-light.png`, `laeufe-herkunft.png`, `laeufe-tabelle.png`

### Herkunft (FR-017–FR-019, SC-008)

| | Etikett | Wörter | Fläche dunkel | Fläche hell | Kontrast dunkel | Kontrast hell | Ring |
|---|---|---|---|---|---|---|---|
| `telemetry` | **gemeldet** | 1 | `rgb(11,79,74)` | `rgb(204,251,241)` | **7.49** | **6.73** | ja |
| `transcript` | gemessen | 1 | `rgb(0,44,34)` | `rgb(236,253,245)` | **9.97** | **5.21** | nein |

Rechenwert D6 für teal-200 auf teal-900: 7.52 / 6.73 — getroffen. Die beiden Flächen sind in
beiden Modi verschieden, und „gemeldet" trägt zusätzlich einen Ring: ein Unterscheidungsmittel,
das auch ohne Farbwahrnehmung trägt. Die vollständige Aussage steht im `title`
(„Von der Claude-CLI gemeldet — nicht vom Toolkit erschlossen").

Vorher stand dort „von der CLI gemeldet" — drei Wörter, die über drei Zeilen brachen und sich
über die Cache-Read-Zahl schoben.

### Grössen (FR-020, FR-021, FR-021a)

| Messung | Soll | Ergebnis |
|---|---|---|
| kleinste Schrift im Hauptbereich | ≥ 12 px | **12 px**, 0 Elemente darunter |
| Kennzahlen der Lauf-Karte | 14 px | **14 px** (`text-sm`, Spalte `w-36`) |
| kleinster Marker | ≥ 10 px | **10 px**, 0 Elemente darunter |
| Balkenhöhe `HBarChart` | ≥ 10 px | 16 px |
| Balkenwert | neben dem Balken | eigene Spalte `w-14`, 12 px |
| `FeatureDashboard` (Vergleich) | gleiche Grössen | Balken 16 px, Wert 12 px daneben, Punkte 10 px |

Die **Seitenleiste** der App zeigt weiterhin 30 Elemente mit 10 px (Datumsangaben der
Feature-Liste). Sie gehört nicht zum Gegenstand dieses Features (C9 nennt Portal und
Läufe-Ansicht) und blieb unangetastet.

### Grafikflächen (C1: 3:1)

| Element | hell | Urteil |
|---|---|---|
| Balken `bg-sky-400` | **3.23** | erfüllt |
| Legendenpunkt `bg-sky-400` | **3.83** | erfüllt |
| Legendenpunkt `bg-emerald-400` | **3.52** | erfüllt |
| Legendenpunkt `bg-amber-300` | **4.69** | erfüllt |
| Donut-Segmente | tragen Klassen, folgen dem Modus | erfüllt |

Alle Diagrammfarben kommen jetzt über ausgeschriebene Tailwind-Klassen; der Build enthält
sie nachweislich (siehe Abschnitt 5). Vorher standen sie als Hex im TSX und folgten dem
Moduswechsel **gar nicht**.

### Tabelle „Einzelne Ausführungen" (FR-022, D11)

Gemessen bei **1280 px** Fensterbreite:

| Messung | Ergebnis |
|---|---|
| Spalten | **9** (Start, Art, Status, Dauer, Output, Cache-Read, Subagenten, Betrag, Log) |
| Tabelle scrollt in sich | ja — `scrollWidth` 960 > `clientWidth` 926 |
| **Seite** scrollt waagerecht | **nein** |
| gekürzte Werte (`truncate`) | 0 |
| letzte Spalte erreichbar | ja, nach `scrollLeft` vollständig sichtbar |

**FR-024 unverändert**: 34 Zellen zeigen `—` statt `0`; keine Zeile ohne Anteil, keine
Ersatzschätzung für Beträge.

---

## 4. Änderungsübersicht (US1) — `portal-uebersicht-*.png`, `portal-leer.png`

| Prüfung | Ergebnis |
|---|---|
| Kennzahlen über **alle** Dateien | 18 Dateien / +4529 −2 / 5 Commits (eigenes Feature) |
| Kürzung auf 10 | 10 gezeigt, Restzeile „+8 weitere Dateien — vollständige Liste links." |
| 207-Dateien-Fall | Kopfzahlen über alle 207, 10 gezeigt, „+197 weitere Dateien" |
| Seite scrollt waagerecht | **nein** (`scrollWidth` 1600 == `clientWidth` 1600) |
| Rückweg | „Übersicht" **und** Klick auf eine Dateizeile, beides ohne Neuladen |
| leeres Feature | nur „Keine Änderungen gegenüber main.", keine Nullwert-Kennzahlen |
| Binärdatei | Zeile trägt **„binär"**, nicht „+0 −0" |

**Kein zusätzlicher Abruf (SC-009)**: Beim Öffnen laufen `/diff`, `/executions`, `/comments`,
`/agent-runs` — je zweimal, weil React StrictMode im Dev-Modus jeden Effekt doppelt ausführt
(Bestand, nicht durch dieses Feature verursacht). Die Übersicht löst **keinen** Abruf aus, der
Rückweg über „Übersicht" **keinen einzigen**.

### Zwei Fälle mussten gestubbt werden

Kein Feature der Live-Daten konnte sie zeigen; geprüft wurde jeweils die **echte Komponente
auf dem echten Renderpfad**, ersetzt war nur die Serverantwort:

- **leeres Feature** — gemergte Features haben zwar einen leeren Diff, lassen sich über die
  Oberfläche aber nicht im Portal öffnen (Einstieg nur für `awaiting_human_review` und
  Vorschau-Features).
- **Binärzeile** — die einzige echte Binärdatei (`portal-leer.png`) hat Umfang 0 und fällt
  damit aus den zehn umfangreichsten Dateien heraus.

Beide Fälle deckt zusätzlich der Vitest ab (R5, R6).

---

## 5. Automatisierte Checks (Stufe 1)

| Check | Ergebnis |
|---|---|
| `pnpm -r typecheck` | grün (shared, server, web, desktop) |
| `pnpm -r test` | grün — **415** Tests in `shared` (33 Dateien), **536** in `server` (44 Dateien), Exit 0 |
| davon neu | `changeOverview.test.ts` — 13 Tests |
| bestehende Suites | `diffParse.test.ts`, `runSummary.test.ts`, `actionPolicy.test.ts` unverändert grün |
| `pnpm --filter @sdd/web build` | grün, 4.24 s |

**Nachweis zu D9** — die Tone-Klassen stehen im gebauten CSS, der Tailwind-Scanner findet sie:

```
bg-sky-400 · bg-emerald-400 · bg-amber-300 · bg-violet-400 · bg-zinc-500 · bg-zinc-800
stroke-sky-400 · stroke-emerald-400 · stroke-amber-300 · stroke-violet-400 · stroke-zinc-800
min-w-2.5 · h-2.5 · w-36 · w-14 · min-w-[60rem] · overflow-x-auto
```

Ausserdem im Build: je **11** `--color-teal-*` und `--color-violet-*` im Hellmodus-Block.

### Restsuche (Stufe 3d)

| Suche | Erwartung | Ergebnis |
|---|---|---|
| Hex in `ExecutionsView`, `charts`, `review/`, `ReviewPortal` | nichts | **nichts** |
| verbotene Skalen im ganzen Web-Paket | nichts | **nichts** |
| `color-teal-*` / `color-violet-*` in `index.css` | 22 | **22** |

---

## 6. Bekannt veraltet — nicht Teil dieses Features

`docs/images/review.png` und `docs/images/laeufe.png` zeigen den Stand **vor** diesem
Lesbarkeits-Pass: dunkle Diff-Fläche im Hellmodus, „von der CLI gemeldet" in Langform,
Sondergrössen unter 12 px, „Datei links auswählen." statt der Änderungsübersicht. Die
Aktualisierung der Dokumentationsbilder gehört ausdrücklich **nicht** zum Umfang dieses
Features.
