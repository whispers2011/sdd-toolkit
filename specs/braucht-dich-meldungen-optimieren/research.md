# Research: „Braucht dich"-Meldungen optimieren

**Feature**: `braucht-dich-meldungen-optimieren` | **Date**: 2026-07-23

Ziel der Recherche: Den Weg finden, mit dem „Braucht dich" (Attention-/Exception-Inbox) nur noch Meldungen zeigt, deren zugrunde liegender Zustand aktuell aktiv ist — restart-sicher und ohne Nutzerinteraktion. Grundlage ist der bestehende Code (kein Neubau der Inbox).

## Ausgangslage (Ist-Zustand)

Meldungen sind persistierte `AttentionItem`s (SQLite-Tabelle `attention`, `AttentionRepo` in `packages/server/src/db/repos.ts:515`). Sie werden über `raise()` angelegt und über `resolve(id)` / `resolveFor(filter)` aufgelöst (`resolved_at` gesetzt). Der Client hält `state.app.attention` und synchronisiert über die WS-Events `attention_raised` / `attention_resolved` (`packages/web/src/store.tsx:99-116, 294-298`).

Fünf identifizierte Ursachen für „Geister-Meldungen":

1. **Kein Boot-Reconcile.** `orchestrator.reapOnBoot()` (`orchestrator.ts:514`) beendet offene Sessions und bereinigt Phasen, rührt die Attention-Items aber nie an → nach Neustart bleiben `awaiting_input`/`agent_errored` als Waisen offen.
2. **`agent_errored` löst sich nie automatisch.** Der Working-Übergangs-Resolver listet nur `['awaiting_input','permission_request']` (`orchestrator.ts:356`, `chatWorkService.ts:220`).
3. **Navigation löst nichts auf.** „Zur Konsole →"/„Zum Chat →" wechseln nur die Ansicht (`AttentionInbox.tsx:56-73`); ein `awaiting_input`-Eintrag bleibt, bis die Session-Statustransition auf `working` beobachtet wird — verpasst man dieses Ereignis, bleibt der Eintrag.
4. **Merge-Meldungen sind aktionsgekoppelt, nicht zustandsgekoppelt.** `review_due`/`verify_failed`/`gate_failed`/`merge_conflict_escalated` verschwinden nur über bestimmte Buttons (`approveForMerge`/`retry`/reject/mark-done), nicht wenn sich der Feature-Zustand anders ändert.
5. **Badge-/Listen-Mismatch.** Der Badge zählt Attention über **alle** Projekte (`App.tsx:27-28`, nur `permission_request` ausgefiltert), die Liste filtert auf das ausgewählte Projekt (`AttentionInbox.tsx:22-24`).

## Entscheidungen

### D1 — Zustandsgekoppeltes Gültigkeitsmodell (statt aktionsgekoppelt)

**Decision**: Jede Meldungsart erhält ein autoritatives Prädikat über den *aktuellen* Zustand. Eine Meldung ist gültig, solange ihr Prädikat wahr ist; sonst ist sie stale und wird aufgelöst.

Wahrheitsquellen:
- **`Feature.integration` (`IntegrationStage`, persistiert)** für die vier Merge-Fluss-Arten — restart-sicher, weil Features persistiert sind.
- **Live-Session-Zustand** (ephemer, beim Boot beendet) für `awaiting_input` und `agent_errored`.

| Art | Gültig solange | Stale wenn |
|-----|----------------|------------|
| `awaiting_input` | eine Live-Session (per `sessionId`/`conversationId`) im Zustand `awaiting_input` existiert | Session arbeitet wieder / beendet / nicht mehr vorhanden (auch nach Boot) |
| `agent_errored` | Feature/Session hat seit dem Fehler nicht wieder gearbeitet und ist nicht neu gestartet | eine Session desselben Features arbeitet wieder **oder** Boot (Session weg) |
| `review_due` | `feature.integration === 'awaiting_human_review'` | Stage wechselt (queued/merging/merged/…) |
| `verify_failed` | `feature.integration === 'verify_failed'` | Stage wechselt |
| `gate_failed` | `feature.integration === 'gate_failed'` | Stage wechselt |
| `merge_conflict_escalated` | `feature.integration === 'conflict_escalated'` | Stage wechselt (conflict_resolving/merged/…) |

**Rationale**: Deckt alle fünf Ursachen ab, ohne die Inbox neu zu bauen. Merge-Arten werden dadurch immer korrekt, auch über Neustarts, weil sie an persistiertem Feature-Zustand hängen.

