# Code-Review: Grid-Ansicht zeigt aktive Sessions automatisch an

**Branch**: `feature/grid-ansicht-soll-automatisch-aktive-sessions-anzeigen`
**Default-Branch**: `main`
**Merge-Base**: `ff8b6a3`
**Reviewer**: adversarial code review (streng)
**Datum**: 2026-07-23

## Umfang

Diff der Code-Änderungen gegenüber dem Merge-Base:

| Datei | Art |
|---|---|
| `packages/shared/src/gridAutoSelect.ts` | neu — reine Auswahllogik |
| `packages/shared/src/gridAutoSelect.test.ts` | neu — 11 Unit-Tests |
| `packages/shared/src/index.ts` | Re-Export |
| `packages/server/src/pty/sessionManager.ts` | `lastActiveAt` einführen/pflegen |
| `packages/server/src/events.ts` | `lastActiveAt` im `session_status`-Event |
| `packages/server/src/api/server.ts` | `lastActiveAt` im Bootstrap |
| `packages/server/src/services/orchestrator.ts` | `lastActiveAt` mitsenden |
| `packages/server/src/services/chatWorkService.ts` | `lastActiveAt` mitsenden |
| `packages/web/src/api.ts` | `lastActiveAt` im `LiveSessionInfo` |
| `packages/web/src/store.tsx` | Reducer trägt `lastActiveAt` |
| `packages/web/src/components/GridView.tsx` | Auto-Belegung statt localStorage |

## Methodik & Einschränkung

Verifikation erfolgte **rein statisch** (Datenfluss- und Typ-Analyse, Abgleich mit `spec.md`).
`pnpm test` und `pnpm typecheck` konnten in dieser Session nicht ausgeführt werden
(Ausführungsrechte verweigert). Die Typ-Kompatibilität der Cross-Package-Kette
(`LiveSessionInfo[]` → `GridSessionCandidate[]`, `Set<string>` → `ReadonlySet<string>`,
Re-Export aus `@sdd/shared`) wurde manuell geprüft und ist schlüssig, wurde aber nicht
vom Compiler bestätigt.

## Bewertung der Kernlogik (`selectAutoPanes`)

Die reine Auswahlfunktion ist korrekt und deckt die Anforderungen sauber ab:

- **FR-002/FR-003/FR-011**: Filter `status === 'working' || 'awaiting_input'` und `!exited`
  schließt idle/stopped/errored/beendet korrekt aus. ✔
- **FR-008**: Projekt-Filter `s.projectId !== opts.projectId` greift zuerst. ✔
- **FR-012**: Deduplizierung pro Feature via `Map`, wobei der **größte** (= jüngste)
  `lastActiveAt` je Feature gewinnt (`at > prev`). ✔
- **FR-013**: Sessions ohne Feature-Bezug werden über `featureId === null` ausgeschlossen.
  Gegengeprüft: Chat-Work-Sessions (`chatWorkService.ts:108`) und Shell-Sessions
  (`server.ts:191`) werden beide mit `featureId: null` gespawnt → sie können nie
  auto-belegt werden. ✔ (Das Feld `kind` in `GridSessionCandidate` wird von der Logik
  nicht genutzt; `featureId === null` ist das eigentliche Kriterium — siehe Hinweis M5.)
- **FR-004/FR-006/SC-003**: Sortierung `b[1] - a[1]` (Zeit absteigend), dann `slice(0, max)`
  → die N jüngsten, neueste zuerst. ✔
- **FR-005/SC-002**: Kappung auf `max`; zusätzlich sperrt `opts.max <= 0` und `projectId === null`
  die Auswahl vollständig. ✔
- **FR-009/SC-005**: Total-Order-Comparator mit Tiebreak über Feature-Id (aufsteigend) →
  deterministisch unabhängig von Eingabereihenfolge. Der Test mit umgekehrter Eingabe
  bestätigt Stabilität. ✔

Die Testabdeckung ist für ein reines Modul angemessen (Projekt-/Sichtbarkeits-/Zustands-/
Feature-Filter, Dedup, Sortierung, Kappung, Tiebreak, Leer- und Randfälle).

## Integration Frontend (`GridView.tsx`) & Datenfluss

- **FR-001/FR-010 (Override beim Öffnen)**: `GridView` wird in `App.tsx:99` via
  `state.view.kind === 'grid' && <GridView />` bedingt gerendert → jedes Öffnen ist ein
  echter Remount, `initializedScopeRef` startet als `undefined` → Neubelegung. Die
  vorherige localStorage-Persistenz wurde vollständig und ohne Rückstände entfernt
  (kein dangling `sdd-grid-panes`-Key mehr). ✔
- **FR-014 (kein Nachrücken)**: Nach der Erstbelegung friert `initializedScopeRef.current === scope`
  jede weitere Auswertung ein; laufende `session_status`-Updates ändern zwar `state.app`
  (Effekt läuft erneut), führen aber wegen des Ref-Guards zu keiner Neuauswahl. Der
  Zustands-Punkt der Kachel (`session.status`) aktualisiert sich weiterhin live. ✔
- **FR-008 (Projektwechsel)**: Bei Scope-Wechsel gilt `ref !== scope` → Neubelegung für das
  neue Projekt; Rückwechsel belegt ebenfalls neu. ✔
- **US3 (manuelles Nachjustieren)**: `addPane`/`removePane` bleiben funktionsfähig; da der
  Ref-Guard nach der Erstbelegung greift, überleben manuelle Ergänzungen/Entfernungen
  spätere Session-Updates innerhalb derselben geöffneten Ansicht. `MAX_PANES`-Grenze in
  `addPane` gewahrt. ✔
