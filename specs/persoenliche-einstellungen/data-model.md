# Phase 1 Data Model: Individuelle Einstellungen

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Abgeleitet aus „Key Entities" der [spec.md](./spec.md). Verbindliche Typen
entstehen in `packages/shared/src/types.ts` (Ablage- und Übertragungsformen) sowie
`packages/shared/src/soundCatalog.ts` (feste Kataloge). Die hier gezeigten
Signaturen sind der Vertrag, nicht die Implementierung.

---

## 1 — Auslöser (`SoundTrigger`)

Ein benanntes Ereignis, das eine hörbare Reaktion auslösen kann. **Fester
Katalog, nicht erweiterbar durch Nutzer.**

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `SoundTriggerId` | Stabiler Schlüssel, auch Ablage-Schlüssel |
| `label` | `string` | Bezeichnung in der Oberfläche (deutsch) |
| `group` | `'attention' \| 'flow' \| 'phase'` | Gruppierung im Einstellungsbereich |
| `hint` | `string \| undefined` | Erklärender Zusatz (trägt u. a. die Begründung aus FR-014) |

### Schlüsselraum (20 Auslöser, FR-004)

```text
attention:awaiting_input            attention:permission_request
attention:verify_failed             attention:gate_failed
attention:merge_conflict_escalated  attention:review_due
attention:agent_errored             attention:run_interrupted
attention:phase_gate_failed         attention:approval_required     (10, group 'attention')

flow:turn_completed                 flow:merged                     ( 2, group 'flow')

phase:changed                                                       ( 1, group 'phase')
phase:specify   phase:clarify   phase:plan   phase:checklist
phase:analyze   phase:tasks     phase:implement                     ( 7, group 'phase')
```

**Herkunft (nicht neu erfunden, siehe research D1/D2)**

- `attention:*` — 1:1 aus `AttentionKind` (`types.ts:222`), gespeist vom
  WS-Event `attention_raised`.
- `flow:*` — die zwei heute hörbaren `notification`-Arten (`events.ts:34`).
  Die Arten `input_requested` und `escalation` sind **kein** Auslöser (D1).
- `phase:*` — 1:1 aus `FEATURE_PHASES` (`types.ts:2`) plus ein generischer
  Eintrag. `ProjectPhase = 'constitution'` ist **kein** Auslöser (Spec-Assumption).

**Ableitungsregel**: Der Katalog wird aus `AttentionKind` und `FEATURE_PHASES`
konstruiert, nicht danebengeschrieben. Fällt eine `AttentionKind` weg oder kommt
eine Phase hinzu, ändert sich der Katalog automatisch mit; FR-020 regelt die
Folgen für gespeicherte Zuordnungen.

---

## 2 — Ton (`Tone`)

Ein benanntes, ohne Audiodatei erzeugtes Klangmuster. **Fester Katalog** (22
Einträge, ≥ 20 gefordert).

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `ToneId` | Stabiler Schlüssel, Ablagewert |
| `label` | `string` | Wiedererkennbare Bezeichnung (FR-007) |
| `wave` | `'sine' \| 'square' \| 'triangle' \| 'sawtooth'` | Klangfarbe |
| `steps` | `ToneStep[]` | Sequenz, min. 1 Schritt |

```ts
interface ToneStep {
  freq: number;   // Hz, > 0
  ms: number;     // Klingdauer, > 0
  gapMs: number;  // Pause danach, ≥ 0
}
```

**Validierungsregeln**

| Regel | Quelle |
|---|---|
| ≥ 20 Einträge | FR-006 / SC-001 |
| `id` paarweise eindeutig | FR-007 |
| `label` paarweise eindeutig | FR-007 |
| Fingerprint `wave ⊕ [freq…] ⊕ [ms/gapMs…]` paarweise eindeutig | FR-006 |
| `steps.length ≥ 1`, `freq > 0`, `ms > 0`, `gapMs ≥ 0` | Wohlgeformtheit |
| Eintrag `two-tone-rise` = 880 Hz/1174 Hz, sine, 150 ms Klang / 120 ms Versatz | FR-012, FR-013 |

Der Fingerprint ist die maschinenprüfbare Fassung von „keine zwei Töne mit
derselben Kombination aus Tonhöhenfolge, Klangfarbe und Rhythmus".

