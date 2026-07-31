# Contract: Oberflächen- und Client-Verträge

**Feature**: `persoenliche-einstellungen` · **Date**: 2026-07-31

Verträge der Web-Bausteine (`packages/web`). Bestehende Verträge des
Theme-Features (dort C1–C6) werden **erweitert, nicht ersetzt**; die
Erweiterungen sind unten als U1/U2 gekennzeichnet.

---

## U1 — Theme-Modul (Erweiterung von C1)

`packages/web/src/theme.ts`

```ts
export type ThemeId = 'light' | 'dark' | 'high-contrast';
export const THEMES: readonly { id: ThemeId; label: string }[];

export function getTheme(): ThemeId;
export function setTheme(id: ThemeId): void;
export function cycleTheme(): ThemeId;          // ersetzt toggleTheme()
export function onThemeChange(cb: (id: ThemeId) => void): () => void;
export function useTheme(): ThemeId;
```

| # | Zusicherung | Quelle |
|---|---|---|
| U1.1 | Einzige Quelle der Wahrheit für das aktive Design ausserhalb von CSS — Reihenfolge bleibt: DOM (`data-theme`, `style.colorScheme`) → `localStorage` → Abonnenten | FR-022, bestehendes C1 |
| U1.2 | `colorScheme` ist `light` für `light`, sonst `dark` | FR-021 |
| U1.3 | Unbekannter oder ungültiger `localStorage`-Wert ⇒ Systempräferenz ⇒ `dark` | FR-027, US2/5 |
| U1.4 | `cycleTheme()` schaltet `dark → light → high-contrast → dark` | research D10 |
| U1.5 | Systempräferenz wird weiter nur ohne explizite Wahl gefolgt (bestehendes Verhalten) | bestehendes C1 |
| U1.6 | Die Designwahl geht **nicht** an den Server | Spec-Assumption, Nicht im Umfang |

**FOUC-Guard** (`packages/web/index.html`, Erweiterung von C2): akzeptiert genau
die drei `ThemeId`-Werte, setzt `data-theme` und `colorScheme` vor dem ersten
Paint; unbekannter Wert ⇒ `dark`. Gleichlauf mit U1.3 wird durch einen Test über
den Quelltext der Datei festgenagelt (FR-026, SC-009).

---

## U2 — Konsolen-Palette (Erweiterung von C5)

`packages/web/src/terminalTheme.ts`

```ts
export const CONSOLE_PALETTES: Record<ThemeId, ConsolePalette>;
export function terminalTheme(id: ThemeId): ITheme;
```

| # | Zusicherung | Quelle |
|---|---|---|
| U2.1 | `Record<ThemeId, …>` — ein fehlendes Design ist ein Übersetzungsfehler, kein Laufzeitproblem | FR-025 |
| U2.2 | Jede Palette legt alle 21 Schlüssel fest (siehe [data-model.md](../data-model.md) §5) | FR-025 |
| U2.3 | Keine Vordergrund-, ANSI- oder Akzentfarbe gleicht dem `background` derselben Palette | FR-028, US2/2 |
| U2.4 | `TerminalPane` aktualisiert `term.options.theme` live über `onThemeChange` — kein Remount, kein Verlust von PTY, Scrollback oder Fokus | FR-022, US2/2, bestehendes C5 |

---

## U3 — Einstellungs-Client

`packages/web/src/personalSettings.ts` — dasselbe Muster wie `theme.ts`
(Modulzustand + Abonnenten + `useSyncExternalStore`), damit Ereignisverarbeitung
im Store **ohne React-Kontext** an die Einstellungen kommt.

```ts
export function getPersonal(): PersonalSettings;
export function primePersonal(p: PersonalSettings): void;   // aus dem Boot-Zustand
export function patchPersonal(patch: Partial<PersonalSettings>): Promise<void>;
export function onPersonalChange(cb: (p: PersonalSettings) => void): () => void;
export function usePersonal(): PersonalSettings;
```

