# Quickstart & Validation: Light-/Dark-Mode-Umschalter

**Feature**: `light-model-claude-chat-farben` · **Date**: 2026-07-23

Manuelle Validierung (das Web-Paket hat keinen Test-Runner — MVP). Jede Szenario-
Gruppe verweist auf Akzeptanzkriterien der Spec.

## Voraussetzungen

- Node ≥ 22, pnpm 10.
- Abhängigkeiten installiert: `pnpm install` (Repo-Root).

## Starten

```bash
# Repo-Root — startet Server (@sdd/server) und Web-UI (@sdd/web) parallel
pnpm dev
# Web-UI: http://localhost:4830
```

## Statische Prüfung

```bash
pnpm --filter @sdd/web typecheck   # tsc --noEmit — muss fehlerfrei sein
pnpm --filter @sdd/web build       # Produktionsbuild muss durchlaufen
```

---

## V1 — Umschalten (US1 · FR-001/002/003/006 · SC-001/005)

1. UI im Dark-Mode öffnen. **Erwartung**: Umschalter **oben rechts** in der
   Kopfzeile (neben dem Automation-Dial), zeigt das **Mond**-SVG (aktiver Modus).
2. Umschalter klicken. **Erwartung**: Gesamtes UI wechselt **sofort, ohne
   Neuladen** nach Light; Icon zeigt nun **Sonne**. (< 2 s, SC-001)
3. Erneut klicken → zurück nach Dark. Icon wieder **Mond**.
4. In beiden Modi nacheinander **Board, Grid, Läufe, Braucht dich, Feature-
   Konsole, Shell, Wissen** sowie Dialoge (Neues Feature, Projekt-Einstellungen,
   QuickSwitcher ⌘K) öffnen. **Erwartung**: jede Ansicht durchgängig im aktiven
   Modus, kein Bereich bleibt im „falschen" Modus. (US1 Szenario 3, FR-003)

## V2 — Rückfragen lesbar (US2 · FR-005/003/009 · SC-003/006)

1. Projekt-Chat (Sprechblase unten rechts) öffnen; Claude-Session startet.
2. Eine Situation herbeiführen, in der Claude eine **Rückfrage/Auswahl** stellt.
3. **Dark-Mode**: Frage-Text und Antwortoptionen sind klar lesbar — **kein**
   dunkler Text auf dunklem Grund. (US2 Szenario 1, SC-003)
4. Auf **Light-Mode** umschalten, während die Rückfrage steht.
   **Erwartung**: Terminal färbt live um (kein Neustart der Session), Rückfrage
   bleibt lesbar und beantwortbar, **Eingabefokus/Scrollback erhalten**.
   (US2 Szenario 3, FR-009, SC-006)
5. **Light-Mode**: Frage/Optionen klar lesbar — kein heller Text auf hellem
   Grund. (US2 Szenario 2)
6. Hervorgehobene vs. nicht hervorgehobene Option prüfen — beide Zustände in
   beiden Modi lesbar. (US2 Szenario 4)

## V3 — Persistenz & Default (US3 · FR-007/008/010 · SC-004)

1. Light wählen, Seite **neu laden** → Light bleibt aktiv. (SC-004)
2. `localStorage`-Schlüssel `sdd-theme` löschen, System auf **Dark** stellen,
   neu laden → UI startet Dark (System-Default). System auf **Light** → UI
   startet Light. (FR-008)
3. Bei gelöschtem `sdd-theme` und ohne System-Angabe → **Dark**-Fallback.
4. Explizit Dark wählen, dann Systempräferenz auf Light ändern → UI **bleibt
   Dark** (Nutzerwahl gewinnt). (FR-010)
5. Kein sichtbarer **Flash** beim Laden in beiden Modi (FOUC-Guard, C2).

## V4 — Laufende Arbeit ungestört (FR-009 · SC-006)

1. Feature-Konsole mit **streamender** Ausgabe offen; Modus umschalten.
   **Erwartung**: Stream läuft weiter, Scrollback erhalten, kein Neuladen.
2. In ein Eingabefeld (z. B. Neues-Feature-Dialog) tippen, **nicht** absenden,
   umschalten. **Erwartung**: Eingabe und Fokus bleiben erhalten.

## V5 — Kontrast/Lesbarkeit AA (FR-004 · SC-002)

1. In **beiden** Modi je eine Ansicht mit den DevTools bzw. einem Kontrast-Tool
   prüfen: Fließtext ≥ 4,5:1, große Schrift/Bedienelemente ≥ 3:1.
2. Gezielt die **Sonderfälle** prüfen: Status-Punkte/Badges (emerald/amber/red),
   Banner (`bg-amber-950/40`, `bg-red-950`), Feature-Vorschlagskarte
   (`bg-sky-950/40`), sowie ehemalige `bg-black`/`text-white`-Stellen.
   **Erwartung**: nirgends gleichfarbig-auf-gleichfarbig. (SC-002/SC-003)

---

## Definition of Done (Validierung)

- [ ] `typecheck` und `build` fehlerfrei.
- [ ] V1–V5 bestanden.
- [ ] Umschalter oben rechts, SVG, zeigt aktiven Modus.
- [ ] Rückfragen in **beiden** Modi lesbar; schwarz-auf-schwarz beseitigt.
- [ ] Wahl überlebt Neuladen; System-Default + Dark-Fallback greifen; Nutzerwahl
      gewinnt gegen spätere Systemänderung.
- [ ] Kein FOUC; keine Unterbrechung laufender Arbeit beim Umschalten.