**Alternatives considered**: „Derive-on-read" (Inbox komplett aus dem Zustand berechnen, nichts persistieren) — verworfen: grösserer Umbau, bricht Dedup/Persistenz/Event-Modell und das bestehende `attention_raised/resolved`-Kontrakt.

### D2 — Zentraler Reconciler an drei Aufrufpunkten

**Decision**: Eine Reconcile-Funktion nimmt die offenen Items + einen Zustands-Snapshot (Live-Sessions + Features) und bestimmt die stale Items. Stale Items werden via `resolveFor`/`resolve` aufgelöst (`resolved_at` gesetzt) und lösen `attention_resolved`-Events aus. Aufrufpunkte:
1. **Boot**: aus `reapOnBoot()` heraus (nach dem Beenden der Sessions).
2. **Zustandsänderungs-Ereignisse**: Working-Übergang (Kind-Liste erweitern) und `setStage()` im Merge-Fluss.
3. **Lesen/Bootstrap**: `GET /api/attention` und der Bootstrap-`getState` (`server.ts:84, 511`) liefern nur gültige Items und reconcilen dabei stale Items weg.

**Rationale**: Ereignisse liefern die Echtzeit-Aktualisierung (SC-002); das Read-Filtering ist das Sicherheitsnetz für verpasste Ereignisse; der Boot-Reconcile deckt Neustarts ab (SC-003).

**Alternatives considered**: Periodischer Polling-Sweep — verworfen: unnötige Latenz/Last, da Ereignisse + Read-Filter bereits abdecken.

### D3 — Session-basierte Arten nach Neustart: konservativ entfernen

**Decision**: Da Live-Sessions beim Boot beendet werden und ihr Laufzeit-Status ephemer ist, können `awaiting_input`/`agent_errored` nach einem Neustart nicht als aktiv bestätigt werden → sie werden beim Boot-Reconcile aufgelöst. (Entspricht der Klärung „konservativ entfernen".)

**Rationale**: Verhindert dauerhafte Geister über Neustarts. Der reale, weiterbestehende Zustand (z. B. eine fehlgeschlagene Phase) bleibt im Feature/Konsole sichtbar; es wird keine gesonderte Fehler-Historie eingeführt (Klärung Q2).

### D4 — Badge-Scope an die Liste angleichen

**Decision**: Der Badge/Titel-Zähler filtert wie die Liste auf `selectedProjectId` (zusätzlich zum bestehenden `permission_request`-Ausschluss). `App.tsx:27-28`.

**Rationale**: Behebt den wahrgenommenen „hängengebliebenen" Zustand (Badge „(3)" bei leerer Liste). Erfüllt SC-004/FR-011.

### D5 — `agent_errored` verschwindet still, keine Historie

**Decision**: `agent_errored` wird beim Working-Übergang eines Feature-Sessions und beim Boot aufgelöst; es wird keine neue Historien-Ansicht eingeführt (Klärung Q2).

### D6 — Bestehenden Event-/Reducer-Mechanismus wiederverwenden

**Decision**: Der Client-Reducer entfernt Items bereits per `id` **oder** `sessionId` (`store.tsx:113`). Serverseitig `attention_resolved` mit `id` bzw. `sessionId` emittieren; keine Client-Änderung am Reducer nötig (nur der Badge-Filter in D4).

## Technische Rahmenbedingungen (bestätigt)

- **Sprache/Runtime**: TypeScript, Node ≥ 22, ESM. Monorepo (pnpm): `packages/server`, `packages/web`, `packages/shared`.
- **Server**: Fastify-artige API + WS-Bus (`events.ts`), `better-sqlite3`, `node-pty`.
- **Web**: React 18 + Tailwind + Vite.
- **Storage**: SQLite — Tabellen `attention`, `sessions`, `features`.
- **Tests**: `vitest` in `server` und `shared` (`vitest run`); Web hat keine Tests (MVP) → Verifikation der UI-Aspekte über bestehende Muster/manuellen Quickstart.
- **Scale**: Einzelnutzer, wenige Projekte/Features/Sessions; `attention` klein → Reconcile ist O(offene Items), unkritisch.

## Offene Punkte

Keine `NEEDS CLARIFICATION` offen — die drei entscheidungsrelevanten Fragen wurden in `/speckit-clarify` (Session 2026-07-23) beantwortet.