**Gesamtdauer** `toneDurationMs(tone) = Σ (ms + gapMs)` — von der Warteschlange
als Sicherheitsfrist genutzt, nicht als Taktgeber (research D5).

---

## 3 — Reaktion (`SoundReaction`)

Genau eine Reaktion je Auslöser (FR-005) — als unterscheidbare Union, damit
„Ansage ohne Text" und „Stille" nicht verschmelzen.

```ts
type SoundReaction =
  | { kind: 'silence' }
  | { kind: 'tone'; toneId: ToneId }
  | { kind: 'speech'; text: string };
```

| Regel | Quelle |
|---|---|
| `tone.toneId` muss im Katalog sein; unbekannt ⇒ Eintrag verworfen (→ Stille) | FR-003, FR-020 |
| `speech.text` leer/nur Leerraum ⇒ es wird die `label` des Auslösers gesprochen | FR-009, research D7 |
| `speech.text` wird bei der Übernahme auf 200 Zeichen begrenzt | Wohlgeformtheit |

---

## 4 — Ton-Zuordnung (`SoundSettings`)

Nutzerweit, geräteübergreifend (FR-002). Ablage: `settings`-Eintrag `sound`.

```ts
interface SoundSettings {
  enabled: boolean;                                   // Hauptschalter (FR-010)
  volume: number;                                     // 0…1, Grundlautstärke
  reactions: Partial<Record<SoundTriggerId, SoundReaction>>;
}
```

| Feld | Standardwert | Quelle |
|---|---|---|
| `enabled` | `true`, ausser Migration ergibt `false` | FR-010, FR-015 |
| `volume` | `0.06` — heutiger `gain`-Wert | FR-013 |
| `reactions` | `{ 'flow:turn_completed': tone two-tone-rise, 'flow:merged': tone two-tone-rise }` | FR-012 |

