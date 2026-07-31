# Contract: HTTP- und Ereignis-Verträge

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Verträge zwischen `@sdd/server` und `@sdd/web`. Ergänzt werden zwei
Settings-Einträge und eine Route; die Ereignisströme bleiben **unverändert**.

---

## A1 — `GET /api/state` (bestehend, erweitert)

Der Boot-Zustand trägt die nutzerweiten Einstellungen mit — kein zweiter Rundlauf,
kein Wettlauf gegen die ersten WS-Ereignisse (research D8).

**Antwort (Auszug, neu ist ausschliesslich `personal`)**

```jsonc
{
  "projects": [ /* … */ ],
  "features": [ /* … */ ],
  "sessions": [ /* … */ ],
  "attention": [ /* … */ ],
  "queues": { /* … */ },
  "automation": { /* … */ },
  "optimization": { /* … */ },
  "personal": {
    "sound": {
      "enabled": true,
      "volume": 0.06,
      "reactions": {
        "flow:turn_completed": { "kind": "tone", "toneId": "two-tone-rise" },
        "flow:merged":         { "kind": "tone", "toneId": "two-tone-rise" }
      }
    },
    "ticketSource": "jira"
  }
}
```

**Zusicherungen**

| # | Zusicherung | Quelle |
|---|---|---|
| A1.1 | `personal` ist immer vorhanden und vollständig — fehlende oder unlesbare Einträge liefern Standardwerte, kein `null`, kein Fehler | FR-003 |
| A1.2 | `personal.sound` ist normalisiert (unbekannte Auslöser und Töne bereits entfernt) | FR-020 |
| A1.3 | Die übrigen Felder von `/api/state` sind unverändert | — |

---

## A2 — `PATCH /api/settings/personal` (neu)

Teilmengen-Semantik nach dem Muster von `PATCH /api/settings/optimization`
(`server.ts:1396`): nur mitgesandte Felder ändern sich.

**Anfrage**

```jsonc
{
  "sound": {                       // optional; wird flach in den Bestand gemischt
    "enabled": false,              // optional
    "volume": 0.06,                // optional
    "reactions": {                 // optional; ERSETZT die Zuordnungen als Ganzes
      "attention:review_due": { "kind": "tone", "toneId": "chime-soft" },
      "attention:approval_required": { "kind": "speech", "text": "Freigabe für Zahlungsmodul" },
      "phase:implement": { "kind": "silence" }
    }
  },
  "ticketSource": "manual"         // optional
}
```

**Antwort**: das vollständige, normalisierte `PersonalSettings` (wie A1).

**Zusicherungen**

| # | Zusicherung | Quelle |
|---|---|---|
| A2.1 | Fehlende Felder bleiben unverändert; `sound` und `ticketSource` sind unabhängig setzbar | FR-001 |
| A2.2 | `reactions` wird als **ganze Karte** ersetzt, nicht je Schlüssel gemischt — nur so ist „zurück auf Stille" ausdrückbar | FR-005 |
| A2.3 | Unbekannte Auslöser-Schlüssel und unbekannte `toneId` werden verworfen, nicht abgelehnt; die Antwort zeigt den bereinigten Stand | FR-020, FR-003 |
| A2.4 | `volume` wird auf `[0, 1]` geklemmt | FR-013 |
| A2.5 | `ticketSource ∉ {'jira','manual'}` ⇒ Wert wird ignoriert, Bestand bleibt | FR-003 |
| A2.6 | Das Schreiben berührt `settings['jira.lastSelection']` **nicht** | FR-032, SC-011 |
| A2.7 | Umgekehrt lässt `PUT /api/settings/jira` `settings['ticketSource']` unberührt (bestehendes Verhalten, durch Test festgenagelt) | FR-032, SC-011 |
| A2.8 | Kein WS-Broadcast — die schreibende Oberfläche kennt das Ergebnis aus der Antwort; weitere Tabs ziehen beim nächsten Boot nach (mehrere Tabs sind ausdrücklich nicht im Umfang) | Nicht im Umfang |

**Ablage**: zwei Einträge in `settings` — `sound` und `ticketSource`
(Spec-Dependency: „wird um zwei Einträge erweitert").

---

## A3 — Ereignisströme (unverändert, neue Lesart)

Es wird **kein** Ereignis hinzugefügt und keines geändert. Die Ton-Ebene liest
mit (research D1/D2):

| WS-Event | Feld | Wird zu | Bemerkung |
|---|---|---|---|
| `attention_raised` | `kind: AttentionKind` | `attention:<kind>` | 10 Auslöser, 1:1 |
| `notification` | `kind: 'turn_completed'` | `flow:turn_completed` | heute hörbar |
| `notification` | `kind: 'merged'` | `flow:merged` | heute hörbar |
| `notification` | `kind: 'input_requested'` | — **ignoriert** | Duplikat zu `attention:awaiting_input` |
| `notification` | `kind: 'escalation'` | — **ignoriert** | Duplikat zu `attention:phase_gate_failed` / `attention:merge_conflict_escalated` |
| `feature_updated` | `phases` | `phase:<phase>` / `phase:changed` | über Diff gegen den letzten Stand |

**Zusicherungen**

| # | Zusicherung | Quelle |
|---|---|---|
| A3.1 | Ein Vorfall erzeugt höchstens **eine** hörbare Ausgabe | FR-017 |
| A3.2 | Die sichtbaren Benachrichtigungen (`Notification`-API, Aufmerksamkeits-Eingang) verhalten sich unverändert — auch bei stummem Auslöser und ausgeschaltetem Hauptschalter | FR-018, US1/7, Nicht im Umfang |
| A3.3 | `attention_resolved`, `queue_updated` und alle übrigen Ereignisse lösen keine Ausgabe aus | FR-004 (fester Katalog) |

---

## A4 — Serverseitige Normalisierung

`SettingsRepo` erhält `getPersonal(): PersonalSettings` und
`setPersonal(patch): PersonalSettings`.

| # | Zusicherung | Quelle |
|---|---|---|
| A4.1 | Beide Methoden wenden `normalizeSoundSettings` aus `@sdd/shared` an — Server und Client teilen dieselbe Wahrheit | FR-003, FR-020 |
| A4.2 | Ein defekter JSON-Wert in `settings` führt zu Standardwerten, nicht zu einem 500er | FR-003 |
| A4.3 | Kataloge (Auslöser, Töne) leben **nur** in `@sdd/shared`; der Server hält keine zweite Liste | E4-Geist: keine Zahl, kein Duplikat |
