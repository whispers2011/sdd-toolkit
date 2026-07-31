# Phase 0 — Research & Leitentscheidungen: „Braucht dich" verschwindet nach Review nicht

Grundlage sind die beiden in der Spec benannten, voneinander unabhängigen Ursachen. Beide sind im
Quelltext bestätigt:

**Ursache A — stumme Sammel-Auflösung.** `AttentionRepo.resolveFor()`
(`packages/server/src/db/repos.ts`) ist ein reines `UPDATE` mit Rückgabetyp `void`. Die Aufrufer im
Review-Pfad — `MergeQueueService.approveForMerge()`, `MergeQueueService.retry()`,
`MergeQueueService.finalizeMerged()` und `POST /api/features/:id/reject-review` — senden **kein**
`attention_resolved`. Die Meldung ist danach in der Datenbank aufgelöst und in der Anzeige noch da.
Verschärfend: `MergeQueueService.setStage()` iteriert über `attention.listOpen()` und würde pro Item
ein Ereignis senden — nur ist das Item durch das vorangegangene `resolveFor()` bereits nicht mehr
offen, die Schleife läuft also leer. Genau deshalb ist auch die zustandsgekoppelte Bereinigung im
Review-Pfad wirkungslos.

**Ursache B — falscher Ereignis-Inhalt.** `Orchestrator.resolveGateAttention()` sendet
`attention_resolved` mit einer **featureId**; `Orchestrator.handleStatusChange()`,
`Orchestrator.handleExit()`, `ChatWorkService.handleStatusChange()` und `ChatWorkService.handleExit()`
senden eine **session.id**. Der Reducer in `packages/web/src/store.tsx` filtert
`a.id !== action.id && a.sessionId !== action.id`: eine sessionId trifft dadurch *zufällig* zu, eine
featureId trifft auf keines der beiden Felder und entfernt nichts.

Die Kombination erklärt die beobachtete Sporadik: `GET /api/state` liefert `attention.listOpen()`
mit, ein Reload räumt also immer korrekt auf.

---

## D1 — `resolveFor()` liefert die betroffenen IDs über `UPDATE … RETURNING id`

**Entscheidung**: `resolveFor(filter): string[]`. Statement wird um `RETURNING id` erweitert und mit
`.all()` ausgeführt; das Ergebnis wird auf `string[]` abgebildet.

