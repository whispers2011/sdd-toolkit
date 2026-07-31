# Contract: Send-Pipeline (`PtySessionManager.sendPrompt`)

Zentrale Nahtstelle. Alle echten Kommando-Auslösepunkte laufen hierüber → diese Garantien gelten „überall" (FR-001, FR-002, FR-005, FR-008).

## Signatur (unverändert nach außen)

```ts
sendPrompt(id: string, text: string): void
// optional erweitert um Fehlerbenachrichtigung an den Orchestrator:
callbacks.onSubmitFailed?(session: LiveSession, text: string): void
```

## Garantien

1. **Zuverlässige Zustellung** — Der Prompt wird abgeschickt (paste + CR), sobald die Session eingabebereit ist. Ist sie beim Aufruf noch nicht bereit (`created`/`launching`), wird der Prompt eingereiht und beim Übergang nach `ready` in FIFO-Reihenfolge abgespült. → *Kein Prompt bleibt unabgeschickt in der Eingabezeile stehen.*
2. **Bestätigte Zustellung** — Nach dem CR gilt der Prompt erst als zugestellt, wenn die Session-Maschine nach `working` übergeht bzw. der `user_prompt_submit`-Hook feuert. Bleibt das innerhalb des Bestätigungsfensters aus, wird das CR bis zu `MAX_SUBMIT_RETRIES`-mal wiederholt.
3. **Fehlermeldung** — Sind die Retries erschöpft (oder Session `stopped`/`errored`, oder Ready-Timeout überschritten), wird `onSubmitFailed(session, text)` aufgerufen. `sendPrompt` wirft nicht synchron.
4. **Reihenfolge** — Mehrere `sendPrompt`-Aufrufe an dieselbe Session behalten ihre Reihenfolge (Reset-Kommando vor Phasenprompt bleibt korrekt, vgl. `orchestrator.launchPhase`).
5. **Keine Regression an bereiten Sessions** — Ist die Session bereits `ready`/`working` (z. B. PromptBar-Senden in laufender Konsole), erfolgt das Absenden ohne wahrnehmbare Zusatzverzögerung.

## Zustands-/Bereitschaftsmatrix

| Session-State beim Aufruf | Verhalten |
|---------------------------|-----------|
| `created`, `launching` | einreihen; bei `ready` abspülen |
| `ready`, `turn_done`, `awaiting_input` | sofort paste + CR + Bestätigung |
| `working` | paste + CR (an bestehenden Turn anhängen) + Bestätigung |
| `stopped`, `errored` | `onSubmitFailed` |

## Parameter (benannte Konstanten, in `commandBuilder.ts`)

| Konstante | Startwert | Zweck |
|-----------|-----------|-------|
| `SUBMIT_DELAY_MS` | 80 | Settle zwischen Paste und erstem CR (bestehend) |
| `SUBMIT_CONFIRM_MS` | ~500 | Fenster, in dem `working`/`user_prompt_submit` erwartet wird |
| `MAX_SUBMIT_RETRIES` | 3 | Zusätzliche CRs vor `onSubmitFailed` |
| `READY_TIMEOUT_MS` | ~30000 | Max. Wartezeit auf `ready` für eingereihte Prompts vor `onSubmitFailed` |

Werte sind fixierbar/tunebar; Tests pinnen sie.

## Nicht betroffen (bewusst)

- `write(id, data)` bleibt reines Schreiben ohne Submit → genutzt von `init-speckit` (FR-010) und `paste-image` (FR-007). Diese Pfade rufen **nicht** `sendPrompt`.

## Testbare Akzeptanz

- Frisch gespawnte Session (`created`) + `sendPrompt` → nach Übergang nach `ready` erscheint genau ein Submit; Session geht nach `working`. (US1 AC2)
- Bereite Session + `sendPrompt` → sofortiges Submit, `working` bestätigt. (US1 AC1)
- Session, die nie `working` meldet → nach `MAX_SUBMIT_RETRIES` genau ein `onSubmitFailed`. (FR-004)
- Zwei aufeinanderfolgende `sendPrompt` → Zustellreihenfolge bleibt erhalten.
