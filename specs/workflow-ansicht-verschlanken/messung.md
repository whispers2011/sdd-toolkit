# Messprotokoll — Workflow-Ansicht verschlanken

Belege für SC-001 (keine Leermeldungen) und SC-008 (Höhe −50 %). Erhoben an einer eigenen
Prüfinstanz, nicht an der laufenden Toolkit-Instanz.

## Prüfumgebung (T001)

| Größe | Wert |
|---|---|
| Prüfinstanz | nur Vite, `packages/web/node_modules/.bin/vite --port 4899 --strictPort` |
| Port | 4899 (vorher als frei geprüft: `lsof -ti:4899` → leer) |
| API | die laufende Toolkit-Instanz auf 4820 (Vite-Proxy-Vorgabe) |
| Node | v22.19.0 (`/opt/homebrew/opt/node@22/bin`) — die Standard-Shell hat v20.17.0, damit startet Vite 6.4 nicht |
| Abbau | ausschließlich `lsof -ti:4899 \| xargs kill` |

**Hinweis zum Worktree**: Dieser Worktree hatte beim Start **kein** `node_modules`. Einmalig
`pnpm install` ausgeführt (Lockfile unverändert, 813 Pakete aus dem Store).

## Messbedingungen (für Vorher/Nachher identisch)

| Größe | Wert |
|---|---|
| Projekt | `sdd-toolkit` |
| Geltung | Projekt-Standard (global + Projekt) |
| Aktive Phasen | specify, clarify, plan, tasks, implement (5) |
| Abschnitte | alle zugeklappt (`aria-expanded="true"` → 0) |
| Viewport | 1200 × 844 px |
| Gemessenes Element | der scrollende Flussbereich (`.min-h-0.overflow-auto.flex-1`) |

Konsolenzeilen (aus [quickstart.md](./quickstart.md) „S0"):

```js
[...document.querySelectorAll('p')].filter(p => p.textContent.trim() === '— keiner').length
[...document.querySelectorAll('*')].find(el => {
  const s = getComputedStyle(el);
  return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 20;
}).scrollHeight
```

## S0 — Vorher (T002), Stand `fc48bf0`, vor der ersten Codeänderung

| Kennzahl | Wert |
|---|---|
| Absätze „— keiner" | **32** |
| `scrollHeight` des Flussbereichs | **4706 px** |
| `clientHeight` des Flussbereichs | 677 px |

Screenshot: `.sdd/s0-vorher.png` (git-excluded, nur zur Nachschau).

> **Abweichung zur Spec**: spec.md nennt 22 „— keiner"-Zeilen. Tatsächlich gemessen wurden **32**
> — die Zahl hängt an den aktiven Phasen und an den Stufen mit Zonen, und die Spec hat sie
> geschätzt statt gezählt. Für SC-001 ist das gleichgültig: die Zielgröße ist 0, nicht „22 weniger".

## Ausgangslage grün (T003)

| Prüfung | Ergebnis |
|---|---|
| `pnpm typecheck` | grün — shared, server, web, desktop je „Done" |
| `pnpm test` — `@sdd/shared` | 43 Dateien, **746** Tests grün |
| `pnpm test` — `@sdd/server` | 66 Dateien, **1069** Tests grün |
| `pnpm test` — `@sdd/web` | 3 Dateien, **29** Tests grün |

Jeder spätere Fehlschlag ist damit eindeutig diesem Feature zuzuordnen.

## S7 — Nachher (T041), nach US1, US2, US5, US6

Gleiche Bedingungen wie S0 (Projekt `sdd-toolkit`, Geltung Projekt-Standard, alle Abschnitte
zugeklappt, Viewport 1200 × 844). Der Flussbereich ist auf `max-w-2xl` begrenzt, die Breite des
Fensters wirkt daher nicht auf die Höhe — Vorher und Nachher sind direkt vergleichbar.

| Kennzahl | Vorher | Nachher | Ziel | Ergebnis |
|---|---|---|---|---|
| Absätze „— keiner" (SC-001) | 32 | **0** | 0 | ✅ |
| `scrollHeight` des Flussbereichs (SC-008) | 4706 px | **2296 px** | ≤ 2353 px (−50 %) | ✅ −51,2 % |

Screenshot: `.sdd/s7-nachher.png`.

**Zwischenstand, nicht Endstand**: US3 (Spaltengruppierung) und US4 (Rückkante) fehlen noch und
bringen zusätzliche Zeilen — fünf Spaltenüberschriften und eine Kante. Die Messung ist nach deren
Landung zu wiederholen; die heutige Reserve beträgt 57 px.

### Wo die Höhe verlorenging

| Maßnahme | Bezug |
|---|---|
| 32 Zonen mit „— keiner" entfallen ersatzlos | FR-001 |
| Katalog-Einträge von 4–6 Zeilen auf **eine** | FR-007, FR-008 |
| Eskalations-Absatz, Wissens-Prosa, Präambel, Legende, Zwecksatz, Stufen-`detail` hinter ⓘ | FR-019 – FR-024 |
| Artefaktzeile der Prompt-Karte einzeilig statt Fließtext | FR-022 |
| Zweite Trennlinie zwischen „Phasenstart" und „Phasenende" entfernt (sie trennte nichts) | — |

## Browser-Verifikation

Prüfinstanz auf 4899, Projekt `sdd-toolkit`.

| Nachweis | Ergebnis |
|---|---|
| **SC-001** — „— keiner"-Zeilen | 0 (vorher 32) |
| **SC-002** — jeder Auslöserpunkt in 2 Interaktionen | Hub an unkonfigurierter Phase „Klären": alle 4 Punkte gelistet; Schritt **und** Agent angelegt, beide erscheinen inline am richtigen Punkt; Chip per Klick editierbar; leere Punkte belegen keine Zeile |
| **SC-002** — Hub auch bei belegtem Knoten | vorhanden (12 Hubs, einer je Knoten) |
| **SC-003** — zwei unterscheidbare Abschnitte | „Phasenstart (7)" / „Phasenende (6)"; dazu „Worktree-Anlage (6)", „Integration (7)", „Merge (6)" |
| **SC-004** — je Eintrag eine Zeile | 7 Einträge à exakt 17 px; ⓘ liefert Beschreibung, „Wann", Datei · Symbol, „Reihenfolge" vollständig |
| **SC-007** — Icons | 6 paarweise verschiedene SVG (Klemmbrett, Waage, Kolben, Auge, Merge, Haken); kein Emoji im Fluss |
| **FR-027** — beide Agent-Wege | „Neuen Agent erstellen" **und** bestehenden Agent einhängen (5 Kandidaten mit „aktuell: …") |
| **FR-028** — Tastatur | ⓘ fokussierbar; Enter **und** Space öffnen; Escape schließt und gibt den Fokus zurück; Klick daneben schließt |
| **FR-028** — Scrollen | Scrollen **im** Panel schließt nicht, **außerhalb** schließt |
| **FR-028** — Platzmangel | bei 500 px Fensterhöhe kippt das Panel nach oben, bleibt ganz im Viewport; bei 320 px auf 60vh gedeckelt mit eigenem `overflow-y`, Text vollständig |
| **FR-028** — Touch | mit `hover: none` öffnet ein Tap das Panel |
| **SC-009 / FR-027** — die elf Bedienwege | siehe Tabelle unten |

