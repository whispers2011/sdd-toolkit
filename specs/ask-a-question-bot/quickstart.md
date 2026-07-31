# Quickstart: Ask-a-Question-Bot validieren

End-to-End-Validierung des Projekt-Chats gegen die Akzeptanzszenarien der [Spec](./spec.md). Datenformen: [data-model.md](./data-model.md) · API: [contracts/chat-api.md](./contracts/chat-api.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10, Claude Code CLI installiert und eingeloggt (`claude --version`)
- Ein registriertes Projekt im Toolkit (echtes lokales Repo)
- Abhängigkeiten installiert: `pnpm install`

## Start

```bash
pnpm dev          # startet @sdd/server + @sdd/web parallel
# Web-UI im Browser öffnen (Vite-Dev-URL aus der Konsole)
```

## Automatisierte Checks

```bash
pnpm -r typecheck
pnpm -r test      # inkl. neuer Unit-Tests: chatProposal (Marker-Parser), chatStream (stream-json-Parser), ChatRepo (Memory-DB)
```

Erwartung: alles grün; die neuen Tests decken Parser-Grenzfälle (kein Marker, mehrere Marker, kaputtes Attribut) und die Eine-aktive-Konversation-Invariante ab.

## Szenario 1 — Projektfrage ohne Artefakte (US1 / FR-001–FR-004)

1. Projekt in der Sidebar auswählen → **Erwartung**: Sprechblase erscheint unten rechts (nur bei geöffnetem Projekt).
2. Sprechblase anklicken (1 Klick, SC-001) → Panel öffnet sich, Eingabefeld fokussiert.
3. Frage stellen, z. B. „Wie funktioniert die Merge-Queue in diesem Projekt?" → **Erwartung**: Antwort beginnt < 15 s zu streamen (SC-003) und nimmt inhaltlich Bezug auf den Projektcode.
4. Artefakt-Freiheit prüfen (SC-002):
   ```bash
   git -C <projektpfad> status --porcelain   # leer
   ```
   Feature-Übersicht in der UI: kein neuer Eintrag; keine neue Worktree unter dem Daten-Verzeichnis.

## Szenario 2 — Feature-Übergabe (US2 / FR-005–FR-008, FR-011)

1. Im Chat eine feature-würdige Anforderung beschreiben, z. B. „Ich hätte gern einen PDF-Export aller Features mit Kostenübersicht."
2. **Erwartung**: Der Assistent weist darauf hin, dass das ein eigenes Feature wäre, und zeigt eine Vorschlag-Karte (Name + Beschreibung) mit „Feature anlegen" / „Ablehnen".
3. „Feature anlegen" → **Erwartung**: bestehender Anlege-Dialog öffnet sich **vorbefüllt**; Beschreibung anpassen, bestätigen.
4. **Erwartung**: Feature erscheint in der Übersicht, Worktree + Specify-Phase starten wie bei manueller Anlage (FR-007); der Chat bestätigt und verlinkt das Feature (FR-011); Karte zeigt „angenommen".
5. Gegentest Ablehnen: neuen Vorschlag provozieren, „Ablehnen" → Unterhaltung läuft weiter, nichts angelegt (FR-008). Dialog-Abbruch: Vorschlag bleibt offen und erneut aufrufbar.
6. Gegentest Fehlalarm (SC-005): einfache Frage stellen („Was macht `slugify`?") → keine Vorschlag-Karte.

## Szenario 3 — Projektunabhängige Frage (US3)

Frage ohne Projektbezug stellen (z. B. „Erkläre WAL-Modus in SQLite"). **Erwartung**: normale Antwort, kein erzwungener Projektbezug, kein Feature-Vorschlag.

## Szenario 4 — Persistenz über Neustart (FR-009, Clarification 1)

1. Nach Szenario 1: Panel schließen, wieder öffnen → Verlauf vollständig da.
2. `pnpm dev` stoppen und neu starten, Projekt öffnen, Panel öffnen → **Erwartung**: kompletter Verlauf wieder da; Folgefrage („Und wie wird sie getestet?") zeigt, dass der Gesprächskontext fortgesetzt wird (`--resume`).
3. „Neue Unterhaltung" klicken → leerer Chat; Neustart zeigt weiterhin die neue (leere bzw. neu befüllte) Unterhaltung, nicht die alte.

## Szenario 5 — Fehler & Nebenläufigkeit (FR-010, Edge Cases)

1. Senden, während eine Antwort läuft → Senden-Button deaktiviert; API antwortet 409 (siehe Contract).
2. Server während eines laufenden Turns stoppen und neu starten → betroffene Nachricht erscheint als „unterbrochen" (`interrupted`), Verlauf intakt.
3. Kostenkontrolle (R7): Executions-View zeigt pro abgeschlossenem Turn einen Eintrag `kind: chat` mit Kosten/Tokens.