`reactions` ist **partiell**: ein fehlender Auslöser bedeutet Stille. Das erfüllt
FR-020 („neue Auslöser starten auf Stille") ohne Wanderungsschritt.

### Normalisierung (`normalizeSoundSettings`)

Eine pure Funktion in `@sdd/shared`, angewandt **beim Lesen und beim Schreiben**
auf Server und Client — dieselbe Wahrheit auf beiden Seiten:

1. Kein/unlesbarer Eintrag ⇒ vollständige Standardwerte (FR-003).
2. `reactions`-Schlüssel, die kein Auslöser des Katalogs sind ⇒ verworfen (FR-020).
3. `tone`-Reaktionen mit unbekannter `toneId` ⇒ verworfen (FR-003).
4. `volume` auf `[0, 1]` geklemmt; kein Wert ⇒ Standard.
5. `enabled` kein Boolean ⇒ Standard.

### Auflösung (`resolveReaction`)

```ts
function resolveReaction(
  settings: SoundSettings,
  event: SoundEvent,
): { triggerId: SoundTriggerId; reaction: SoundReaction } | null
```

| Eingang (`SoundEvent`) | Ergebnis |
|---|---|
| `{ kind: 'attention', attention: AttentionKind }` | `attention:<kind>` |
| `{ kind: 'flow', flow: 'turn_completed' \| 'merged' }` | `flow:<flow>` |
| `{ kind: 'phase', phase: FeaturePhase }` | `phase:<phase>`, sofern ≠ Stille; sonst `phase:changed` (FR-016, research D3) |

`null`, wenn `enabled === false` (FR-010, FR-008 bleibt unberührt: Vorhören geht
am Hauptschalter vorbei) oder die aufgelöste Reaktion Stille ist.

---

## 5 — Farbdesign (`ThemeId`)

Gerätebezogen (Spec-Assumption). Ablage: `localStorage['sdd-theme']`.

```ts
type ThemeId = 'light' | 'dark' | 'high-contrast';
```

| Design | Label | CSS-Block in `index.css` | `color-scheme` |
|---|---|---|---|
| `dark` | „Dunkel" | keiner — Tailwind-Basis (Referenzskalen) | `dark` |
| `light` | „Hell" | `:root[data-theme='light']` — **Referenz-Schlüsselsatz** | `light` |
| `high-contrast` | „Dunkel, hoher Kontrast" | `:root[data-theme='high-contrast']` — **neu** | `dark` |

**Referenz-Schlüsselsatz** (E4, nachgezählt am Light-Block, `index.css:17-85`):

| Skala | Stufen | Anzahl |
|---|---|---|
| `zinc` | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, **925**, 950 | 12 |
| `emerald` | 50 … 950 | 11 |
| `amber` | 50 … 950 | 11 |
| `red` | 50 … 950 | 11 |
| `sky` | 50 … 950 | 11 |
| **Summe Farbvariablen** | | **56** |

Die Prüfung vergleicht **Schlüsselsätze zwischen Designs**, nie die Zahl 56 (E4).

### Konsolen-Palette (`ConsolePalette`, FR-025 / E5)

Je `ThemeId` genau ein Eintrag, als `Record<ThemeId, ConsolePalette>` — ein
fehlendes Design ist damit schon ein Übersetzungsfehler. Schlüsselsatz (21):

```text
background foreground cursor cursorAccent selectionBackground
black red green yellow blue magenta cyan white
brightBlack brightRed brightGreen brightYellow brightBlue brightMagenta brightCyan brightWhite
```

`ConsolePalette` ist strukturell zu `ITheme` von `@xterm/xterm` zuweisbar; die
Adaption bleibt in `packages/web/src/terminalTheme.ts`.

**Validierungsregeln**

| Regel | Quelle |
|---|---|
| Jeder Nicht-Basis-Design-Block legt genau den Referenz-Schlüsselsatz fest | FR-023, FR-024, SC-007 |
| Fehlender Schlüssel ⇒ Prüfung schlägt fehl und benennt Design + Schlüssel | FR-024 |
| Jede `ThemeId` hat eine Konsolen-Palette mit allen 21 Schlüsseln | FR-025 |
| Keine Vorder-/Akzentfarbe einer Palette gleicht ihrem `background` | FR-028 |
| Unbekannter gespeicherter Wert ⇒ Rückfall auf gültiges Design | FR-027 |
| FOUC-Guard in `index.html` akzeptiert genau dieselben `ThemeId`-Werte | FR-026 |

---

## 6 — Vorauswahl Ticket-Quelle (`TicketSource`)

Nutzerweit (FR-002). Ablage: `settings`-Eintrag `ticketSource` — **getrennt** von
`jira.lastSelection` (E6, FR-032).

```ts
type TicketSource = 'jira' | 'manual';
```

| Regel | Quelle |
|---|---|
| Standardwert `'jira'` (heutiges Verhalten) | FR-033, SC-010 |
| Ohne Jira-Verbindung immer manuell, gespeicherter Wert bleibt unverändert | FR-030 |
| Unbekannter Wert ⇒ Standardwert | FR-003 |
| Kein Schreibzugriff auf `jira.lastSelection` und umgekehrt | FR-032, SC-011 |

---

## 7 — Übertragungsform (`PersonalSettings`)

Bündel für Boot und Teilaktualisierung. **Enthält das Design nicht** — es liegt
gerätelokal.

```ts
interface PersonalSettings {
  sound: SoundSettings;
  ticketSource: TicketSource;
}
```

Zwei Ablage-Einträge, ein Übertragungsobjekt (research D8). Vertrag der Routen:
[contracts/api-contract.md](./contracts/api-contract.md).

---

## Beziehungen

```text
SoundTrigger  ──1:0..1──▶  SoundReaction  ──0..1:1──▶  Tone
   (Katalog)               (in SoundSettings.reactions)   (Katalog)

SoundSettings   ─┐
                 ├─▶  PersonalSettings  ──▶  settings['sound'] + settings['ticketSource']
TicketSource    ─┘

ThemeId  ──1:1──▶  CSS-Block (index.css)
         ──1:1──▶  ConsolePalette (terminalTheme.ts)
         ──1:1──▶  localStorage['sdd-theme']

AttentionKind ──▶ SoundTrigger 'attention:*'    (abgeleitet)
FeaturePhase  ──▶ SoundTrigger 'phase:*'        (abgeleitet)
```

## Zustandsübergänge

Nur zwei, beide ohne Persistenzfolgen ausser dem Eintrag selbst:

1. **Hauptschalter** `enabled: true ⇄ false` — `reactions` bleibt unangetastet
   (FR-010, Szenario US1/8).
2. **Design** `ThemeId → ThemeId` — DOM zuerst (`data-theme`, `colorScheme`),
   dann `localStorage`, dann Abonnenten (bestehender Vertrag des Theme-Moduls,
   FR-022).