| # | Zusicherung | Quelle |
|---|---|---|
| U3.1 | Vor dem Boot gelten die Standardwerte aus `@sdd/shared` — nie `null`, nie ein Ladezustand für die Ton-Ebene | FR-003 |
| U3.2 | `primePersonal` wird beim `bootstrap` des Stores aufgerufen (auch bei jedem Wiederverbinden) | FR-002 |
| U3.3 | `patchPersonal` schreibt optimistisch, ruft `PATCH /api/settings/personal` und übernimmt die Antwort als Wahrheit; ein Fehler setzt den Stand zurück und meldet sichtbar | FR-002, FR-003 |
| U3.4 | **Migration (einmalig)**: liefert der Boot-Zustand `sound` in Standardbelegung und steht `localStorage['sdd-sound'] === 'off'`, wird `enabled: false` übernommen und serverseitig festgeschrieben; danach wird `sdd-sound` nie mehr gelesen | FR-015 |
| U3.5 | Der Schlüssel `sdd-sound` wird von keiner anderen Stelle mehr gelesen oder geschrieben | FR-011 |

---

## U4 — Ton-Ausgabe

`packages/web/src/sound.ts`

```ts
export function playReaction(r: SoundReaction, triggerLabel: string): void;   // Ereignisfall
export function previewReaction(r: SoundReaction, triggerLabel: string): Promise<PreviewResult>;
export type PreviewResult = { ok: true } | { ok: false; reason: 'audio_blocked' | 'speech_unavailable' };
export function handleSoundEvent(event: SoundEvent): void;                    // Auflösung + Einreihung
```

| # | Zusicherung | Quelle |
|---|---|---|
| U4.1 | Ein gemeinsamer, träge erzeugter `AudioContext` mit Master-Gain = `settings.volume`; `resume()` vor jeder Ausgabe | FR-013, research D6 |
| U4.2 | Warteschlange spielt strikt seriell: der nächste Eintrag beginnt erst nach dem Fertig-Signal des vorherigen; kein Ton überlappt | FR-017, SC-006 |
| U4.3 | Kapazität 20; darüber wird der älteste noch nicht begonnene Eintrag verworfen | SC-006 |
| U4.4 | Blockierte Tonausgabe oder fehlende Sprachausgabe im **Ereignisfall**: still, ohne Fehlermeldung, ohne Konsolenlärm | FR-018 |
| U4.5 | `previewReaction` läuft **am Hauptschalter vorbei** und ohne Speichern; Ergebnis innerhalb einer Sekunde hörbar | FR-008, SC-002 |
| U4.6 | `previewReaction` meldet Nichtverfügbarkeit **sichtbar** zurück (Rückgabewert, von der Oberfläche angezeigt) | FR-019 |
| U4.7 | Leerer Ansagetext ⇒ es wird `triggerLabel` gesprochen | research D7 |
| U4.8 | Ansagen nutzen `speechSynthesis` mit Systemstandardstimme — keine Stimm-, Sprach-, Tempo- oder Tonhöhenwahl | Nicht im Umfang |
| U4.9 | Die Warteschlange nimmt den Player als Abhängigkeit — testbar ohne Audio-Hardware | FR-017 |
| U4.10 | Vorhören umgeht die Warteschlange nicht; es reiht sich ein, damit auch dort nichts überlappt | FR-017 |

---

## U5 — Ereignis-Anbindung im Store

`packages/web/src/store.tsx`

| # | Zusicherung | Quelle |
|---|---|---|
| U5.1 | `attention_raised` ⇒ `handleSoundEvent({ kind: 'attention', attention: item.kind })` | FR-004 |
| U5.2 | `notification` ⇒ nur `turn_completed` und `merged` erzeugen `{ kind: 'flow', … }`; `input_requested` und `escalation` erzeugen **nichts** | research D1 |
| U5.3 | `feature_updated` ⇒ `enteredPhase(prev, next)`; Ergebnis ≠ `null` ⇒ `{ kind: 'phase', phase }`. Der letzte `phases`-Stand je Feature wird dafür in einer Ref gehalten, nicht im Reducer-Zustand | research D2 |
| U5.4 | Beim `bootstrap` werden die `phases`-Stände **ohne** Tonausgabe übernommen (Grundstand setzen) | S6.2 |
| U5.5 | `soundEnabled()` / `setSoundEnabled()` / `playCompletionSound()` sind entfernt | FR-011 |
| U5.6 | Die sichtbare `Notification`-Behandlung bleibt Zeile für Zeile unverändert | FR-018, Nicht im Umfang |

