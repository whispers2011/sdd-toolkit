# Contract: Lauf-Log-Endpoint

## `GET /api/executions/:id/log`

Liefert den Log-Inhalt eines einzelnen Laufs für die „Läufe"-Ansicht. Dieser Endpoint
existiert bereits; der Vertrag wird für Phasen-Läufe **erweitert** (Transkript-Rendering),
für alle übrigen Arten bleibt er **unverändert**.

### Request

- **Methode/Pfad**: `GET /api/executions/:id/log`
- **Params**: `id` — Lauf-ID. Validierung `^[A-Za-z0-9_-]+$` (unverändert).

### Response

- **200 OK** → `{ "log": string }`
  - Der `log`-String ist reiner, ANSI-freier UTF-8-Text.
- **400 Bad Request** → ungültige ID (Regex verletzt).
- **404 Not Found** → `{ "error": "Kein Log vorhanden" }` (bestehendes Fehlerschema via
  `httpError`).

### Verhaltensmatrix (Auflösungsreihenfolge)

| Fall | Bedingung | Ergebnis |
|---|---|---|
| A | Physische Datei `<dataDir>/logs/<id>.log` existiert | 200 mit Dateiinhalt (verify/review/conflict/chat/chat_work — **unverändert**) |
| B | Keine Datei, Lauf `kind='phase'`, **abgeschlossen** (`transcript_path` gesetzt) | 200 mit `renderTranscriptLog(range(transcript_path, offset_start, offset_end))` |
| C | Keine Datei, Lauf `kind='phase'`, **läuft** (`transcript_path` NULL) | Pfad aus Live-Session (`ptys.forFeature`→`locateTranscript`); 200 mit `render(range(path, offset_start, size(now)))`; leerer Ausschnitt → 200 mit leerem/Platzhalter-Text |
| D | Keine Datei, keine Transkript-Koordinaten (Vor-Fix-Altbestand) oder Transkript nicht auffindbar | 404 „Kein Log vorhanden" |
| E | Ungültige ID | 400 |

**Invarianten**

- Fall B liest strikt `[offset_start, offset_end)` → kein Vermischen mit Folgephasen (FR-003).
- Keine Größenbegrenzung des zurückgegebenen `log` (FR-009).
- Endpoint schreibt/verändert `~/.claude/**` nicht (read-only).
- Metriken/Status des Laufs werden durch den Abruf nicht verändert (FR-008).

### Beispiel (Fall B)

```
GET /api/executions/aB3xY9kLmn/log
200 OK
{ "log": "» /speckit.specify Das log …\n\nIch analysiere die Läufe-Ansicht …\n⚙ Read(packages/web/src/components/ExecutionsView.tsx)\n…" }
```

## Interne Bausteine (kein HTTP-Vertrag, aber Contract-relevant)

### `renderTranscriptLog(lines: string[]): string` — `@sdd/shared`

- **Input**: rohe JSONL-Zeilen eines Transkript-Ausschnitts.
- **Output**: bereinigter Klartext. Regeln:
  - `user`-Zeile mit reinem `tool_result`-Block → als (gekürztes) Tool-Ergebnis oder
    übersprungen; echte User-Eingabe → als Prompt-Zeile.
  - `assistant`-`text`-Blöcke → Text übernehmen.
  - `assistant`-`tool_use`-Blöcke → `⚙ <name>(<kompakter Input>)`.
  - Abbruch-Marker (`INTERRUPT_MARKER_PREFIX`) → sichtbare Abbruch-Zeile.
  - `meta`/`summary`/nicht parsebare Zeilen → überspringen.
- **Eigenschaften**: pure, deterministisch, keine I/O; robust gegen kaputte Zeilen.

### `readTranscriptRange(path, start, end): string[]` — `@sdd/server` (`transcriptWatcher.ts`)

- Liest Bytes `[start, min(end, size))` und splittet in nicht-leere Zeilen.
- Verallgemeinert `readTranscriptDelta` (das bis EOF liest); robust gegen fehlende/gekürzte
  Datei (leeres Array).

### `ExecutionRepo.get(id): ExecutionRecord | undefined` — `@sdd/server` (`repos.ts`)

- Einzelabruf inkl. `transcript_path` / `transcript_offset_start` / `transcript_offset_end`.
