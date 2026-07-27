# Implementation Plan: Dokument-Upload bei manueller Feature-Erfassung

**Branch**: `feature/dokument-upload-bei-manueller-feature-erfassung` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/dokument-upload-bei-manueller-feature-erfassung/spec.md`

## Summary

Der Dialog „Neues Feature" nimmt zusätzlich Dateien entgegen (Dateiauswahl und Drag & Drop).
Beim Anlegen legt der Server das Feature wie bisher an, schreibt die Dokumente unverändert
nach `specs/<slug>/docs/` im Feature-Worktree, hält Anzeigename, abgelegten Namen, Größe und
Übernahmezeitpunkt in einem Manifest `documents.json` fest, committet beides und startet erst
danach den Specify-Lauf. Ein kompakter Verweis (Namen + Fundorte, keine Inhalte) wird zentral
in `Orchestrator.launchPhase()` an **jeden** Phasenprompt gehängt, solange Dokumente
vorliegen — dadurch bleibt das Material über Planung, Aufgabenbildung und Umsetzung hinweg
präsent, auch nach `/compact` oder `/clear`. Ohne Dokumente ändert sich am bestehenden Ablauf
nichts: der Dialog nutzt weiter die JSON-Route und der Prompt ist zeichengleich mit dem
heutigen.

Keine Datenbankänderung, keine neue Abhängigkeit — `@fastify/multipart` ist bereits mit
25-MB-Grenze registriert, und die Ablage folgt dem bestehenden Muster des Jira-Dossiers.

## Technical Context

**Language/Version**: TypeScript (strict) auf Node ≥ 22, pnpm-Monorepo (`packages/server`, `packages/web`, `packages/shared`)

**Primary Dependencies**: Fastify 5 mit `@fastify/multipart` 10.1 (bereits registriert, `api/server.ts:110`), better-sqlite3 12, Vite/React (Web) — **keine neue Abhängigkeit**

**Storage**: Dateisystem des Feature-Worktrees — `specs/<slug>/docs/` mit Manifest `documents.json`, git-versioniert und sofort committet. **Keine SQLite-Migration** (Begründung: [research.md](./research.md) R2)

**Testing**: Vitest 3 (`packages/shared`, `packages/server`, kolokierte `*.test.ts`); Web ohne Test-Harness (bestehende MVP-Konvention)

**Target Platform**: Lokale Web-App (macOS-Dev), Server-Port 4820, Vite-Dev 4830

**Project Type**: Web-Service (Fastify) + SPA (React) im bestehenden Monorepo — keine neuen Pakete

**Performance Goals**: SC-001 Anlegen inkl. Dokumentauswahl < 60 s; Dateien werden gestreamt statt gepuffert (bis 20 × 25 MB), sodass der Speicherbedarf unabhängig von der Uploadgröße bleibt

**Constraints**: Dokumente bleiben byteweise unverändert (FR-003); im Prompt stehen ausschließlich Name und Fundort, nie Inhalte (FR-009); Teilfehler dürfen das Feature nicht verhindern (FR-014) und ein gescheitertes Anlegen keine verwaisten Dateien hinterlassen (FR-015); ohne Dokumente identischer Prompt wie bisher (FR-017, SC-006)

**Scale/Scope**: Einzelnutzer, lokal; 3 User Stories, 3 neue HTTP-Routen, 3 neue Module (1 shared, 2 server), 1 erweiterter Dialog + 1 neue Web-Komponente, 0 Migrationen

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein unausgefülltes Template — es existieren keine
projektspezifischen Gates. Ersatzweise geprüfte allgemeine Prinzipien:

| Prüfung | Ergebnis |
|---|---|
| Keine neuen Pakete, Schichten oder Abhängigkeiten — bestehende Monorepo-Struktur wird erweitert | PASS |
| Bestehende Konventionen wiederverwendet (Routen in `server.ts`, Services flach unter `services/`, Ablage analog Jira-Dossier, Prompt-Anhang analog Wissens-Präambel) | PASS |
| Pure Logik (Preamble-Text, Grenzen, Dateinamen-Härtung) liegt isoliert testbar in `packages/shared` bzw. einem eigenen Server-Modul | PASS |
| Kein Zustand doppelt gehalten — Disk ist die einzige Wahrheit, keine DB-Spiegelung | PASS |
| Duplikat vermieden statt hinzugefügt: `sanitizeFilename`/`uniqueFilename` werden aus `jiraImportService.ts` extrahiert und von beiden Aufrufern genutzt | PASS |

**Re-Check nach Phase-1-Design**: unverändert PASS. Das Design fügt weder Projekte noch
Abstraktionsschichten hinzu; die einzige strukturelle Änderung ist das Herauslösen zweier
bestehender Helfer in ein gemeinsames Modul. Die Complexity-Tracking-Tabelle bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/dokument-upload-bei-manueller-feature-erfassung/
├── spec.md                        # Feature-Spezifikation (vorhanden)
├── plan.md                        # Diese Datei (/speckit-plan)
├── research.md                    # Phase-0-Output (/speckit-plan)
├── data-model.md                  # Phase-1-Output (/speckit-plan)
├── quickstart.md                  # Phase-1-Output (/speckit-plan)
├── contracts/
│   ├── feature-documents-api.md   # HTTP-Contract der drei neuen Routen
│   └── document-preamble.md       # Prompt-Contract des Dokument-Verweises
├── checklists/                    # /speckit-checklist-Output (vorhanden)
└── tasks.md                       # /speckit-tasks-Output (noch nicht erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── featureDocuments.ts            # NEU: FeatureDocument-Typen, Grenzen-Konstanten,
│                                  #      buildDocumentsPreamble() (pur), formatBytes()
├── featureDocuments.test.ts       # NEU
└── index.ts                       # Export ergänzen

packages/server/src/
├── services/
│   ├── safeFilename.ts            # NEU: sanitizeFilename/uniqueFilename (aus jiraImportService extrahiert, gehärtet)
│   ├── safeFilename.test.ts       # NEU
│   ├── featureDocuments.ts        # NEU: Schreiben + Manifest + Commit, Listen, Preamble-Quelle
│   ├── featureDocuments.test.ts   # NEU
│   ├── jiraImportService.ts       # nutzt safeFilename.ts statt lokaler Kopien
│   └── orchestrator.ts            # launchPhase(): Dokument-Verweis an den Prompt hängen
├── api/server.ts                  # + POST /api/projects/:id/features/with-documents
│                                  # + GET  /api/features/:id/documents
│                                  # + POST /api/features/:id/documents/open
└── api/server.test.ts             # Contract-Prüfungen ergänzen

packages/web/src/
├── components/
│   ├── NewFeatureDialog.tsx       # Dateiauswahl + Drop-Zone + Liste + Grenzen-Hinweis
│   ├── FeatureDocumentsDialog.tsx # NEU: hinterlegte Dokumente ansehen/öffnen (FR-016)
│   ├── FeatureConsole.tsx         # Header-Icon „Dokumente" (nur wenn vorhanden)
│   └── FeatureDashboard.tsx       # Abschnitt „Dokumente" neben den Artefakten
└── api.ts                         # createFeatureWithDocuments, featureDocuments, openFeatureDocument
```

