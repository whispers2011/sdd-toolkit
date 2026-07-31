# Contract: Ton- und Auslöser-Katalog

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Vertrag des puren Moduls `packages/shared/src/soundCatalog.ts`. Der Katalog ist
Daten; der Web-Renderer ist ein Interpreter dieser Daten (research D4).

---

## S1 — Auslöser-Katalog

```ts
export const SOUND_TRIGGERS: readonly SoundTrigger[];
export function soundTrigger(id: SoundTriggerId): SoundTrigger;
```

| # | Zusicherung | Quelle |
|---|---|---|
| S1.1 | Genau 20 Einträge: 10 `attention:*` + 2 `flow:*` + 1 `phase:changed` + 7 `phase:<FeaturePhase>` | FR-004, SC-001 |
| S1.2 | Die `attention:*`-Einträge entstehen **aus** `AttentionKind`, die `phase:*`-Einträge **aus** `FEATURE_PHASES` — keine zweite handgeschriebene Liste | Spec-Assumption „Auslöser-Vokabular" |
| S1.3 | `id` und `label` paarweise eindeutig; jedes `label` deutsch und ohne den Schlüssel zu wiederholen | FR-007 |
| S1.4 | `attention:awaiting_input` und `attention:permission_request` tragen einen `hint`, der die bisherige Stille begründet (WhisperM8-Regel) | FR-014 |
| S1.5 | `constitution` ist **kein** Auslöser | Spec-Assumption |

**Belegte Bezeichnungen** (verbindlich, weil in Oberfläche und Vorhören sichtbar):

| Auslöser | Label |
|---|---|
| `attention:awaiting_input` | Eingabe erwartet |
| `attention:permission_request` | Berechtigung erfragt |
| `attention:verify_failed` | Verifikation fehlgeschlagen |
| `attention:gate_failed` | Gate fehlgeschlagen |
| `attention:merge_conflict_escalated` | Merge-Konflikt eskaliert |
| `attention:review_due` | Review fällig |
| `attention:agent_errored` | Agent-Fehler |
| `attention:run_interrupted` | Lauf abgebrochen |
| `attention:phase_gate_failed` | Phasen-Gate fehlgeschlagen |
| `attention:approval_required` | Freigabe nötig |
| `flow:turn_completed` | Agent-Zug fertig |
| `flow:merged` | Feature gemergt |
| `phase:changed` | Phasenwechsel (allgemein) |
| `phase:specify` … `phase:implement` | „Phase erreicht: <Phasenname>" — Phasenname aus `PHASE_META` |

`PHASE_META` liegt bereits in `packages/shared/src/workflowModel.ts:36` und ist
die einzige Quelle der Phasennamen.

---

## S2 — Ton-Katalog

```ts
export const TONES: readonly Tone[];
export function tone(id: ToneId): Tone;
export function toneFingerprint(t: Tone): string;
export function toneDurationMs(t: Tone): number;
```

| # | Zusicherung | Quelle |
|---|---|---|
| S2.1 | ≥ 20 Einträge (Vorgabe: 22, Reserve gegen spätere Zusammenlegung) | FR-006, SC-001 |
| S2.2 | `id` paarweise eindeutig | FR-007 |
| S2.3 | `label` paarweise eindeutig, deutsch, benennt den Klangcharakter | FR-007 |
| S2.4 | `toneFingerprint` paarweise eindeutig — Klangfarbe ⊕ Tonhöhenfolge ⊕ Rhythmusfolge | FR-006 |
| S2.5 | Wohlgeformt: `steps.length ≥ 1`, `freq > 0`, `ms > 0`, `gapMs ≥ 0` | — |
| S2.6 | `TONES[0].id === 'two-tone-rise'` und entspricht **exakt** dem heutigen Beep: `sine`, 880 Hz / 1174 Hz, je 150 ms Klang, 120 ms Versatz | FR-012, FR-013 |
| S2.7 | Kein Eintrag verweist auf eine Datei, eine URL oder ein Netz | Spec-Assumption „Töne ohne Dateien" |

`toneFingerprint` ist die prüfbare Fassung von FR-006 und wird ausschliesslich
vom Test benutzt — nicht zur Laufzeit.

---

## S3 — Standardbelegung

```ts
export const DEFAULT_SOUND_SETTINGS: SoundSettings;
```

