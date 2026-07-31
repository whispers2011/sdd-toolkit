# Phase 0 Research: Nur ein Projektkontext

**Feature**: Nur ein Projektkontext — „Alle Projekte" entfernen
**Date**: 2026-07-22

Die Technical Context enthielt keine offenen `NEEDS CLARIFICATION`. Diese Recherche dokumentiert die Entwurfsentscheidungen für die Invariante „genau ein Projektkontext".

## D1: Semantik von `selectedProjectId === null`

- **Decision**: `null` wird von „alle Projekte" zu „kein Projekt vorhanden bzw. noch nicht aufgelöst" umgedeutet. Der Typ bleibt `string | null`. `null` tritt nur noch auf, wenn null Projekte existieren oder der Bootstrap noch nicht gelaufen ist.
- **Rationale**: Minimaler Eingriff — keine Typ-Umstellung auf `string` nötig, keine neuen Sentinel-Werte. Der Leerzustand (FR-008) braucht ohnehin einen „kein Kontext"-Wert; `null` deckt ihn natürlich ab. Alle Ansichten prüfen bereits `=== null`; die Zweige werden entfernt statt umgeschrieben.
- **Alternatives considered**:
  - Typ hart auf `string` + separates Flag `hasProjects`: mehr Umbau, kein Mehrwert.
  - Sentinel-String (`'__none__'`): verschleiert den Leerzustand, fehleranfällig bei Vergleichen.

## D2: Auswahl des Startprojekts

- **Decision**: Beim `bootstrap` (initialer State + jeder Re-Fetch nach `api.state()`) wird der Kontext aufgelöst: (1) wenn die aktuelle `selectedProjectId` in der neuen Projektliste existiert → beibehalten; (2) sonst zuletzt gemerkte ID aus `localStorage`, falls sie existiert; (3) sonst erstes Projekt der Liste; (4) wenn keine Projekte → `null`.
- **Rationale**: Ein einziger Auflösungspunkt im `bootstrap`-Reducer deckt Start, Projekt-Entfernung (FR-006) und erstes Hinzufügen (FR-008) ab, da alle diese Flows über `dispatch({ type: 'bootstrap', ... })` laufen (siehe `ProjectSettings.tsx`, `NewProjectDialog`, WS-Reconnect). Kein zusätzlicher Effekt-Hook nötig.
- **Alternatives considered**:
  - Auflösung in einem `useEffect` in `App.tsx`: verteilt Logik, race-anfällig gegenüber dem Reducer.
  - Serverseitige „Default-Projekt"-Persistenz: unnötiger Server-Eingriff; Auswahl ist eine reine Client-Präferenz.

## D3: Persistenz der Auswahl

- **Decision**: Die gewählte Projekt-ID wird bei jedem erfolgreichen `select_project` (mit `projectId !== null`) in `localStorage` unter `sdd-selected-project` geschrieben und beim Bootstrap als Fallback gelesen.
- **Rationale**: Konsistent mit vorhandenen UI-Präferenzen (`sdd-show-completed`, `sdd-sound`, `sdd-grid-panes:*`). Erfüllt FR-005/SC-005 ohne Server. Robust gegen entfernte Projekte, weil der Bootstrap die Existenz gegenprüft.
- **Alternatives considered**: `sessionStorage` (übersteht Neustart nicht → verletzt FR-005); URL-Query-Param (überzogen für lokale Desktop-App).

## D4: `select_project`-Signatur

- **Decision**: Der `select_project`-Action-Typ wird auf `{ type: 'select_project'; projectId: string }` verengt (kein `null` mehr), da es keinen Bedienweg mehr gibt, `null` bewusst zu wählen. Die bestehende Kontext-Trennungslogik (fremde Konsole/Terminal → Board) bleibt erhalten und greift jetzt bei jedem Wechsel, da `projectId` immer gesetzt ist.
- **Rationale**: Verhindert per Typ, dass „Alle Projekte" versehentlich wieder eingeführt wird (SC-003). Der `null`-Sonderfall existiert nur noch intern im State, nie als Nutzeraktion.
- **Alternatives considered**: Signatur bei `string | null` belassen — würde die entfernte Funktion im Typ weiterleben lassen (verletzt „keine Backwards-Compat-Shims").

## D5: `GridView`-Pane-Persistenz-Key

- **Decision**: `storageKey(projectId)` behält seine pro-Projekt-Struktur; der Fallback `?? 'all'` wird zu `?? 'none'` (nur für den projektlosen Randfall). Bestehende `sdd-grid-panes:all`-Einträge werden nicht migriert (verworfen).
- **Rationale**: Ohne „Alle Projekte" gibt es keinen sinnvollen `all`-Scope mehr. Der Verlust alter `all`-Panes ist folgenlos (reiner UI-State, FR-frei). SC/Datenintegrität nicht betroffen.
- **Alternatives considered**: Migration alter `all`-Panes auf das Startprojekt — künstlich, ohne Nutzwert.

## D6: Verifikationsstrategie

- **Decision**: Statische Verifikation über `pnpm --filter @sdd/web typecheck` (fängt alle verbliebenen `null`-Annahmen) plus manuelles Quickstart mit ≥ 2 Projekten. Keine neuen automatisierten Tests (Repo hat im MVP bewusst keine Web-Tests).
- **Rationale**: Die Änderung ist typgetrieben; das Verengen der Action-Signatur macht übersehene `null`-Pfade zu Compile-Fehlern. Ein Test-Framework nur für dieses Feature einzuführen widerspräche dem minimalen Umfang.
- **Alternatives considered**: Vitest + React Testing Library einführen — überzogen für den MVP-Stand; kann später projektweit erfolgen.
