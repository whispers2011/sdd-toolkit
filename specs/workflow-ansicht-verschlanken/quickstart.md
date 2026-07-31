# Quickstart — Verifikation „Workflow-Ansicht verschlanken"

Wie nachgewiesen wird, dass das Feature funktioniert. Kein Implementierungscode — der gehört in
`tasks.md`. Die Reihenfolge unten ist die Reihenfolge, in der geprüft wird.

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install` im Repo-Wurzelverzeichnis)
- Eine **laufende** Toolkit-Instanz mit dem Projekt `sdd-toolkit` und mindestens einem aktiven
  Feature (für die Geltung „Feature")
- Für S5/S6 (US3/US4): der Board-Stand aus dem Haupt-Checkout liegt als Commit im Branch —
  `packages/web/src/components/boardColumns.tsx` existiert, `rejectManualTest` setzt auf `specify`
  zurück. Vorher sind die Prüfungen zu FR-010 bis FR-015 nicht durchführbar.

## Prüfinstanz starten

Regel des Repos: **niemals** eine zweite Serverinstanz und **niemals** generische Kill-Muster. Die
Prüfinstanz ist nur ein zweiter Vite-Server, der auf die bereits laufende API proxyt.

```sh
# 1. Freien Port suchen — 4899 ist NICHT reserviert, also prüfen:
lsof -ti:4899 || echo "4899 frei"

# 2. Nur Vite, auf dem eigenen Port, mit --strictPort (sonst weicht Vite still aus
#    und man testet den Stand eines fremden Worktrees):
pnpm --filter @sdd/web dev -- --port 4899 --strictPort