| # | Zusicherung | Quelle |
|---|---|---|
| S3.1 | `enabled === true` | FR-010 |
| S3.2 | `volume === 0.06` — Zahlenwert des heutigen `gain` (`store.tsx:382`) | FR-013 |
| S3.3 | `reactions` enthält **genau zwei** Einträge: `flow:turn_completed` und `flow:merged`, beide `{ kind: 'tone', toneId: 'two-tone-rise' }` | FR-012, SC-003 |
| S3.4 | Alle übrigen 18 Auslöser sind nicht enthalten und damit stumm | FR-012, FR-014, SC-003, SC-004 |

---

## S4 — Normalisierung

```ts
export function normalizeSoundSettings(raw: unknown): SoundSettings;
```

| # | Eingabe | Ergebnis | Quelle |
|---|---|---|---|
| S4.1 | `null` / `undefined` / kein Objekt / defektes JSON | `DEFAULT_SOUND_SETTINGS` | FR-003 |
| S4.2 | `reactions`-Schlüssel nicht im Auslöser-Katalog | Eintrag verworfen, Rest bleibt | FR-020 |
| S4.3 | `{ kind: 'tone', toneId: <unbekannt> }` | Eintrag verworfen (⇒ Stille) | FR-003, FR-020 |
| S4.4 | `{ kind: 'speech', text: <kein string> }` | Eintrag verworfen | FR-003 |
| S4.5 | `{ kind: 'speech', text: <> 200 Zeichen> }` | auf 200 Zeichen gekürzt | — |
| S4.6 | `{ kind: <unbekannt> }` | Eintrag verworfen | FR-003 |
| S4.7 | `volume` ausserhalb `[0,1]` oder keine Zahl | geklemmt bzw. Standardwert | FR-013 |
| S4.8 | `enabled` kein Boolean | Standardwert | FR-010 |
| S4.9 | Ein gültiger Bestand | unverändert (Idempotenz: `f(f(x)) === f(x)`) | — |

**Wichtig**: Fehlt `reactions` vollständig, gilt es als *leere Karte* — nicht als
„Standardbelegung". Nur ein fehlender **Gesamteintrag** (S4.1) liefert die
Standardbelegung. Sonst liesse sich „alles stumm" nicht speichern.

---

## S5 — Auflösung

```ts
export type SoundEvent =
  | { kind: 'attention'; attention: AttentionKind }
  | { kind: 'flow'; flow: 'turn_completed' | 'merged' }
  | { kind: 'phase'; phase: FeaturePhase };

export function resolveReaction(
  settings: SoundSettings,
  event: SoundEvent,
): { triggerId: SoundTriggerId; reaction: SoundReaction } | null;
```

| # | Zusicherung | Quelle |
|---|---|---|
| S5.1 | `settings.enabled === false` ⇒ immer `null`; `settings.reactions` bleibt unangetastet | FR-010, US1/8 |
| S5.2 | Aufgelöste Reaktion `silence` ⇒ `null` | US1/7 |
| S5.3 | `attention` / `flow` ⇒ direkter Schlüssel, keine Ausweichregel | FR-004 |
| S5.4 | `phase` ⇒ `phase:<phase>`, falls dort eine Reaktion ≠ Stille steht; sonst `phase:changed` | FR-016, research D3 |
| S5.5 | Ergebnis ist höchstens **eine** Reaktion — nie zwei | FR-016, FR-017 |
| S5.6 | Rein: keine Uhr, kein Zufall, kein Zustand | — |

---

## S6 — Phasen-Diff

```ts
export function enteredPhase(
  prev: Record<FeaturePhase, PhaseState> | undefined,
  next: Record<FeaturePhase, PhaseState>,
): FeaturePhase | null;
```

Liegt in `packages/shared/src/phaseMachine.ts` (Heimat der Phasenübergänge).

| # | Zusicherung | Quelle |
|---|---|---|
| S6.1 | Liefert die Phase, deren Status auf `running` wechselte und vorher nicht `running` war | research D2 |
| S6.2 | `prev === undefined` (erstes Eintreffen eines Features) ⇒ `null` — kein Ton beim Verbinden oder Neuladen | FR-018-Geist: keine Ausgabe ohne Ereignis |
| S6.3 | Mehrere gleichzeitige Wechsel ⇒ die in `FEATURE_PHASES` **späteste** Phase (die weitergehende Arbeit) | FR-016 |
| S6.4 | Kein Wechsel nach `running` ⇒ `null` (Freigaben, Verwerfen, Integrationsstufen bleiben stumm) | FR-004 |
| S6.5 | Rein: keine Uhr, kein Zufall, kein Zustand | — |
