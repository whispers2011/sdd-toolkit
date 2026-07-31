# Quickstart: Verifikation „Emojis als SVG-Icons"

Validierungsleitfaden, der beweist, dass das Feature end-to-end funktioniert. Details zu Icons/Fundstellen: siehe [data-model.md](./data-model.md) und [contracts/icon-component.md](./contracts/icon-component.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install`).
- Repo-Root des Worktrees.

## 1. Statische Prüfung — keine Emoji mehr im Scope (SC-001 / VR-1)

Erwartung: **keine Treffer** für Wissensdatenbank-/Chat-Elemente (die typografischen `▍` und `→` sind ausgenommen).

> Hinweis: Ein pauschaler `✓`-Grep über ganze Dateien meldet zwei **out-of-scope**-Treffer, die NICHT zum Feature gehören: `Sidebar.tsx` `FeatureBadge` (Status „gemerged") und `FeatureConsole.tsx` Phasen-Status („approved"). Beide sind Feature-/Phasen-Status, keine Wissensdatenbank-/Chat-Elemente, und bleiben bewusst unverändert.

```bash
# Katalog-Glyphen in den sechs Zieldateien suchen — muss leer sein:
grep -nP '📚|📦|📄|🗑|💬|💡|✎|✕|⟳|✓|⚠|↺|⏸' \
  packages/web/src/components/Sidebar.tsx \
  packages/web/src/components/FeatureConsole.tsx \
  packages/web/src/components/KnowledgePanel.tsx \
  packages/web/src/components/FeatureKnowledgeSelect.tsx \
  packages/web/src/components/ChatBubble.tsx \
  packages/web/src/components/ChatPanel.tsx \
  && echo 'FEHLER: Emoji verblieben' || echo 'OK: keine Icon-Emoji mehr'
```

Zusätzlich: `icons.tsx` verwendet ausschließlich `currentColor` (kein Farbliteral in `stroke`/`fill`):

```bash
grep -nE 'stroke="#|fill="#|stroke="rgb|fill="rgb' packages/web/src/components/icons.tsx \
  && echo 'FEHLER: feste Farbe' || echo 'OK: nur currentColor'
```

## 2. Build & Typecheck (Vertrag & Kompilierbarkeit)

Erwartung: beide grün.

```bash
pnpm --filter @sdd/web typecheck
pnpm --filter @sdd/web build
```

## 3. App starten & visuell prüfen

```bash
pnpm dev   # Server :4820 + Web :4830
open http://localhost:4830
```

### Wissensdatenbank (User Story 1)

1. Sidebar → Projekt hovern → **Wissen-Icon** ist ein SVG (kein 📚) und öffnet die Wissensdatenbank. *(SC-004: OS-/Browser-unabhängig identisch.)*
2. In der Baum-Ansicht tragen Bundles ein **Bundle-Icon**, Einträge ein **Dokument-Icon** — klar unterscheidbar.
3. Ein Bundle/Eintrag hovern → Aktions-Buttons zeigen SVG-Icons für **Unter-Bundle +**, **Eintrag +**, **Bearbeiten**, **Löschen**, **Neu-Laden**; Tooltips unverändert, Klicks funktionieren wie zuvor. *(SC-002/SC-005)*
4. Auf **Index** umschalten und die **Feature-Wissensauswahl** (Konsolen-Header 📚→Icon) öffnen → dieselben Bundle-/Eintrags-Icons wie im Baum. *(SC-003)*
5. Destruktive/dezente Farben stimmen: Marker gedämpft (`zinc`), keine bunten Emoji mehr. *(FR-003)*

### Wissens-Chat (User Story 2)

6. Projekt öffnen → schwebende **Chat-Bubble** zeigt ein SVG-Chat-Icon (kein 💬); Öffnen wechselt zu **Schließen-Icon** (kein ✕).
7. Panel-Kopf: **Neu** (Restart-Icon + Text „Neu") und **Schließen** als SVG; Aktionen unverändert.
8. Eine Nachricht senden, die einen **Feature-Vorschlag** provoziert → Karte zeigt **Idee-Icon** (kein 💡); angenommener Status zeigt **Haken-Icon** in Grün.
9. Fehler-/Unterbrechungsfall: Hinweis zeigt **Warn-Icon** (rot) bzw. **Pause-Icon** (gelb). *(FR-004, Statusfarben)*
10. Streaming-Cursor `▍` und „Zur Feature-Konsole →" sind unverändert vorhanden (bewusst out of scope).

### Konsistenz & Zugänglichkeit (User Story 3)

11. „Schließen" sieht in Bubble und Panel identisch aus; Bundle/Eintrag identisch in Baum, Index und Auswahl. *(SC-003)*
12. Icons sind zur Textzeile ausgerichtet, keine Layout-Sprünge vs. vorher. *(SC-006)*
13. Interaktive Icons: Hover/Fokus zeigt weiterhin den Tooltip; mit Screenreader werden dekorative Marker nicht als Emoji-Wort vorgelesen. *(FR-006/FR-007)*

## Erfolgskriterium

Alle Grep-Checks „OK", `typecheck`+`build` grün, und die Schritte 1–13 verhalten sich wie beschrieben → Spec-Ziele SC-001…SC-007 erfüllt.