# 3. Öffnen: http://localhost:4899  →  Übersichten → Workflow
```

Abbau **ausschließlich** über den eigenen Port:

```sh
lsof -ti:4899 | xargs kill
```

> `pkill -f vite`, `pkill -f node` o. ä. sind verboten: die eigene Session ist ein Kindprozess des
> laufenden Toolkits und würde mitsterben (CLAUDE.md, zweimal belegt am 26.07.2026).

---

## S0 — Vorher-Messung (VOR der ersten Codeänderung)

Ohne diese Zahlen ist SC-008 nicht belegbar. In der DevTools-Konsole der Workflow-Ansicht,
Geltung „Projekt-Standard", alle Abschnitte zugeklappt:

```js
// Höhe des scrollenden Flussbereichs
document.querySelector('main, .overflow-auto')?.scrollHeight
// Anzahl der reinen Leermeldungen
[...document.querySelectorAll('p')].filter(p => p.textContent.trim() === '— keiner').length
```

**Erwartung heute**: `— keiner` = 22 (Spec-Befund vom 31.07.2026, hängt an der Zahl aktiver Phasen).
Beide Zahlen notieren — sie sind der Vergleichsmaßstab für SC-001 und SC-008.

---

## Automatisierte Prüfungen

```sh
pnpm typecheck   # trägt FR-012, FR-017, SC-010
pnpm test        # shared/server/web — alle vorhandenen Tests bleiben grün
```

**Neu abgedeckt**: `rejectTargetPhase` in `packages/shared/src/workflowModel.test.ts` — drei Fälle:
mit `specify`, ohne `specify` (erste geordnete Phase), leere Liste (`null`).

**Muss unverändert grün bleiben**: `mergeQueueService.test.ts` (der Servereingriff ist
verhaltensgleich) und `workflowModel.test.ts` (INTEGRATION_STEPS-IDs = INTEGRATION_STAGE_IDS).

---

## Szenarien am laufenden Programm

### SC-001 / US1 — Keine Leermeldungen

1. Workflow-Ansicht öffnen, Geltung „Projekt-Standard".
2. Konsolenzeile aus S0 erneut ausführen.

**Erwartet**: `0`. Keine Zone und keine „— keiner"-Zeile an Phasen, Stufen oder der Prompt-Karte.

### SC-002 / US1 — Jeder Auslöserpunkt in zwei Interaktionen

1. An einer Phase ohne jede Konfiguration das „+" im Knotenkopf öffnen *(Interaktion 1)*.
2. Alle vier Punkte müssen gelistet sein: vor/nach Phase für Schritte **und** für Agents.
3. An „Nach Phase" einen Schritt anlegen *(Interaktion 2 führt in den Editor)*, speichern.

**Erwartet**: Der Schritt erscheint anschließend **inline** unter der Zone „Nach Phase …" und ist
per Klick editierbar. Die drei weiterhin leeren Punkte erscheinen **nicht** als Zeilen.

4. Dasselbe mit einem Agent: Hub → Agent-Punkt → „Neuen Agent erstellen" **und** (zweiter Durchgang)
   einen bestehenden Agent einhängen.

**Erwartet**: Beide Wege funktionieren wie heute; der Agent erscheint inline am richtigen Punkt.

5. An einem Knoten, an dem alle Punkte belegt sind, ist das „+" trotzdem vorhanden.

### SC-003 / SC-004 / US2 — Die zwei Toolkit-Abschnitte

1. Eine Phasenkarte ansehen.

**Erwartet**: „Phasenstart (7)" und „Phasenende (6)" — verschiedene Beschriftungen, ohne Tooltip
unterscheidbar.

2. Beide aufklappen.

**Erwartet**: Jeder Eintrag belegt **genau eine** Zeile (Nummer + Name), rechts ein ⓘ.

3. Am Eintrag „Transkript-Startmarke festhalten" (hat `orderNote`) das ⓘ öffnen.

**Erwartet**: Beschreibung, „Wann", `packages/server/src/services/core/runMeter.ts · markSession`
und der Reihenfolge-Hinweis vollständig lesbar. Am Eintrag „Kontext-Reset gemäß Strategie"
zusätzlich „Nur wenn".

4. Das ⓘ **am Abschnitt** „Worktree-Anlage" öffnen.

**Erwartet**: Stufentext (`when`) und „Nicht Aufgabe des Toolkits" erreichbar.

### SC-005 / US3 — Dieselbe Sprache wie das Board *(setzt die Abhängigkeit voraus)*

1. Board und Workflow-Ansicht nebeneinander öffnen.

**Erwartet**: Prüfung, Abnahme, Review, Merge, Done erscheinen in der Workflow-Ansicht mit
identischer Beschriftung und in derselben Reihenfolge; jede der sechs Stufen steht unter der
Spalte, unter der das Board sie führt (Verifikation + Review-Gate → Prüfung, Manuelle Abnahme →
Abnahme, Menschliches Review → Review, Merge-Queue → Merge, Gemergt → Done).

2. „Review-Agents" ausschalten und die Ansicht neu ansehen.

**Erwartet**: Das Review-Gate bleibt in der Spalte „Prüfung" stehen und ist als übersprungen
gekennzeichnet — es verschwindet nicht.

### SC-006 / US4 — Der Rücksprung *(setzt die Abhängigkeit voraus)*

1. „Manuelles Test-Gate" einschalten.

**Erwartet**: Unter der Spalte „Abnahme" eine sichtbare Kante nach oben, beschriftet mit dem
Ablehnungsweg und dem Label der Zielphase („Spezifizieren").

2. Deren ⓘ öffnen.

**Erwartet**: Befunde gehen als Arbeitsauftrag in die bestehende Spezifikation · alles
Nachgelagerte wird als veraltet markiert · der Lebenszyklus läuft erneut.

3. „Manuelles Test-Gate" ausschalten.

**Erwartet**: Keine Rückkante mehr.

4. Gegenprobe der Ableitung: In den Projekt-Einstellungen `specify` abschalten (falls möglich) —
   die Beschriftung muss auf die dann erste Phase zeigen, nicht auf „Spezifizieren".

### SC-007 / US5 — Icons

1. Die sechs Stufen ansehen.

**Erwartet**: Sechs paarweise verschiedene SVG-Icons, kein Emoji. „Manuelle Abnahme" zeigt **nicht**
mehr dasselbe Icon wie „Verifikation".

2. `grep -n "icon" packages/shared/src/workflowModel.ts`

**Erwartet**: Kein `icon`-Feld, keine Emoji-Literale mehr.

### SC-010 — Der Typcheck bricht bei einer neuen Stufe

```sh
# In packages/shared/src/types.ts INTEGRATION_STAGE_IDS um 'smoke_test' ergänzen:
pnpm typecheck
```

**Erwartet**: Fehler an **beiden** Stellen — `COLUMN_FOR_STEP` (fehlende Spalte) und `STEP_ICON`
(fehlendes Icon), zusätzlich an `INTEGRATION_STEPS`. Danach die Änderung **zurücknehmen** und
`pnpm typecheck` erneut grün laufen lassen.

### US6 — Kein Dauertext mehr

1. Bis zum Fuß der Ansicht scrollen.

**Erwartet**: Kein Eskalations-Absatz, keine Wissens-Prosa, kein Präambel-Text, keine
ausgeschriebene Legende. Stattdessen je ein ⓘ; Wissensliste und „Wissen verwalten" unverändert da.

2. Die drei ⓘ öffnen.

**Erwartet**: Eskalationstext, beide Wissens-Absätze inklusive Präambel-Text, achtteilige Legende —
inhaltlich unverändert.

### FR-028 — Bedienung ohne Maus

1. Mit `Tab` durch die Ansicht gehen.

**Erwartet**: Jedes ⓘ ist fokussierbar und mit Enter **und** Space zu öffnen; `Escape` schließt und
gibt den Fokus an das Icon zurück; ein Klick daneben schließt ebenfalls.

2. Ein Popover mit langem Inhalt öffnen (Präambel-Text oder Legende) und darin scrollen.

**Erwartet**: Der Inhalt ist vollständig lesbar, wird nicht abgeschnitten und das Panel schließt
beim Scrollen **im** Panel nicht. Bei geringer Fensterhöhe kippt es nach oben statt aus dem
Viewport zu laufen.

3. DevTools → Geräte-Emulation (Touch): ein ⓘ antippen.

**Erwartet**: Das Popover öffnet.

### SC-008 — Höhe

Messung aus S0 wiederholen, gleiche Geltung, alle Abschnitte zugeklappt.

**Erwartet**: `scrollHeight` ≤ 50 % des Vorher-Wertes.

### SC-009 / FR-027 — Alle Bedienwege

Die Tabelle „Was nirgends verlorengehen darf" in
[contracts/view-structure.md](./contracts/view-structure.md) Zeile für Zeile durchgehen — elf
Bedienwege, jeder einmal wirklich ausgeführt, nicht nur angesehen.

---

## Abnahme

Fertig, wenn:

- [ ] `pnpm typecheck` und `pnpm test` grün
- [ ] SC-001 bis SC-010 nachgewiesen (SC-005/SC-006 nach Landung der Abhängigkeit)
- [ ] Vorher-/Nachher-Zahlen für SC-001 und SC-008 im Umsetzungsprotokoll festgehalten
- [ ] Prüfinstanz über ihren eigenen Port abgebaut
