# Vertrag: Meldungsarten (API-Nutzlast + Inbox-Darstellung)

Betrifft `AttentionKind` in `packages/shared/src/types.ts` — den Typ, der über
`GET /api/attention`, `GET /api/app` und das WS-Ereignis `attention_raised` an das Web geht.
**Rein additiv**: keine bestehende Art wird umbenannt oder entfernt, kein Feld von `AttentionItem`
ändert sich, es entsteht **kein neuer Endpunkt**.

## Neue Arten

| `kind` | Bezeichnung (Inbox) | Icon | Farbe | Bezug | Befund |
|---|---|---|---|---|---|
| `run_unpriced` | Verbrauch ohne Preis | 💸 | `text-amber-400` | Projekt (`featureId: null`) | A |
| `phase_false_start` | Fehlstart | 🧨 | `text-amber-400` | Feature | B |
| `project_without_runs` | Projekt ohne Lauf | 🕸 | `text-zinc-400` | Projekt (`featureId: null`) | C |
| `metering_conflict` | Messung widersprüchlich | ⚖️ | `text-red-400` | Feature | D |

Bernsteinfarben statt rot für A/B/C: es ist nichts kaputt, es ist etwas **unklar**. Rot ist im
Bestand für „rot geworden" reserviert (`verify_failed`, `gate_failed`). Befund D ist rot, weil dort
nachweislich eine von zwei Zahlen falsch ist.

Emoji-Icons folgen dem Muster der Datei `AttentionInbox.tsx`. Die Projektkonvention „SVG statt
Emoji" gilt für neue Komponenten; diese Datei ist Bestand und wird hier nicht umgestellt.

## Bestehende API — unverändert nutzbar

| Weg | Verhalten mit den neuen Arten |
|---|---|
| `GET /api/attention` | listet sie mit (`listOpen()` filtert nicht nach Art) |
| `POST /api/attention/:id/resolve` | löst sie einzeln auf (FR-012) |
| WS `attention_raised` / `attention_resolved` | wird beim Melden bzw. Auflösen gesendet |
| Inbox-Filter | zeigt nur Meldungen des ausgewählten Projekts; `permission_request` bleibt ausgeschlossen |

## Darstellungszusagen (`AttentionInbox.tsx`)

1. **Vier unterscheidbare Arten** (FR-012): eigene Bezeichnung, eigenes Icon, jede Zeile mit
   ✓-Knopf zum einzelnen Auflösen. Erfüllt US4-Szenario 6.
2. **Projektbezogene Meldungen ohne Aktionsknopf**: bei `featureId: null` rendert die Inbox schon
   heute keinen `NextAction`-Knopf. Richtig für A und C — es gibt nichts zu starten, nur zu lesen.
   Der ✓-Knopf steht unabhängig davon immer.
3. **Featurebezogene Meldungen** (B, D) zeigen den vorhandenen „Zur Konsole →"-Knopf. Keine neue
   Aktion, kein neuer Ablauf.
4. `KIND_META` ist `Record<AttentionKind, …>` — die vier Einträge sind Pflicht, `pnpm typecheck`
   schlägt ohne sie fehl. Das ist die Absicherung dafür, dass eine neue Art nie ohne Bezeichnung
   in der Inbox landet.

## Gültigkeitsvertrag (`attentionReconciler.ts`)

```ts
case 'run_unpriced':
case 'phase_false_start':
case 'project_without_runs':
case 'metering_conflict':
  // Datenbefunde: der Widerspruch steht in der Datenbank und besteht unabhängig davon,
  // ob gerade ein Agent arbeitet (FR-016) oder ob das Toolkit neu gestartet wurde (FR-017).
  // Nur ein Mensch löst sie auf.
  return true;
```

| Ereignis | Wirkung auf diese Meldungen |
|---|---|
| Agent desselben Features arbeitet wieder | **keine** (FR-016) |
| `feature.integration` wechselt die Stufe | **keine** (kein Eintrag in `STAGE_FOR_KIND`) |
| Session endet / Neustart des Toolkits (`findStaleOnBoot`) | **keine** (FR-017) |
| `POST /api/attention/:id/resolve` | aufgelöst; Wiederkehr nur bei gewachsenem Bestand (FR-014) |
| `FeatureRepo.hardDelete()` | Meldung **und** Wasserstand des Features werden gelöscht |
