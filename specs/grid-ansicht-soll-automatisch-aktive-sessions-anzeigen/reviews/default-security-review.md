# Security-Review: grid-ansicht-soll-automatisch-aktive-sessions-anzeigen

- **Branch:** `feature/grid-ansicht-soll-automatisch-aktive-sessions-anzeigen`
- **Default-Branch:** `main`
- **Merge-Base:** `ff8b6a3264e73b351b877261d960b7a814c8a4dc`
- **Datum:** 2026-07-23

## Umfang

Geprüfter Code-Diff (ohne Spec-/Doku-Dateien):

| Datei | Art der Änderung |
|-------|------------------|
| `.specify/feature.json` | Config: aktives Feature-Verzeichnis umgestellt |
| `packages/server/src/api/server.ts` | `lastActiveAt` in Session-Antwort ergänzt |
| `packages/server/src/events.ts` | `lastActiveAt: number` im Bus-Event-Interface |
| `packages/server/src/pty/sessionManager.ts` | `lastActiveAt`-Feld, gesetzt via `Date.now()` |
| `packages/server/src/services/chatWorkService.ts` | `lastActiveAt` in Status-Event |
| `packages/server/src/services/orchestrator.ts` | `lastActiveAt` in Status-Event |
| `packages/shared/src/gridAutoSelect.ts` | Neue reine Funktion `selectAutoPanes` |
| `packages/shared/src/gridAutoSelect.test.ts` | Unit-Tests |
| `packages/shared/src/index.ts` | Re-Export |
| `packages/web/src/api.ts` | Typ-Feld `lastActiveAt` |
| `packages/web/src/components/GridView.tsx` | Auto-Belegung statt localStorage-Persistenz |
| `packages/web/src/store.tsx` | `lastActiveAt` in Reducer/Payload |

## Prüfergebnisse

### Injection-Risiken
Keine gefunden. Die neue Logik verarbeitet ausschließlich serverseitige Bezeichner (`featureId`, `projectId`) und numerische Zeitstempel. In `GridView.tsx`/`TerminalPane.tsx` wurde kein `dangerouslySetInnerHTML`, `innerHTML`, `eval` oder `new Function` eingeführt (verifiziert per Grep). `featureId`-Werte werden nur als React-Keys/Pane-Identifikatoren genutzt, nicht in eine Markup-/Code-Senke geschrieben.

### Unsichere Dateizugriffe
Keine. Es wurden keine `fs`-Operationen, Pfad-Konstruktionen oder Datei-Lookups hinzugefügt.

### Command-Injection
Keine. Kein Aufruf von `exec`, `spawn`, Shell o. Ä. im Diff. Der PTY-Session-Manager erhält lediglich ein zusätzliches Zahlenfeld; die Prozess-Startlogik bleibt unverändert.

### Secrets im Code
Keine Hardcoded-Credentials, Tokens oder Schlüssel. Neue Werte sind Zeitstempel (`Date.now()`).

### Unsichere Defaults
Unauffällig. Der Fallback `lastActiveAt: p.lastActiveAt ?? prev?.lastActiveAt ?? Date.now()` (store.tsx) verhindert Verlust des Zeitstempels bei reinen Status-Updates und ist ein sinnvoller, nicht sicherheitsrelevanter Default. `selectAutoPanes` behandelt fehlendes `lastActiveAt` deterministisch als `0` und bricht bei `projectId === null` bzw. `max <= 0` sicher mit leerer Auswahl ab.

### Validierung an Vertrauensgrenzen
Angemessen. `lastActiveAt` wird **serverseitig** erzeugt (nicht vom Client übernommen), ist also keine vom Nutzer kontrollierte Größe. `selectAutoPanes` ist eine reine, deterministische Funktion ohne Seiteneffekte und filtert konsequent nach Projekt-Zugehörigkeit (`s.projectId !== opts.projectId`), Feature-Sichtbarkeit (`visibleFeatureIds`), Beendigungs-Status (`exited`) und erlaubtem Status (`working` / `awaiting_input`). Die Sortierung nutzt numerischen Vergleich mit stabilem String-Tiebreak — kein Absturz- oder Manipulationspfad erkennbar.

## Positiv hervorzuheben

- Der Wegfall der localStorage-Persistenz in `GridView.tsx` **entfernt** einen `JSON.parse(localStorage.getItem(...))`-Pfad und reduziert damit die Angriffsfläche (Parsen potenziell manipulierter Client-Daten) statt sie zu vergrößern.
- Die Kernlogik ist isoliert, rein und durch Unit-Tests abgedeckt (Projekt-Isolation, Feature-Sichtbarkeit, Kappung auf `max`).

## Fazit

Es handelt sich um ein reines Anzeige-/UX-Feature mit einem serverseitig gesetzten Zeitstempel. Es wurden **keine echten Sicherheitsprobleme** in den genannten Kategorien gefunden. Die Projekt-Isolation als relevanteste Vertrauensgrenze ist korrekt umgesetzt.

VERDICT: PASS
