# Contract: Materialisiertes Wissen im Worktree

Beim Phasenstart schreibt `knowledgeService.materializeForFeature(feature, phase)` das **selektierte** Wissen in den Feature-Worktree. Dies ist die einzige abgeleitete Kopie außerhalb der DB (research.md D5). Strikt git-excluded → keine Verunreinigung der Feature-Diffs.

## Verzeichnislayout

```text
<worktree>/.sdd/knowledge/
├── index.md                      # IMMER — kompakter Baum (Titel + Anwendbarkeit, KEINE Inhalte)
├── bundles/<bundle-id>.md        # nur selektierte Bundles (Beschreibung/Anwendbarkeit)
└── entries/<entry-id>.md         # nur selektierte inline-Einträge (voller Body)
# source='file'-Einträge werden NICHT kopiert — index.md verweist auf den Repo-Pfad
```

## `index.md` — Format (immer vollständig, alle Elemente)

```markdown
# Projektspezifischer Wissens-Index

> Lies ZUERST diesen Index. Lade Inhalte NUR für die unten als **[relevant]** markierten
> Elemente (Dateien unter .sdd/knowledge/… bzw. den angegebenen Repo-Pfad). Nicht alles einlesen.

- **[relevant]** Bundle „Auth" — Anwendbarkeit: bei Login/Token/Session-Themen · Tags: auth, jwt
  - **[relevant]** Eintrag „Token-Rotation" → .sdd/knowledge/entries/<id>.md
  - Eintrag „Legacy-SSO" (nicht relevant) — Anwendbarkeit: nur bei SSO-Migration
- Bundle „Deployment" (nicht relevant) — Anwendbarkeit: bei CI/CD/Release-Themen · Tags: ci, release
- Eintrag „Coding-Conventions" [relevant] → Repo-Datei: docs/conventions.md   (source='file')
```

Regeln:
- Der **gesamte** Index wird gelistet (Übersicht über alles Verfügbare, FR-005/FR-007).
- Nur die per `ResolvedSelection.effective` bestimmten Elemente sind `[relevant]` markiert und haben eine materialisierte Datei bzw. einen Repo-Pfad-Verweis (FR-008/FR-009, SC-003).
- Anwendbarkeit (Freitext + Tags) wird je Element gezeigt, damit die Session/der Nutzer die Auswahl nachvollziehen kann (FR-014).

## Git-Ausschluss

`.sdd/` wird in `<worktree>/.git/info/exclude` eingetragen (Muster wie `.sdd-tmp/` in `api/server.ts`), **ohne** das Repo-`.gitignore` anzufassen. Best-effort, da Worktree-`.git` eine Datei ist (gitdir-Redirect) — dieselbe Behandlung wie beim Bild-Paste.

## Idempotenz & Re-Sync

- Bei jedem Phasenstart wird `.sdd/knowledge/` neu geschrieben (alter Stand überschrieben) → stets konsistent mit DB + Auswahl.
- `POST /api/features/:id/knowledge/materialize` erlaubt manuelles Neuschreiben (FR-013).

## Injektionskanal (Verweis)

Wie die Session zum Lesen von `index.md` gebracht wird, ist in research.md **D5** als Entscheidung mit Primär- (spec-kit-`before_*`-Hook/Template-Ergänzung) und Fallback-Weg (Prompt-Präambel) festgehalten; ein Mini-Spike in `tasks.md` bestätigt den finalen Kanal. Dieser Contract legt nur das **Dateiformat/-layout** fest, das unabhängig vom Kanal stabil ist.