### Die elf Bedienwege (T044), einzeln ausgeführt

| Bedienweg | Ergebnis |
|---|---|
| Prompt ansehen/bearbeiten | Split-Screen öffnet und schließt |
| Agent anlegen | Hub → Agent-Punkt → „Neuen Agent erstellen" → angelegt, inline sichtbar |
| Bestehenden Agent einhängen | Hub → Agent-Punkt → Kandidat gewählt → Auslöser umgehängt, inline am neuen Punkt |
| Agent bearbeiten | Klick auf Chip „Plan-Qualitätsreview" → „Agent bearbeiten: …" |
| Schritt anlegen | Hub → Schritt-Punkt → Editor mit vorbelegtem Auslöser (`after_phase` + `clarify`) |
| Schritt bearbeiten | Klick auf Chip → „Schritt bearbeiten: …" |
| Geltung umschalten | Projekt-Standard ⇄ Feature, Ansicht bleibt vollständig |
| Einstellungen ein-/ausklappen | alle drei Gruppen erscheinen und verschwinden |
| Konfiguration neu laden | Ansicht steht unverändert |
| Wissen verwalten | wechselt in die Wissens-Ansicht des Projekts |
| spec-kit-Warnhinweis | Code unverändert; im Projekt `sdd-toolkit` nicht auslösbar (spec-kit vorhanden) |

**Aufgeräumt**: Die für SC-002 angelegten Objekte („ZZ-Probe US1", „ZZ-Probe Agent") wurden nach der
Prüfung gelöscht. Nachkontrolle: 0 Lebenszyklus-Schritte, 5 Agents mit unveränderten Auslösern —
derselbe Stand wie vorher.

## SC-010 — Drift-Guard-Probe (T042, teilweise)

`'smoke_test'` versuchsweise in `INTEGRATION_STAGE_IDS` (`packages/shared/src/types.ts`) ergänzt:

| Stelle | Reaktion |
|---|---|
| `STEP_ICON` (`WorkflowOverview.tsx`) | ✅ `pnpm typecheck` bricht: `TS2741: Property 'smoke_test' is missing … but required in type 'Record<…, ComponentType<IconProps>>'` |
| `INTEGRATION_STEPS` (`workflowModel.ts`) | ✅ `pnpm test` bricht: „INTEGRATION_STEPS-IDs sind exakt INTEGRATION_STAGE_IDS" |
| `COLUMN_FOR_STEP` (`boardColumns.tsx`) | ⏳ noch nicht prüfbar — die Datei liegt nicht im Branch (Abhängigkeits-Gate, Phase 7) |

`INTEGRATION_STEPS` ist ein Array, kein `Record`; sein Wächter ist deshalb bauartbedingt der Test,
nicht der Typcheck. Der quickstart erwartet „Fehler an beiden Stellen" — das trifft zu, nur greift
an dieser einen Stelle `pnpm test` statt `pnpm typecheck`.

Änderung anschließend zurückgenommen, `pnpm typecheck` wieder grün (alle vier Pakete „Done").

### Anmerkung zur Prüfinstanz

Der Origin-Guard des Servers (`packages/server/src/api/originGuard.ts`) lässt nur die Origins des
API- und des Web-Ports zu. Lesende Anfragen der Prüfinstanz gehen durch (bei gleichem Ursprung
sendet der Browser keinen `Origin`), **jede schreibende Anfrage** trägt ihn und wird mit 403
abgewiesen. Ohne Gegenmaßnahme ließe sich kein einziger Bedienweg wirklich ausführen (SC-009
verlangt das aber ausdrücklich). Die Prüfinstanz lief deshalb mit einer **temporären**
Vite-Konfiguration, die den `Origin` im Proxy entfernt. Diese Datei ist reines Prüfgerüst und wird
nach der Verifikation gelöscht — am Produktionscode ändert sich nichts.