- **Server→Client-Kette**: `lastActiveAt` wird bei Session-Erstellung gesetzt
  (`sessionManager.ts:151`) und bei jedem Übergang nach `working`/`awaiting_input`
  aktualisiert (`:235`). Es fließt über Bootstrap (`server.ts:79`) **und** über beide
  `session_status`-Emitter (`orchestrator.ts:351`, `chatWorkService.ts:217`) — es gibt genau
  diese zwei Emitter, beide setzen das Feld. Das Bus-Event ist `1:1`-Broadcast, das Feld ist
  in `events.ts` als `number` erzwungen. ✔

## Findings

Keiner der folgenden Punkte ist ein Merge-Blocker. Es sind Hinweise zur Qualität; das
Feature ist funktional korrekt und spec-konform.

### M1 — `Date.now()` im Reducer verletzt Reiner-Reducer-Prinzip (minor)
`store.tsx:97`: `lastActiveAt: p.lastActiveAt ?? prev?.lastActiveAt ?? Date.now()`.
Ein React-Reducer sollte seiteneffektfrei/pur sein; `Date.now()` macht ihn nicht-deterministisch.
Praktisch **unerreichbar**, da der Server `lastActiveAt` immer mitsendet (Typ erzwingt es) und
Bootstrap alle Sessions abdeckt — der Fallback greift nie. Empfehlung: auf `?? prev?.lastActiveAt ?? 0`
zurückfallen (deterministisch), statt der Uhr. Kein Verhaltensfehler beobachtbar.

### M2 — `lastActiveAt` wird bei jedem `working`-Signal neu gesetzt, nicht nur beim Übergang (minor/informativ)
`sessionManager.ts:235` bumpt den Zeitstempel bei **jedem** Dispatch, dessen Ergebnis-Kind
`working`/`awaiting_input` ist — auch wenn die Session bereits arbeitete (z. B. je Transkript-Signal).
Das operationalisiert „zuletzt aktiv" statt strikt „begann zu arbeiten" (Clarification-Wortlaut).
Da die Clarification den Wert selbst „**Letzter Aktivitätszeitpunkt**" nennt und das Feld
`lastActiveAt` heißt, ist die Interpretation vertretbar. SC-005 bleibt erfüllt (bloßes Wieder-Öffnen
ohne neue Signale ändert den Wert nicht). Nur zur Kenntnis; ggf. bewusst dokumentieren.

### M3 — `plan.md` ist ein nicht ausgefülltes Template (minor, Doku)
Die committete `specs/.../plan.md` enthält nur die Platzhalter des Speckit-Templates
(`# Implementation Plan: [FEATURE]`, `[DATE]`, `[###-feature-name]` …). `tasks.md` weist
selbst darauf hin und leitet den Tech-Kontext aus dem Code ab. Betrifft nicht den lauffähigen
Code; sollte vor dem Merge aber entweder ausgefüllt oder nicht als Platzhalter eingecheckt werden.

### M4 — `state.showCompleted` in Effekt-Deps ist faktisch wirkungslos (minor)
`GridView.tsx:43` listet `state.showCompleted` als Dependency, doch der Ref-Guard verhindert
eine Neuauswertung bei bloßem Umschalten von „Abgeschlossene anzeigen". Das ist konsistent mit
FR-014 (kein Nachrücken), aber die Dependency ist irreführend, weil sie nur beim ohnehin
neu belegenden Erst-Mount/Scope-Wechsel wirkt. Kosmetisch.

### M5 — `kind` in `GridSessionCandidate` ungenutzt (nit)
Das Feld wird in `selectAutoPanes` nicht gelesen (Ausschluss erfolgt über `featureId === null`).
Es dient nur der Testlesbarkeit. Kein Fehler; könnte entfallen.

## Anforderungs-Konformität (Zusammenfassung)

| Req | Status |
|---|---|
| FR-001 Auto-Belegung beim Öffnen | ✔ |
| FR-002 „aufmerksamkeitsbedürftig" = working/awaiting_input | ✔ |
| FR-003 idle/stopped/errored/beendet ausgeschlossen | ✔ |
| FR-004 Sortierung neueste zuerst | ✔ |
| FR-005 Höchstzahl nie überschritten | ✔ |
| FR-006 bei Überzahl N jüngste | ✔ |
| FR-007 manuelles Nachjustieren | ✔ |
| FR-008 nur aktuelles Projekt | ✔ |
| FR-009 stabile Reihenfolge bei Gleichstand | ✔ |
| FR-010 Override der manuellen Auswahl | ✔ |
| FR-011 nur working/awaiting automatisch | ✔ |
| FR-012 eine Kachel/Feature, zuletzt aktive zählt | ✔ |
| FR-013 Sessions ohne Feature-Bezug ausgeschlossen | ✔ (per `featureId === null` verifiziert) |
| FR-014 kein Nachrücken, Zustand aber live | ✔ |

## Fazit

Die Änderung ist gut geschnitten: die Auswahllogik liegt als reines, testbares Modul in
`@sdd/shared`, die Server-Kette liefert `lastActiveAt` konsistent über alle Pfade, und die
Frontend-Integration setzt Override (FR-010) und Einfrieren (FR-014) über einen sauberen
Remount-/Ref-Mechanismus korrekt um. Alle funktionalen Anforderungen sind erfüllt. Es wurden
**keine merge-blockierenden Fehler** gefunden — nur die kleineren Qualitätshinweise M1–M5.
Einschränkung: automatisierte Tests/Typecheck konnten nicht ausgeführt werden; die Verifikation
ist statisch.

VERDICT: PASS
