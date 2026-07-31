# Vertrag: HTTP-API

Alle Endpunkte antworten JSON. Bestehende Konventionen gelten unverändert:

- Aktionsauslösende Routen prüfen **vor jeder Wirkung** `actionPolicy.evaluateAction()` über den
  `ActionGuard` und antworten bei Ablehnung **409** mit `{ message }` — wortgleich zu dem, was die
  Oberfläche anzeigt.
- Unbekanntes Feature/Projekt ⇒ **404**. Ungültige Eingabe ⇒ **400**.
- Zustandsänderungen senden die bestehenden WS-Ereignisse (`feature_updated`, `attention_raised`,
  `attention_resolved`, `execution_updated`) — **kein neues Event-Schema**.

Neue Datei `api/testingLaneRoutes.ts` für die Lane; die Stack- und Abnahme-Routen eines Features
liegen bei den übrigen `/api/features/:id/*`-Routen in `server.ts`.

---

## GET /api/testing-lane

Einträge der Testing-Lane eines Projekts (FR-030).

**Query**: `projectId` (Pflicht), `refresh=1` (Statusprobe erzwingen, Cache überspringen)

**200**

```json
{
  "awaitingManualTest": [
    {
      "featureId": "f_ab12",
      "featureName": "mein-feature",
      "branch": "feature/mein-feature",
      "worktreePath": "/Users/…/worktrees/projekt-x/mein-feature",
      "createdAt": 1753900000000,
      "stage": "awaiting_manual_test",
      "stack": {
        "configured": true,
        "profile": "full",
        "portBase": 21040,
        "url": "http://localhost:21040",
        "services": [
          { "name": "web", "port": 21040, "scope": "feature", "stateful": false, "primary": true,  "status": "up" },
          { "name": "api", "port": 21041, "scope": "feature", "stateful": false, "primary": false, "status": "up" },
          { "name": "db",  "port": 21042, "scope": "feature", "stateful": true,  "primary": false, "status": "up" },
          { "name": "mail","port": 21060, "scope": "shared",  "stateful": false, "primary": false, "status": "down" }
        ],
        "collectedAt": 1753901234567
      },
      "lastDecision": null
    }
  ],
  "running": [],
  "collectedAt": 1753901234567
}
```

- `awaitingManualTest` — Features des Projekts auf der Stufe `awaiting_manual_test` (die eigentliche
  Warteschlange der Abnahme).
- `running` — Features desselben Projekts mit betriebenem Stack, die **nicht** auf der Stufe stehen
  (damit sichtbar bleibt, was Ports und Dienste belegt).
- `stack.url` ist `null`, wenn kein Haupteingang konfiguriert ist **oder** er nicht antwortet — die
  Oberfläche zeigt dann „nicht erreichbar" statt eines Links (FR-033).
- `stack.configured: false` ⇒ `services: []`, `url: null` — die Oberfläche nennt die fehlende
  Konfiguration (FR-013/FR-033).

---

## GET /api/features/:id/stack

Erhobener Stack-Zustand **eines** Features (FR-023). Gleiche Struktur wie `stack` oben.

**Query**: `refresh=1` (Cache überspringen)

**200** → `FeatureStackView`

Kein 409: Lesen ist immer erlaubt. Ohne Portblock oder ohne Konfiguration antwortet die Route
`{ configured: false, profile: null, portBase: null, url: null, services: [], collectedAt }`.

---

## POST /api/features/:id/stack/:action

Die vier Lane-Aktionen (FR-032). `action ∈ up | stop | restart | down`.

**Body** (optional): `{ "profile": "test" | "full" }` — nur bei `up`; Vorgabe `full` (die Lane
fährt den vollen Stack; `test` wird intern beim Beginn von `implement` verwendet).

**Wirkung**

| `action` | ausgeführt | Absicht danach |
|---|---|---|
| `up` | `full.command` (+ `sharedCommand`, wenn geteilte Dienste nicht erreichbar) | `full` |
| `stop` | `stopCommand` | unverändert |
| `restart` | `stop`, dann `up` | `full` |
| `down` | `down.command` (+ `sharedCommand` nur, wenn kein weiteres Feature eine Absicht hat) | keine |

**200** → `FeatureStackView` (frisch erhoben nach der Aktion)

**409** — Grund aus `actionPolicy`, u. a.:

| Grund | Bedingung |
|---|---|
| „Kein Stack konfiguriert — Profile in den Projekt-Einstellungen hinterlegen." | `stack.configured === false` |
| „Für dieses Profil ist kein Kommando hinterlegt." | Profil `null` |
| „Kein Kommando zum Anhalten hinterlegt — nur Abbauen ist möglich." | `action = stop` ohne `stopCommand` |
| „Kein Arbeitsverzeichnis vorhanden." | `worktreePath === null` |
| „Es wird gerade gearbeitet — die Session läuft." | `busyReason` greift |

**500** mit `{ message, exitCode, tail }`, wenn das Kommando fehlschlägt — zusätzlich entsteht eine
`stack_failed`-Meldung in der Inbox (FR-019). Die Antwort trägt denselben Ausschnitt, damit der
Bedienende ihn ohne Umweg über die Inbox sieht.