**Begründung**: Ein Statement, keine Lücke zwischen Auswahl und Änderung. `RETURNING` liefert exakt
die Zeilen, die *dieser* Aufruf verändert hat — damit ist FR-002 („die tatsächlich betroffenen
Meldungen") und FR-006 (leere Liste → kein Ereignis) direkt aus der Datenbank belegt statt
rekonstruiert. Empirisch verifiziert gegen die im Repo installierte Fassung: better-sqlite3 12 mit
SQLite 3.53.2, `UPDATE … RETURNING id` per `.all()` liefert die betroffenen IDs und `[]`, wenn keine
Zeile passt.

**Alternativen**:

- *`SELECT id` vorher, dann `UPDATE`*: zwei Statements. In besser-sqlite3 läuft alles synchron im
  selben Thread, das Zeitfenster ist also praktisch null — aber es ist ein Zeitfenster, das man
  mitdenken muss, und der WHERE-Ausdruck stünde zweimal da. Verworfen.
- *`UPDATE`, dann `SELECT … WHERE resolved_at = <ts>`*: identifiziert Zeilen über den Zeitstempel und
  vermischt damit mehrere Aufrufe innerhalb derselben Millisekunde. Verworfen.

## D2 — `resolve()` liefert `boolean` über `.changes`

**Entscheidung**: `resolve(id): boolean` — `true`, wenn das Item durch diesen Aufruf aufgelöst wurde.
Das `WHERE … AND resolved_at IS NULL` bleibt; ausgewertet wird `run().changes > 0`.

**Begründung**: Deckt den Edge Case „Meldung war schon erledigt" ohne Zusatzabfrage. `.changes` ist im
Repo bereits etabliert (`repos.ts` verwendet es an zwei Stellen). Erst mit dieser Rückgabe können die
Einzelpfade dieselbe Regel befolgen wie die Sammelpfade: kein Ereignis ohne tatsächliche Änderung.

## D3 — Der Emit-Helfer lebt in `events.ts`, nicht im Repo

**Entscheidung**: `packages/server/src/events.ts` bekommt

```ts
export function emitAttentionResolved(ids: readonly string[]): void
```

und sendet pro ID genau ein `attention_resolved`. Alle 13 Auflösewege rufen diesen Helfer.

**Begründung**: `events.ts` deklariert den Ereignisvertrag (`BusEvents.attention_resolved`) — die
Regel „ausschliesslich Item-IDs" (FR-003) steht damit unmittelbar neben dem Typ, den sie einschränkt,
und ist beim Lesen nicht zu übersehen. Jeder Aufrufer importiert `bus` bereits aus dieser Datei, es
entsteht keine neue Datei und keine neue Importzeile. Das DB-Layer (`repos.ts`) bleibt frei vom
Event-Bus — die Trennung „Repo ändert Zustand, Service/API veröffentlicht" bleibt erhalten.

**Alternativen**:

- *Eigene Datei `services/attentionEvents.ts`*: eine Datei für vier Zeilen, entfernt von dem Typ, den
  sie durchsetzt. Verworfen.
- *`AttentionRepo` sendet selbst*: würde `repos.ts` an den Bus koppeln und alle bestehenden
  Repo-Tests an eine Ereignis-Infrastruktur binden. Verworfen.
- *Ein `AttentionService`, der Repo + Bus kapselt*: die saubere Fernlösung, aber ein Umbau aller
  Aufrufer inklusive `deps`-Verdrahtung in vier Dateien — deutlich mehr Fläche als der Fehler
  verlangt. Verworfen (YAGNI); der Helfer ist der kleinste Schnitt, der FR-001 bis FR-003 an *einer*
  Stelle festmacht.

## D4 — Die Anzeige-Regel wird als pures Modul nach `shared` gezogen, statt Web-Tests aufzubauen

**Entscheidung**: Neues Modul `packages/shared/src/attentionList.ts` mit

```ts
export function applyAttentionResolved(items: readonly AttentionItem[], resolvedId: string): AttentionItem[]
```

Der Reducer-Zweig `attention_resolved` in `packages/web/src/store.tsx` ruft nur noch diese Funktion.
Getestet wird in `packages/shared/src/attentionList.test.ts`.

**Begründung**: Die Spec überlässt diese Wahl ausdrücklich der Planung („Ob dort eine
Testinfrastruktur geschaffen wird oder die zu prüfende Logik an eine bereits getestete Stelle
wandert"). `packages/web` hat konventionsgemäß keine Tests
(`"test": "echo 'keine Web-Tests (MVP)'"`), `packages/shared` dagegen 33 pure Module mit vitest-Suite
— das Muster ist im Repo dominant. Eine Testinfrastruktur für Web (vitest + jsdom +
Testing-Library + Config + Skript) einzuführen, um eine einzige `filter`-Zeile zu prüfen, wäre
unverhältnismäßig; die Auswahlregel selbst ist außerdem reine Logik ohne React-Bezug. Die
Reducer-Tests aus FR-010 werden damit zu Tests dieses Moduls.

**Alternativen**:

- *vitest in `packages/web` einführen*: neue Dev-Dependencies, neue Config, bricht mit der
  Paketkonvention — für eine Zeile Logik. Verworfen.
- *Nur serverseitig testen und die Anzeige manuell abnehmen*: verletzt FR-010, das ausdrücklich zwei
  automatisierte Tests für die Zuordnungsregel fordert. Verworfen.
- *Zusätzlich `applyAttentionRaised` (Dedup beim Anlegen) mitverschieben*: FR-009 verlangt, dass das
  Erzeugen und Entdoppeln unverändert bleibt; Anfassen wäre unnötiges Risiko. Verworfen — das Modul
  bleibt bei der einen Funktion.

## D5 — Ein Ereignis pro Meldung, kein Sammel-Ereignis mit ID-Liste

**Entscheidung**: `attention_resolved` behält die Signatur `(id: string) => void`. Eine
Sammel-Auflösung von *n* Meldungen sendet *n* Ereignisse.

**Begründung**: FR-002 fordert wörtlich „für **jede** von ihnen genau eine Auflösungs-Meldung". Der
Payload-Typ bleibt unverändert, damit ändert sich am Draht nichts (`string` bleibt `string`) — kein
neues Ereignis, keine Umstellung des Reducers auf Listen, keine Version am Kanal. Mehrere Ereignisse
gleichzeitig sind hier praktisch bedeutungslos: die realen Sammel-Auflösungen betreffen ein bis vier
Meldungen (die `kinds`-Filter sind eng), und der Reducer ist idempotent.

**Alternative**: `attention_resolved: (ids: string[])`. Würde einen Bruch am WS-Vertrag bedeuten
(alte Clients brechen), die Reducer-Signatur und alle 13 Aufrufer ändern — ohne dass ein Problem
gelöst wird, das heute besteht. Verworfen.

## D6 — Die Zuordnung über `sessionId` fällt ersatzlos weg

**Entscheidung**: Der Reducer vergleicht ausschließlich `a.id !== resolvedId`. Der
`a.sessionId !== action.id`-Zweig und der begleitende Kommentar entfallen.

**Begründung**: FR-004. Wichtiger noch: Solange der Zweig existiert, bleibt eine gefährliche
Zweideutigkeit — eine Auflösung, die versehentlich eine sessionId sendet, entfernt *alle* Meldungen
dieser Session, auch frisch entstandene. Genau davor schützt der Wegfall. Das ist zugleich der Grund,
warum FR-005 bindend vollständig ist: die vier session-basierten Pfade (Orchestrator + Chat)
funktionieren heute *nur* über diesen Zweig. Wer ihn entfernt, ohne sie umzustellen, macht sie kaputt
— darum sind Reducer-Änderung und Pfad-Umstellung ein Schritt, nicht zwei.

## D7 — Bereits aufgelöste Meldungen senden kein Ereignis — auch im manuellen Pfad

**Entscheidung**: `POST /api/attention/:id/resolve` sendet nur, wenn `resolve()` `true` liefert.

**Begründung**: Edge Case „Meldung war schon erledigt: es wird keine erneute Auflösungs-Meldung
ausgegeben". FR-007 (manuelles Wegklicken bleibt unverändert) ist davon nicht betroffen: die Inbox
entfernt den Eintrag nach dem POST **lokal** (`AttentionInbox.tsx`:
`api.resolveAttention(item.id).then(() => dispatch({ type: 'attention_resolved', id: item.id }))`).
Der klickende Client hängt also nicht am Ereignis.

**Bewusst in Kauf genommen**: Ist eine Meldung serverseitig schon aufgelöst, hängt sie aber in einer
*zweiten*, ereignismäßig zurückgefallenen Oberfläche noch in der Liste, dann räumt ein Klick in der
ersten Oberfläche die zweite nicht mehr mit auf (heute täte er es). Der Fall setzt ein bereits
verlorenes Ereignis voraus und wird vom Sicherheitsnetz beim Laden (FR-008) gedeckt. Die
ausdrückliche Regel der Spec wiegt schwerer als dieser Nebeneffekt.

## D8 — Reihenfolge und Zuständigkeit an jedem Aufrufer

**Entscheidung**: An jeder Stelle gilt: erst auflösen, dann mit den zurückgegebenen IDs senden —
`emitAttentionResolved(this.deps.attention.resolveFor({ … }))`. Bestehende Nachbarlogik bleibt, wo
sie ist; insbesondere bleibt die zustandsgekoppelte Schleife in `MergeQueueService.setStage()`
erhalten (sie deckt Stage-Wechsel ab, die von keinem Button kommen), ebenso
`Orchestrator.reconcileOpenAttention()` und `reapOnBoot()`.

**Begründung**: Kein Aufrufer muss mehr wissen, *welche* Meldungen es gab — er sendet, was die
Datenbank zurückmeldet. Damit ist SC-006 („kein Auflöseweg markiert Meldungen als erledigt, ohne dies
mitzuteilen") strukturell erfüllt statt durch Disziplin. Die drei Wege, die heute schon korrekt pro
Item senden (`setStage()`, `reconcileOpenAttention()`, `reapOnBoot()`), werden nur auf den Helfer und
die `boolean`-Rückgabe umgestellt — Verhalten unverändert.

## D9 — Ereignis-Tests hängen sich an den echten Modul-Bus

**Entscheidung**: Die Ereignis-Tests in `packages/server` abonnieren den echten Singleton
(`bus.onEvent('attention_resolved', …)`) und melden sich in `afterEach` per `bus.off(…)` ab.

**Begründung**: `bus` ist ein Modul-Singleton, das Orchestrator, MergeQueueService, ChatWorkService
und die API direkt importieren — er wird nicht injiziert. Ein Abonnement ist damit der einzige
zuverlässige Weg, das tatsächlich gesendete Nutzdatum zu prüfen, und er prüft genau das, was der
Client bekommt. Die bestehenden Service-Tests (`mergeQueueService.attention.test.ts`,
`orchestrator.attention.test.ts`) laufen bereits gegen denselben Bus (ohne Abonnent), das Muster ist
also verträglich. Abmelden ist Pflicht: `bus.setMaxListeners(100)`, und vitest lädt das Modul pro
Testdatei nur einmal.

**Alternative**: `bus` in die Services injizieren (wie `worktreeOverviewService` es tut). Saubere
Fernlösung, aber ein Signatur- und Verdrahtungsumbau in vier Services — außerhalb des Auftrags.
Verworfen.

## D10 — Rot vor Grün: was heute wirklich fehlschlägt

FR-010 fordert, dass beide Tests „gegen den heutigen Stand fehlschlagen". Präzise:

| Test | Fehlschlag gegen heute | Art des Fehlschlags |
|---|---|---|
| FR-010 (a) — Item-ID entfernt genau diese Meldung | ja | `applyAttentionResolved` existiert nicht → Modul-/Compile-Fehler. Das Verhalten selbst ist heute (über den `a.id`-Zweig) korrekt; der Test ist Regressionsschutz für den Zustand *nach* Wegfall des sessionId-Zweigs. |
| FR-010 (b) — fremde Kennung entfernt nichts | ja | zusätzlich **inhaltlich**: würde man die heutige Reducer-Logik 1:1 in die Funktion kopieren, entfernte eine sessionId weiterhin Meldungen. Das ist der echte rote Test für Ursache B. |
| FR-011 — pro betroffener Meldung genau ein Ereignis | ja, inhaltlich | `resolveFor()` gibt `void` zurück und die Review-Pfade senden nichts → 0 statt *n* Ereignisse. Das ist der echte rote Test für Ursache A. |

**Konsequenz für die Umsetzung**: Test (a) ist ehrlicherweise ein Struktur-, kein Verhaltens-Rot.
Damit die Ursachen-Abdeckung nicht daran hängt, wird das inhaltliche Rot doppelt verankert — bei (b)
für die Anzeige und bei FR-011 für den Server. Beide Tests sind vor der Umsetzung des jeweiligen
Codes zu schreiben und einmal fehlschlagend zu beobachten (Nachweis in
[quickstart.md](./quickstart.md), Stufe 2).

## D11 — Die Sicherheitsnetze bleiben unangetastet

**Entscheidung**: `GET /api/state` liefert weiterhin `attention.listOpen()` mit, `GET /api/attention`
ruft weiterhin vorher `reconcileOpenAttention()`. Keine Zeile davon wird geändert.

**Begründung**: FR-008 und die Assumption der Spec. Die Netze decken den Fall „Oberfläche war nicht
verbunden" ab, der durch dieses Feature nicht verschwindet — Ereignisse bleiben Best-Effort. Neu ist
nur, dass sie nicht mehr der reguläre Weg sind, auf dem Meldungen verschwinden.

## Offene Punkte

Keine. Es bleiben keine `NEEDS CLARIFICATION` aus dem Technical Context.

**Notiert, aber ausdrücklich nicht Teil dieses Features**: `resolveFor({})` ohne Selektor löst
sämtliche offenen Meldungen auf — heute wie nachher. Kein Aufrufer tut das; nachher würde ein solcher
Versehensaufruf immerhin sichtbar *n* Ereignisse senden statt still zu wirken. Eine Absicherung
(Selektor-Pflicht) wäre eine eigenständige Härtung und wird hier nicht eingeführt.
