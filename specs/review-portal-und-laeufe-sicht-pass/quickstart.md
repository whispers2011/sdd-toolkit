# Quickstart / Validierung: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

Nachweis, dass das Feature end-to-end funktioniert. Verträge:
[change-overview.md](./contracts/change-overview.md), [ui-contract.md](./contracts/ui-contract.md);
Datenmodell: [data-model.md](./data-model.md); Entscheidungen und Messwerte:
[research.md](./research.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10
- **Abhängigkeiten installiert**: `pnpm install` **im Worktree** — dieser Worktree hat beim
  Planen kein `node_modules`; ohne Installation scheitern `typecheck`, `test` und `build`.
- Ein Feature mit **Diff und Commits** (für US1/US2) und ein Feature **ohne
  Verifikationsläufe** (für US3). Ein Lauf mit `tokensSource === 'telemetry'` und einer ohne
  (für US4-AS2) — die Läufe des 30.07.2026 erfüllen das.
- Browser-Prüfung über die Chrome-Anbindung (Chrome-MCP).

> **Eigene Instanz nur auf freien Ports.** 4820/4830 gehören der laufenden Toolkit-Instanz.
> Aufräumen ausschliesslich gezielt: `lsof -ti:4899 | xargs kill` bzw. über die beim Start
> gemerkte PID. **Kein** `pkill -f vite`/`node`/`tsx`/`pnpm` — die eigene Session ist
> Kindprozess der laufenden Instanz und stirbt mit (CLAUDE.md).

```bash
# eigene Instanz, falls die laufende nicht benutzt werden soll
SDD_PORT=4899 pnpm --filter @sdd/server dev &      # PID merken
SDD_PORT=4899 SDD_WEB_PORT=4898 pnpm --filter @sdd/web dev &
# → http://localhost:4898
```

---

## Stufe 1: Automatisierte Checks

```bash
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm --filter @sdd/web build
```

**Erwartung**: grün. Relevante Deckung:

| Testdatei | Deckt ab |
|---|---|
| `packages/shared/src/changeOverview.test.ts` (neu) | Kürzung auf 10 Dateien und Restzahl bei 14/90/10 Dateien (R1), deterministische Sortierung inkl. Gleichstand (R2), Gruppenreihenfolge (R3), drei jüngste Commits aus unsortierter Eingabe (R4), Binärdateien ohne erfundene Zeilen (R5), 0 Dateien (R6), 0 Commits (R7), Eingabe unverändert (R8), alle vier Formen des Gruppenschlüssels |
| bestehende Suites | unverändert grün — insbesondere `diffParse.test.ts`, `runSummary.test.ts`, `actionPolicy.test.ts` |

`pnpm --filter @sdd/web build` ist Teil der Stufe, weil er den Tailwind-Durchlauf enthält: er
belegt, dass die Klassennamen der Diagramm-Töne gefunden werden (D9).

---

## Stufe 2: Änderungsübersicht und Rückweg (US1, FR-001–FR-006, SC-001/SC-009)

1. Portal eines Features mit mehreren Dateien und Commits öffnen, **keine Datei anklicken**.
   → Mitte zeigt Kennzahlen (Dateien, `+A −D`, Commits), Dateien nach Umfang gruppiert,
   höchstens 10, ggf. „+N weitere Dateien", darunter die drei jüngsten Commits. (US1-AS1)
2. Datei links anklicken → Diff erscheint **an derselben Stelle**. (US1-AS2)
3. Auf **„Übersicht"** am Kopf der Dateiliste klicken → Übersicht ist wieder da, **ohne**
   Neuladen. Alternativ eine Dateizeile in der Übersicht anklicken → springt in den Diff.
   (US1-AS3)
4. Feature **ohne** Änderungen gegen den Ziel-Branch öffnen → Satz „Keine Änderungen gegenüber
   `<branch>`.", **keine** Kennzahlen mit Nullwerten. (US1-AS4)
5. Feature mit Binärdatei (z. B. `docs/images/*.png`, `ai-adoption.xlsx`) → die Zeile trägt
   **„binär"**, nicht „+0 −0". (US1-AS5)
6. Feature mit vielen Dateien (Massstab: 90) → Übersicht bleibt kompakt, Layout bricht nicht,
   die **Seite** scrollt nicht waagerecht. (US1-AS6)
7. Netzwerk-Panel prüfen: beim Öffnen **kein zusätzlicher** Abruf gegenüber heute
   (`/diff`, `/executions`, `/comments`, `/agent-runs`), und die Übersicht erscheint mit der
   Antwort von `/diff` — kein zweiter Ladezustand. (SC-009)

---

## Stufe 3: Beide Modi im Browser prüfen (FR-027, SC-004–SC-006, SC-010)

Für **jede** Prüfung: einmal im Dunkel-, einmal im Hellmodus (Umschalter oben rechts).

### 3a — Diff lesbar (US2)

1. Datei mit hinzugefügten **und** entfernten Zeilen öffnen.
2. Modus umschalten, **während** der Diff offen ist → Fläche folgt sofort dem Schema, keine
   dunkle Fläche im Hellmodus, Scroll-Position bleibt. (US2-AS2/AS6, FR-026)
3. Kommentar an einer Zeile anlegen und aus dem Kommentar-Panel dorthin springen → Markierung
   erkennbar, Text der Zeile weiter lesbar. (US2-AS4)
4. Reiter „Konfliktauflösung" (falls vorhanden) und die Log-Ansicht der Läufe im Hellmodus
   öffnen → gleiche Behandlung wie der Datei-Diff. (US2-AS5, FR-016)

**Kontraste messen** — im geöffneten Diff ausführen und Ausgabe nach
`evidence/messwerte.md` übernehmen:

```js
(() => {
  const lum = (s) => { const [r,g,b] = s.match(/\d+(\.\d+)?/g).slice(0,3).map(Number)
    .map(v => v/255).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
    return 0.2126*r + 0.7152*g + 0.0722*b; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) {
    const b = getComputedStyle(n).backgroundColor;
    if (b && !/rgba?\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; };
  const ratio = (el) => { const s = getComputedStyle(el);
    const [a,b] = [lum(s.color), lum(bgOf(el))].sort((x,y) => y-x);
    return +((a+0.05)/(b+0.05)).toFixed(2); };
  const pick = (sel) => document.querySelector(sel);
  return {
    theme: document.documentElement.dataset.theme,
    codeZeile: ratio(pick('td.whitespace-pre')),
    schrift: getComputedStyle(pick('td.whitespace-pre')).fontSize,
    zeilennummer: ratio(pick('td.select-none')),
  };
})();
```

**Erwartung** (Soll aus FR-013; Rechenwerte in [research.md](./research.md) D6): Code ≥ 4.5 in
beiden Modi (erwartet ≈ 7.4–11), Zeilennummern und Abschnittsköpfe ≥ 3 (erwartet ≈ 4.1–8.3).

**Ohne Farbwahrnehmung** (SC-005): vor dem Screenshot
`document.documentElement.style.filter = 'grayscale(1)'` setzen; hinzugefügte und entfernte
Zeilen müssen am führenden `+`/`-` weiter unterscheidbar sein. Filter danach zurücksetzen.

### 3b — Rechte Spalte (US3, FR-007–FR-011, SC-002/SC-003)

Alle drei Zustände einmal auslösen und je einen Beleg ablegen:

| Zustand | Auslösen |
|---|---|
| keine Läufe | Portal eines Features ohne Agent-Läufe öffnen → Aussage **samt Bedeutung** für die Freigabe |
| wird geladen | Netzwerk auf „Slow 3G" drosseln oder `/agent-runs` verzögern → „Lade Audits …" |
| nicht ladbar | `/agent-runs` im Netzwerk-Panel blockieren (Request blocking) → Fehlersatz, **nicht** dauerhaft „Lade …" |

Zusätzlich: Feature ohne Kommentare → Kommentarbereich benennt das (FR-010); Lauf mit
`verdict === null` → „unklar", zählt nicht als bestanden (FR-011); beide Modi lesbar (US3-AS6).

### 3c — Läufe-Ansicht (US4, FR-017–FR-024, SC-006–SC-008)

1. Zwei Läufe unterschiedlicher Herkunft nebeneinander → Abzeichen zeigt **ein Wort**
   („gemeldet" / „gemessen"), Farbunterschied in beiden Modi erkennbar, Tooltip trägt die
   vollständige Aussage. (US4-AS1/AS2, SC-008)
2. Schriftgrössen ablesen — Erwartung: **kein** Wert < 12 px, Kennzahlen der Lauf-Karte 14 px:

```js
[...document.querySelectorAll('*')]
  .filter(e => e.children.length === 0 && e.textContent.trim())
  .map(e => parseFloat(getComputedStyle(e).fontSize))
  .sort((a,b) => a-b)[0];   // Erwartung: 12
```

3. Marker prüfen — Legendenpunkte und Balken je ≥ 10 px in der kleineren Ausdehnung:

```js
[...document.querySelectorAll('[class*=rounded-sm]')]
  .map(e => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))
  .filter(v => v > 0).sort((a,b) => a-b)[0];   // Erwartung: ≥ 10
```

4. Lauf aufklappen → Diagramme (Balken pro Step, Donut, Komposition) in beiden Modi: keine
   Fläche bleibt dunkel, jede Zahl lesbar, Balkenwerte stehen **neben** den Balken. (US4-AS5)
5. Tabelle „Einzelne Ausführungen" in üblicher Fensterbreite → alle neun Spalten erreichbar
   (waagerechtes Scrollen **innerhalb** der Tabelle), keine gekürzten Werte, die Seite selbst
   scrollt nicht waagerecht. (US4-AS6, FR-022)
6. Lauf ohne Subagenten bzw. ohne gemeldeten Betrag → `—` bzw. gar keine Zeile, keine
   Ersatzzahl. (US4-AS7, FR-024)
7. `FeatureDashboard` desselben Features öffnen → dieselben Diagramm-Grössen wie in der
   Läufe-Ansicht (FR-021a).

### 3d — Restsuche nach nicht invertierten Farben

```bash
# darf in den betroffenen Dateien nichts mehr finden
grep -rnE 'bg-\[#|#[0-9a-fA-F]{6}' packages/web/src/components/ExecutionsView.tsx \
  packages/web/src/components/charts.tsx packages/web/src/components/review/ \
  packages/web/src/components/ReviewPortal.tsx
# darf im ganzen Web-Paket nichts finden
grep -rnE '(bg|text|border|ring|stroke|fill)-(indigo|purple|fuchsia|cyan|blue|green|lime|orange|rose|pink|slate|gray|neutral|stone)-' packages/web/src
# teal/violet müssen in index.css invertiert sein: 2 Skalen × 11 Stufen
grep -o 'color-teal-[0-9]*\|color-violet-[0-9]*' packages/web/src/index.css | wc -l  # Erwartung: 22
```

---

## Stufe 4: Belege ablegen (SC-010)

Nach `specs/review-portal-und-laeufe-sicht-pass/evidence/`:

| Datei | Inhalt |
|---|---|
| `portal-uebersicht-dark.png` / `-light.png` | Portal ohne Dateiauswahl, Änderungsübersicht |
| `portal-diff-dark.png` / `-light.png` | offener Diff mit add-, del- und Kontextzeilen |
| `portal-diff-graustufen.png` | derselbe Diff mit `grayscale(1)` (SC-005) |
| `portal-ohne-laeufe.png` | rechte Spalte: keine Läufe, samt Bedeutung |
| `portal-laeufe-laedt.png` / `-fehler.png` | die beiden anderen Zustände (SC-003) |
| `portal-leer.png` | Feature ohne Änderungen (US1-AS4) |
| `laeufe-dark.png` / `laeufe-light.png` | Läufe-Ansicht, ein Lauf aufgeklappt |
| `laeufe-herkunft.png` | zwei Läufe unterschiedlicher Herkunft nebeneinander (SC-008) |
| `laeufe-tabelle.png` | neunspaltige Tabelle in üblicher Fensterbreite (FR-022) |
| `messwerte.md` | abgelesene Kontraste und Schriftgrössen je Modus, Soll/Ist gegenübergestellt |

**Abnahme erfüllt, wenn**: Stufe 1 grün, Stufe 2 und 3 in **beiden** Modi durchlaufen, alle
Belege aus Stufe 4 vorhanden — und `docs/images/review.png` / `laeufe.png` als *bekannt
veraltet* vermerkt (Aktualisierung der Dokumentationsbilder ist nicht Teil dieses Features).