**Structure Decision**: Bestehendes Monorepo, keine neuen Pakete. Die Aufteilung folgt der
im Projekt etablierten Trennung — pure, testbare Logik (Prompt-Text, Grenzen) in
`packages/shared`, Dateisystem- und Git-Zugriff in einem flachen Service unter
`packages/server/src/services/`, Routen ausschließlich in `api/server.ts`, Oberfläche in
`packages/web/src/components/`. Der neue Server-Service ist das direkte Gegenstück zu
`jiraImportService.writeTicketMaterial()`, mit dem er sich die Dateinamen-Härtung teilt.

## Umsetzung in Reihenfolge der User Stories

Jede Story bleibt für sich lauffähig; die Reihenfolge entspricht ihrer Priorität.

**Fundament (vor US1)** — `packages/shared/src/featureDocuments.ts` (Typen, Grenzen,
`buildDocumentsPreamble`) und `packages/server/src/services/safeFilename.ts` samt Umstellung
des Jira-Imports. Beides ist rein und ohne Oberfläche testbar.

**US1 (P1) — Dokumente beim Anlegen mitgeben.** Server-Service `featureDocuments.ts`
(schreiben, Manifest, Commit, listen), multipart-Route, Verweis-Injektion in `launchPhase`,
Dialog-Erweiterung mit Dateiauswahl und Drop-Zone. Danach ist der Kernnutzen vollständig:
Dokument mitgeben → Spezifikation baut darauf auf.

