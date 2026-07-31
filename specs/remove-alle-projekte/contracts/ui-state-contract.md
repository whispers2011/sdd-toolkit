# UI State & Behavior Contract: Nur ein Projektkontext

**Feature**: Nur ein Projektkontext — „Alle Projekte" entfernen
**Date**: 2026-07-22

Diese App hat keine externe API-Fläche für dieses Feature (Server bleibt unangetastet). Der relevante Vertrag ist der **Store-/UI-Vertrag** zwischen `store.tsx` und den Komponenten. Er definiert die einzuhaltenden Invarianten und Verhaltensweisen; jede verletzt bei Nichteinhaltung eine Funktionsanforderung.

## C1 — Kontext-Invariante (FR-001)

- **Gegeben** `state.app` ist geladen und `state.app.projects.length > 0`.
- **Dann** MUSS `state.selectedProjectId` eine ID aus `state.app.projects` sein — niemals `null`, niemals mehrere.
- **Prüfung**: In keiner Ansicht sind gleichzeitig Inhalte zweier Projekte sichtbar (SC-001).

## C2 — Keine „Alle Projekte"-Auswahl (FR-002, SC-003)

- Die Sidebar MUSS **keinen** „Alle Projekte"-Bedienpunkt mehr rendern.
- Der `select_project`-Action-Typ MUSS `projectId: string` fordern (kein `null`).
- **Prüfung**: Kein Element mit Text „Alle Projekte" auffindbar; TypeScript verhindert `select_project` mit `null`.

## C3 — Projektgebundene Sichtbarkeit (FR-003)

Für jede der folgenden Ableitungen gilt: Element ist sichtbar **gdw.** sein `projectId === state.selectedProjectId` (kombiniert mit bestehendem Abgeschlossen-Filter, wo zutreffend):

| Konsument | Gefilterte Menge |
|-----------|------------------|
| `visibleFeatures()` / `KanbanBoard` | Features |
| `GridView` | Feature-Konsolen (Panes) |
| `AttentionInbox` | Attention-Items |
| `ExecutionsView` | Ausführungen |
| `KanbanBoard.enabledUnion` | aktivierte Phasen (nur aktives Projekt) |

- **Prüfung**: Bei zwei Projekten A/B mit A aktiv erscheint kein B-Inhalt.

## C4 — Bootstrap-Auflösung (FR-004, FR-006, FR-008)

Bei jedem `dispatch({ type: 'bootstrap', state })` MUSS der Reducer `selectedProjectId` nach folgender Regel setzen:

```text
if aktuelle selectedProjectId ∈ state.projects        → beibehalten
else if localStorage['sdd-selected-project'] ∈ state.projects → diese wählen
else if state.projects nicht leer                     → state.projects[0].id
else                                                  → null
```

- Deckt ab: Erststart, WS-Reconnect-Refetch, Projekt-Entfernung (Neu-Fetch), erstes Projekt-Hinzufügen.
- **Prüfung**: Nach Entfernen des aktiven Projekts zeigt der Store ein anderes vorhandenes Projekt; nach Hinzufügen des ersten Projekts ist dieses aktiv.

## C5 — Persistenz (FR-005, SC-005)

- Jeder erfolgreiche `select_project` MUSS `localStorage['sdd-selected-project'] = projectId` setzen.
- Der Bootstrap MUSS diesen Wert als Fallback (C4, Schritt 2) verwenden.
- **Prüfung**: Projekt B wählen → App neu laden → B ist aktiv (sofern B noch existiert).

## C6 — Kontextwechsel bei Fremd-Navigation (FR-007, SC-004)

- Öffnet der Nutzer einen Inhalt eines anderen Projekts über **QuickSwitcher** (`⌘K`), **Benachrichtigungs-Klick** oder **Feature-Klick in der Sidebar**, MUSS vor/mit dem `set_view` ein `select_project` auf das Projekt des Inhalts erfolgen.
  - QuickSwitcher: bestehende `activate()`-Logik setzt `projectId` je Eintrag — bleibt gültig.
  - Sidebar-Feature-Klick: bestehende Doppel-Dispatch-Logik (`select_project` + `set_view`) bleibt.
  - Benachrichtigungs-Klick (`store.tsx` WS `notification`): MUSS zusätzlich das Projekt des Features wählen, bevor die Konsole geöffnet wird.
- **Prüfung**: 100 % der Navigationswege enden mit `selectedProjectId` == Projekt des angezeigten Inhalts.

## C7 — Leerzustand (FR-008)

- **Gegeben** `state.app.projects.length === 0` (`selectedProjectId === null`).
- **Dann** zeigt die Sidebar den bestehenden „Noch keine Projekte"-Hinweis; projektbezogene Ansichten rendern keine Inhalte, ohne Laufzeitfehler bei `null`-Scope.
- **Prüfung**: Start ohne Projekte wirft keine Fehler; Hinzufügen des ersten Projekts aktiviert es (C4).

## C8 — Erhalt der bestehenden Kontext-Trennung (Assumption)

- Die bestehende Regel in `select_project` (fremde `console`-/`shell`-View fällt auf `board` zurück) MUSS erhalten bleiben und greift nun bei jedem Wechsel, da `projectId` stets gesetzt ist.
