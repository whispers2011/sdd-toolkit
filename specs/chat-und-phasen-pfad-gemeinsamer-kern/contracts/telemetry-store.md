# Vertragsänderung: Ereignispuffer (`telemetry/telemetryStore.ts`)

Erfüllt **FR-007a**. Bestehendes Modul, geänderte Zusicherung — deshalb ein eigener Vertrag.

## Was sich ändert

```ts
// vorher
private held = new Set<string>();
hold(key)    { this.held.add(key); }
release(key) { this.held.delete(key); }

// nachher
private holds = new Map<string, number>();
hold(key)    { this.holds.set(key, (this.holds.get(key) ?? 0) + 1); }
release(key) { const n = (this.holds.get(key) ?? 0) - 1;
               if (n > 0) this.holds.set(key, n); else this.holds.delete(key); }
```

`forget(key)`, `ingest`, `eventsFor`, `stats`, `sweep`, `stop` und der Speicherdeckel
`maxEventsPerKey` bleiben unverändert. `sweep` fragt statt `held.has(key)` nun `holds.has(key)`.

## Zusicherungen

| # | Zusicherung |
|---|---|
| T1 | Der Puffer einer Marke bleibt vor dem Kehraus geschützt, **solange noch ein Lauf auf ihr offen ist** — auch wenn ein anderer sich zwischenzeitlich abgemeldet hat. |
| T2 | Anmelden und Abmelden gehören paarweise zu je einem Lauf; der Zähler wird nie negativ. |
| T3 | Das Abmelden des letzten Laufs **verwirft den Puffer nicht** — er unterliegt danach wieder dem Kehraus nach Alter (5 min). |
| T4 | `forget(key)` bleibt der harte Weg (Puffer weg, Zähler auf 0) und wird nur beim endgültigen Abräumen benutzt, nicht am Ende eines Nachlauffensters. |
| T5 | Verhalten bei genau einem `hold` + `release` ist unverändert — die bestehenden Tests bleiben ohne Anpassung grün. |

## Aufrufer, die angepasst werden

| Stelle | vorher | nachher |
|---|---|---|
| `orchestrator.ts:1003` (Ende des Nachlauffensters) | `telemetry?.forget(session.id)` | `telemetry?.release(session.id)` — im Kern, `RunMeter` |
| `chatWorkService.ts` | keine Anmeldung | `hold` beim Öffnen des Turn-Fensters, `release` am Ende des Nachlauffensters — im Kern |

## Der Fall, den das löst

Zwei Läufe auf derselben Marke, deren Nachlauffenster sich überlappen — bei Chats der Regelfall,
weil Turns Sekunden auseinanderliegen und das Fenster 5 Minuten offen bleibt:

```text
t0    Turn A:  hold      → holds{sess: 1}
t5    Turn A:  Abschluss, Nachtragsfenster läuft
t10   Turn B:  hold      → holds{sess: 2}
t305  Turn A:  release   → holds{sess: 1}     Puffer bleibt geschützt  ← vorher: forget → B verlor alles
t320  Turn B:  Abschluss
t620  Turn B:  release   → holds{}            Kehraus nach Alter übernimmt
```

Dasselbe gilt für zwei aufeinanderfolgende Phasenläufe desselben Features; dort fällt es heute
nur seltener auf, weil Phasen länger dauern als das Nachlauffenster.
