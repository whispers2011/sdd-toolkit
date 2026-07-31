# Quickstart / Validierung: Review-Portal & Agent-Verwaltung

Nachweis, dass das Feature end-to-end funktioniert. Contracts: [http-api.md](./contracts/http-api.md),
[ws-events.md](./contracts/ws-events.md); Datenmodell: [data-model.md](./data-model.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10, `claude`-CLI im PATH (für Agent-Läufe)
- Dev-Server: `pnpm dev` (Server + Web)
- Ein Testprojekt im Toolkit mit defaultBranch `main` und konfigurierten verifyCommands

## Stufe 1: Automatisierte Checks

```bash
pnpm -r typecheck && pnpm -r test
```

Erwartung: grün. Insbesondere: `phaseMachine.test.ts` UNVERÄNDERT grün (Datei nicht
angefasst); neue Tests für diffParse, branchSuggest, reviewPrompt, agentSelect
(resolveAgentsForTrigger + Parser), agentGateService, mergeEngine (mergeIntoTarget),
mergeQueueService (approveForMerge), Repos. `grep -rn "PersonaRepo" packages/` → leer.

## Stufe 2: Migrations-Smoke

Gegen eine KOPIE der Dev-DB starten (dataDir kopieren, Server darauf zeigen lassen):

1. Boot ohne Fehler; Log zeigt Migration B + A gelaufen.
2. Agent-Verwaltung zeigt 5 globale Agents: `default-code-review`,
   `default-security-review` (beide review_gate, blockierend — Alt-Personas verlustfrei),
   `default-dor-gate` (vor implement), `default-plan-quality` (nach plan),
   `default-doku-policy` (Review-Gate, Hinweis/advisory).
3. Feature mit Alt-Reviews (vor Migration): Portal zeigt Berichte weiterhin
   (Markdown-Fallback, `source:'markdown'`).

## Stufe 3: Manuelle End-to-End-Flows

### (a) Plan-Quality-Gate (after_phase)

Feature bis Phase `plan` laufen lassen. Erwartung: nach Phasenabschluss startet
`default-plan-quality` automatisch (agent_gate-Event `running`); im Portal/der Verwaltung
erscheint der Lauf mit Urteil, Zusammenfassung, Kosten und öffenbarem Bericht.

### (b) Blockierender FAIL + Human-Override

Plan mit absichtlicher Lücke FAIL urteilen lassen. Erwartung: kein Auto-Progress; Inbox
zeigt `phase_gate_failed`; manuelles Approve der Phase funktioniert trotzdem
(Human-Override); Attention löst sich dabei auf.

### (c) DoR-Gate (before_phase, Deferral)

implement-Start bei aktivem DoR-Gate anstoßen. Erwartung: HTTP-Antwort sofort
`{gateRunning:true}`; Phase bleibt äußerlich idle mit gateRunning-Badge; nach PASS startet
implement von selbst; bei FAIL kein Start + Inbox-Eintrag.

### (d) Review-Gate sequenziell mit Advisory

Integration eines Features anstoßen (autoReviewAgents an). Erwartung: review_gate-Agents
laufen nacheinander in sort_order; Doku-Policy-FAIL stoppt NICHTS (advisory, wird nur
verbucht), blockierender FAIL stoppt das Gate → Stage `gate_failed`.

### (e) Portal-Kernflow

Feature in `awaiting_human_review` bringen, Review-Tab öffnen:

1. Übersicht listet es unter „Bereit zum Review" (Badge zählt mit); ein Feature mit
   `verify_failed` erscheint unter „Braucht Eingriff" mit ↻-Aktion.
2. Portal: Diff mit Zeilennummern; 2 Kommentare an Zeilen verankern; Portal schließen/öffnen
   → Kommentare persistent, Klick springt zum Anker.
3. Datei-Tab: Trivia-Edit (Tippfehler) speichern; parallele Fremdänderung provozieren →
   409-Konfliktmeldung, nichts überschrieben.
4. Zurückweisen mit Freitext → Feature-Konsole erhält strukturierten deutschen Prompt mit
   beiden Kommentaren (Datei/Zeile) + Freitext; integration_target zurückgesetzt.
5. Erneut prüfbereit machen; Freigabe in NEUEN Branch: Vorschlag `integration/<slug>`
   editierbar, Live-Validierung (ungültiger Name/Kollision abgelehnt). Nach Merge:
   `git branch --contains` zeigt Feature-Commits im Ziel-Branch, `main` unberührt,
   Haupt-Checkout nie umgeschaltet, Done-Badge zeigt „→ <ziel>". Wegen des Trivia-Edits
   lief vor dem Merge eine Re-Verifikation (executions zeigen den Verify-Lauf, Commit
   `review(<name>): reviewer-korrekturen` existiert).

### (f) Test-/Audit-Anzeige

Im Portal: Tests-Tab zeigt Verify-Läufe (Status/Dauer/Logs/Token/Kosten); AuditSidebar
gruppiert Läufe nach Trigger mit Verdict-Pills und SVG-Ring (bestanden/gesamt).

### (g) Per-Feature-Override + manueller Lauf

FeatureAgentSelect: global aktiven Agent auf „Aus" → läuft beim nächsten Trigger nicht;
deaktivierten Agent auf „Ein" → läuft. „Jetzt ausführen" auf Feature mit Worktree → 202,
Ergebnis erscheint; ohne Worktree → 409 mit verständlicher Meldung.

### (h) PR-Modus

Projekt auf integrationMode 'pr'; Freigabe in neuen Ziel-Branch. Erwartung: erst
`git push -u origin <target>`, dann PR mit `--base <target>`.

### (i) Freigabebedarf (approval_required)

Plan-Quality mit „FREIGEGEBEN MIT ÄNDERUNGEN" bzw. `FREIGABE ERFORDERLICH:`-Zeilen.
Erwartung: PASS + eigener Inbox-Eintrag mit Thema; „Bericht öffnen" und „Erledigt"
funktionieren.

## Erfolgskriterien-Abgleich

SC-001↔(e1), SC-002↔(e2/e5), SC-003↔(e4), SC-004↔(e3/e5), SC-005↔Stufe 2,
SC-006↔(a/b/c), SC-007↔(f), SC-008↔(e5).