Jede Aktion wirkt **ausschließlich** auf den Stack dieses Features (bzw. auf geteilte Dienste nach
der Regel oben) — Nachbar-Features bleiben unberührt (US3 Szenario 5).

---

## POST /api/features/:id/manual-test/confirm

Manuelle Abnahme bestätigen (FR-028). Erfordert `integration === 'awaiting_manual_test'`.

**200** → aktualisiertes `Feature`

Wirkung: Entscheidung `confirmed` festhalten → `after_stage manual_test`-Schritte (F1b) →
`manual_test_due`-Meldung auflösen → weiter wie bisher:
`autoMerge ? queued : awaiting_human_review` (+ `review_due`-Meldung).

**409** „Das Feature wartet nicht auf eine manuelle Abnahme." bei jeder anderen Stufe. Es gibt
**keinen** automatischen Weg aus der Stufe heraus.

---

## POST /api/features/:id/manual-test/reject

Manuelle Abnahme ablehnen (FR-029).

**Body**: `{ "reason": "…" }` — **Pflicht**, nicht leer (400 sonst: „Ein Grund ist erforderlich.")

**200** → aktualisiertes `Feature`

Wirkung: Entscheidung `rejected` mit Grund festhalten → `integration = 'none'` →
Integrations-Zielwahl zurücksetzen → letzten aktiven Schritt wieder auf „wartet auf Freigabe"
(`reopenLastPhase`, bestehender Pfad) → Zurückweisung am Feature vermerken → Grund als Prompt in
die Feature-Konsole → `manual_test_due`-Meldung auflösen. Es folgt **kein** automatischer
Integrationsstart.

**409** wie bei `confirm`.

---

## POST /api/features/:id/cleanup

Fehlgeschlagenes Aufräumen erneut anstoßen (FR-037).

**200**

```json
{ "cleaned": true, "worktreePath": null, "cleanupError": null }
```

Wirkung: `down`-Profil → Session über die Prozessgruppe beenden → `worktrees.remove()` →
**Nachweis** über `existsSync` → nur dann `worktree_path = NULL` und `cleanup_error = NULL` und
Auflösung der `worktree_cleanup_failed`-Meldung.

**200 mit `cleaned: false`** und `cleanupError`, wenn es erneut scheitert — die Meldung bleibt
stehen, der Pfad bleibt gesetzt (FR-035/FR-036). Bewusst kein 500: der Aufruf hat korrekt
funktioniert, das Ergebnis ist „geht nicht".

---

## PUT /api/projects/:id (bestehende Route, erweitert)

Das `Project`-Objekt trägt neu `stack: StackConfig` (FR-011). Validierung serverseitig nach
[data-model.md §3](../data-model.md); Verstöße ⇒ **400** mit demselben Satz, den die Oberfläche
anzeigt:

```json
{ "message": "Ein zustandsbehafteter Dienst muss feature-eigen laufen." }
```

Eine leere Konfiguration (`{}`) ist gültig und bedeutet „kein Stack" — sie blockiert nichts
(FR-013).

---

## GET /api/worktrees (bestehende Route, erweitert)

Je Eintrag neu `sizeBytes: number | null` (FR-042/FR-044) und `portBase: number | null`; auf der
Wurzel neu:

```json
{
  "groups": [ … ],
  "collectedAt": 1753901234567,
  "disk": { "freeBytes": 852000000, "warnBelowBytes": 10737418240, "warn": true }
}
```

`sizeBytes: null` = „unbekannt"; der Eintrag bleibt mit allen übrigen Angaben sichtbar (FR-044).
Die größten Worktrees leitet die Oberfläche aus derselben Antwort ab — kein zweiter Abruf.

---

## PUT /api/settings/automation (bestehende Route, erweitert)

`AutomationSettings` trägt neu `manualTestGate: boolean` (FR-025). Auflösung wie bei allen
Schaltern über global → Projekt → Feature; die Projekt- und Feature-Overrides laufen über die
bestehenden Routen (`PUT /api/projects/:id`, `PUT /api/features/:id/automation`) ohne Änderung an
deren Vertrag.

---

## Unveränderte Endpunkte, die das Feature mitbedienen

| Endpunkt | Rolle |
|---|---|
| `POST /api/features/:id/integrate` | erreicht die neue Stufe, wenn das Gate an ist |
| `POST /api/features/:id/retry-integration` | Wiederaufnahme nach `stack_failed` in der Verifikationsstrecke |
| `GET /api/executions` · `GET /api/executions/:id/log` | Profilläufe erscheinen als Art `lifecycle_step` mit `label: "Stack: …"`; das Log liegt unter derselben Ableitung |
| `GET /api/attention` · `POST /api/attention/:id/resolve` | die vier neuen Meldungsarten nutzen die bestehende Inbox |
| `POST /api/worktrees/remove` | fährt vorher `down` und lehnt bei Fehlschlag mit Grund ab |
| `GET /api/state` | trägt `automation.manualTestGate` und `project.stack` mit |