---

## U6 — Einstellungsbereich „Individuelle Einstellungen"

`packages/web/src/components/PersonalSettingsDialog.tsx`, erreichbar aus
`ToolSettings` (`Sidebar.tsx:357`) neben „Jira-Verbindung".

| # | Zusicherung | Quelle |
|---|---|---|
| U6.1 | Drei Abschnitte in dieser Reihenfolge: **Signaltöne**, **Darstellung**, **Vorauswahl Ticket-Quelle** | FR-001 |
| U6.2 | Signaltöne: Hauptschalter, Grundlautstärke, dann alle 20 Auslöser gruppiert nach `group` (Aufmerksamkeit / Ablauf / Phasen) | FR-004, FR-010 |
| U6.3 | Je Auslöser: eine Auswahl „Stille / Ton … / Ansage", bei „Ton" die Tonliste, bei „Ansage" ein Textfeld, dazu ein Vorhör-Knopf | FR-005, FR-008, FR-009 |
| U6.4 | Der Vorhör-Knopf spielt den **aktuell in der Auswahl stehenden** Wert, nicht den gespeicherten | FR-008, US1/2 |
| U6.5 | Scheitert das Vorhören, erscheint der Grund am betroffenen Auslöser | FR-019 |
| U6.6 | Die Auslöser „Eingabe erwartet" und „Berechtigung erfragt" zeigen ihren `hint` (Begründung der bisherigen Stille) | FR-014 |
| U6.7 | Darstellung: Auswahl aus `THEMES`; die Wahl wirkt sofort, ohne Speichern-Knopf und ohne Neuladen | FR-021, FR-022, SC-008 |
| U6.8 | Ticket-Quelle: Auswahl „Aus Jira importieren / Manuell erfassen"; ohne Jira-Verbindung mit dem Hinweis, dass ohne Verbindung immer manuell geöffnet wird | FR-029, FR-030 |
| U6.9 | Änderungen an Tönen und Ticket-Quelle laufen über `patchPersonal`; es gibt keinen zweiten Schreibweg | FR-002 |
| U6.10 | Der Umschalter „Sound wenn ein Agent fertig ist" verschwindet aus `AutomationDial` — genau eine Schaltstelle | FR-011 |

---

## U7 — Vorauswahl im „Neues Feature"-Fluss

`FeatureSourceGate` (`Sidebar.tsx:290-351`) — die einzige Stelle, die entscheidet.

| # | Zusicherung | Quelle |
|---|---|---|
| U7.1 | Jira verbunden ⇒ Startmodus = `getPersonal().ticketSource` | FR-029, SC-010 |
| U7.2 | Jira nicht verbunden ⇒ Startmodus `manual`, unabhängig von der Einstellung; der gespeicherte Wert bleibt unverändert | FR-030, US3/3 |
| U7.3 | `FeatureSourceToggle` bleibt in beiden Dialogen sichtbar, wenn ein Wechsel möglich ist — die Einstellung bestimmt nur die Vorauswahl | FR-031, SC-012 |
| U7.4 | Der Wechsel im Dialog verändert die gespeicherte Vorauswahl **nicht** | FR-031 |
| U7.5 | `jira.lastSelection` im Import-Dialog bleibt unberührt | FR-032, SC-011, US3/4 |

---

## U8 — Icons

`packages/web/src/components/icons.tsx`: ein drittes Icon für `high-contrast`
(Kontrast-/Halbkreis-Motiv) im bestehenden Base-Stil. `ThemeToggle` zeigt
weiterhin das Icon des **aktiven** Designs; der Tooltip nennt das nächste
(FR-021, research D10). Keine Emoji — SVG-Icon-Regel des Projekts.
