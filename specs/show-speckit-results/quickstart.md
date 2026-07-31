# Quickstart / Validierung: Speckit-Zwischenresultate

Manuelle End-to-End-Validierung der User Stories. Details der Typen/Endpunkte: siehe [data-model.md](./data-model.md) und [contracts/feature-artifacts-api.md](./contracts/feature-artifacts-api.md).

## Voraussetzungen

```bash
pnpm install          # inkl. neuer WYSIWYG-Editor-Dependency (web)
pnpm typecheck        # alle Pakete grün
pnpm test             # shared- + server-Unit-Tests grün (featureArtifacts.*)
pnpm dev              # Server :4820 + Web :4830
open http://localhost:4830
```

Ein Projekt mit einem Feature, das mindestens `spec.md` besitzt (z. B. dieses Repo mit `specs/show-speckit-results/`). Empfehlung für den Round-Trip-Test: das Feature `spec-kit-spezifikation-einsehen` (hat `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `tasks.md`, `contracts/`, `checklists/`).

## US1 — Ergebnis lesbar einsehen (P1)

1. Board öffnen → Feature-Kachel zeigt Icons für Specify/Plan/Tasks/Checklist.
2. Mit dem Zeiger über ein Icon fahren → Tooltip beschreibt das Zwischenresultat. ⇒ FR-002
3. Icon „Specify" klicken → Modal öffnet sich, `spec.md` wird **formatiert** (Überschriften/Listen/Tabellen), **nicht** als Markdown-Quelltext angezeigt, in < 1 s. ⇒ FR-003/FR-005, SC-001/SC-002
4. Bei Plan den Datei-Umschalter nutzen (`plan.md` ↔ `research.md` ↔ `contracts/*`). ⇒ FR-018
5. Icon eines Schritts ohne Ergebnis (z. B. Tasks vor `/speckit-tasks`) ist deaktiviert und erklärt dies per Tooltip; Klick öffnet kein leeres Modal. ⇒ FR-006
6. Modal schließen → zurück zum Board ohne Zustandsverlust. ⇒ FR-017

## US2 — Bearbeiten & Speichern (P2)

1. Modal offen, Feature **nicht** aktiv → oben rechts „Bearbeiten" → Editor zeigt denselben Rich-Text (kein Markdown-Quelltext). ⇒ FR-007/FR-008, SC-003
2. Kleine Änderung, „Speichern" → Erfolgsbestätigung; Datei unter `specs/<feature>/…` ist aktualisiert. ⇒ FR-009
3. Modal schließen und erneut öffnen → Änderung ist vorhanden. ⇒ SC-004
4. **Round-Trip**: `tasks.md` öffnen (enthält `- [ ]`), ohne inhaltliche Änderung speichern → `git diff` zeigt keine kaputten Checkboxen/Tabellen/Codeblöcke. ⇒ FR-010, SC-004
5. **Ungespeichert**: ändern, dann schließen wollen → Verwerfen-Warnung. ⇒ FR-013
6. **Konflikt**: Modal im Editiermodus offen lassen, Datei extern ändern, speichern → Überschreiben-vs-Neuladen-Dialog. ⇒ FR-014, SC-005
7. **Sperre**: für das Feature eine Phase starten (Status `running`) → Modal ist nur lesend, „Bearbeiten" gesperrt mit Hinweis; Einsehen weiter möglich. ⇒ FR-011, SC-005
8. **Speicherfehler**: Datei schreibgeschützt setzen, speichern → verständliche Fehlermeldung, Eingaben bleiben erhalten. ⇒ FR-012

## US3 — Split-Screen-Claude-Session (P3)

1. Modal offen → „Split-Screen" auslösen → rechts erscheint die bestehende Feature-Konsole (interaktives Terminal), Modal bleibt links sichtbar. ⇒ FR-015, SC-008
2. In beiden Bereichen gleichzeitig arbeiten (im Modal scrollen/bearbeiten, in der Konsole tippen). ⇒ FR-016
3. Split-Screen schließen → Modal bleibt offen, Ansicht/Editiermodus unverändert. ⇒ FR-016

## Automatisierte Tests (Vitest)

- `packages/shared/src/featureArtifacts.test.ts`: Phase→Datei-Mapping, Enumeration mit/ohne Begleitartefakte, `featureLock()` (running vs. nicht).
- `packages/server/src/services/featureArtifacts.test.ts`: Lesen (exists/nicht), Schreiben-Erfolg, `conflict` bei mtime-Abweichung, `locked` bei laufender Phase, `not_found`.

## Definition of Done (Abgleich)

Alle FR-001…FR-018 über die Schritte oben abgedeckt; SC-001…SC-008 beobachtbar; `pnpm typecheck` + `pnpm test` grün; keine neue SQLite-Migration; `~/.claude/` unberührt.