**US2 (P2) — Verweis über alle Schritte.** Fällt größtenteils bereits mit der Injektion in
`launchPhase` an (sie deckt alle Phasenstartwege ab). Eigenständig bleibt der Nachweis:
Tests für Reset-Fälle (`/compact`, `/clear`), für den zeichengleichen Prompt ohne Dokumente
und für die Auto-Progress-Kette über `startAgentForApprovedChain`.

**US3 (P3) — Auswahl prüfen und später einsehen.** Entfernen einzelner Dateien im Dialog,
sichtbare Grenzen, Meldung abgelehnter Dateien, Listen-Route, `FeatureDocumentsDialog` sowie
die Einstiege in Konsole und Dashboard.

## Berührte bestehende Stellen

| Stelle | Änderung | Risiko |
|---|---|---|
| `orchestrator.ts:419` `launchPhase()` | Prompt um den Dokument-Block erweitern (leer ohne Dokumente); Lesen best-effort in `try/catch`, damit ein defektes Manifest nie eine Phase blockiert | Zentral für **alle** Phasenstarts — durch den Gleichheitstest ohne Dokumente abgesichert |
| `jiraImportService.ts:310–323` | Lokale `sanitizeFilename`/`uniqueFilename` durch Import aus `safeFilename.ts` ersetzen | Verhalten bleibt gleich, wird strenger (`..`, Steuerzeichen); bestehende Tests decken es ab |
| `api/server.ts` | Drei Routen ergänzen; die bestehende JSON-Feature-Route bleibt unverändert | Gering — additiv |
| `NewFeatureDialog.tsx` | Dateiauswahl, Drop-Zone, Liste, zwei Absende-Pfade | Der dokumentlose Pfad bleibt der heutige Aufruf |

## Bewusste Abgrenzungen

- **Keine Injektion in Gate-Agents, Verify- und Konfliktauflösungs-Läufe.** Die Spec spricht
  von „Arbeitsschritten des Features"; SC-003 misst „alle für das Projekt aktivierten
  Schritte" — das sind die Phasen aus `FEATURE_PHASES`.
- **Kein Nachreichen** von Dokumenten zu bestehenden Features (Spec-Annahme); der bestehende
  Weg über die Feature-Konsole bleibt davon unberührt.
- **Keine Inhaltsauswertung** durch das Toolkit — keine Textextraktion, keine
  Zusammenfassung, keine Formatumwandlung (Spec-Annahme, FR-003).
- **Jira-Import bleibt unverändert** in seinem Ablauf; er gewinnt lediglich die gehärtete
  Dateinamen-Behandlung.

## Bekannte Konsequenz

Der sofortige Dokument-Commit (R1) gibt dem Feature-Branch von Anfang an einen eigenen
Commit. Dadurch meldet `integrationHasChanges()` (`api/server.ts:860`) bereits vor der ersten
Phase `true` und die Integrations-Aktion ist früher freigeschaltet als bisher gewohnt. Das
ist sachlich korrekt — es *gibt* etwas zu integrieren — und entschärft nebenbei den in
`mergeQueueService.reconcile()` dokumentierten Fallstrick, dass ein Branch ohne eigene
Commits trivial als „gemergt" gilt.

## Complexity Tracking

> Keine Constitution-Verletzungen — Tabelle bleibt leer.
