# Phase 1 Data Model: Läufe haben kein Log

## Entity: Execution (Lauf) — `executions`-Tabelle

Bestehende Entität; **zwei additive Felder** ergänzen die Transkript-Attribution eines
Phasen-Laufs. Vorhandene Felder unverändert (Metriken/Status bleiben — FR-008).

| Feld | Typ | Neu? | Bedeutung |
|---|---|---|---|
| `id` | TEXT (PK) | – | Lauf-ID (nanoid) |
| `project_id` / `feature_id` | TEXT | – | Zuordnung |
| `kind` | TEXT | – | `phase` \| `verify` \| `review` \| `conflict_resolution` \| `chat` \| `chat_work` |
| `phase` | TEXT \| null | – | Phase bei `kind='phase'` |
| `status` | TEXT | – | `running` \| `succeeded` \| `failed` \| `orphaned` |
| `started_at` / `finished_at` | INTEGER | – | Zeitstempel |
| `cost_usd` / `tokens` / `*_tokens` / `tokens_source` | – | – | Metering (unberührt) |
| `log_path` | TEXT \| null | – | Physische Log-Datei (datei-basierte Arten) |
| `transcript_offset_start` | INTEGER \| null | vorhanden | Byte-Offset im Transkript beim Lauf-Start |
| **`transcript_path`** | TEXT \| null | **NEU** | Aufgelöster Transkriptpfad des Laufs (beim Abschluss persistiert; neustartfest) |
| **`transcript_offset_end`** | INTEGER \| null | **NEU** | Byte-Offset im Transkript beim Lauf-Abschluss |

**Migration** (additiv, ans Ende der Migrationsliste in `database.ts`):

```sql
ALTER TABLE executions ADD COLUMN transcript_path TEXT;
ALTER TABLE executions ADD COLUMN transcript_offset_end INTEGER;
```

### Validierungs-/Konsistenzregeln

- `transcript_offset_end` ist `NULL`, solange der Lauf `running` ist; gesetzt beim
  Übergang zu `succeeded`/`failed` (und best effort bei `orphaned`/Exit).
- Ist `transcript_offset_end` gesetzt, gilt `transcript_offset_end >= transcript_offset_start`.
- `transcript_path` wird beim Abschluss gesetzt, sofern die Session eine
  `claudeSessionId` hatte und `locateTranscript` einen Pfad fand; sonst `NULL`.
- Felder gelten nur für `kind='phase'`; für andere Arten bleiben sie `NULL` (die nutzen
  `log_path`/physische Datei).

### Zustandsübergänge (Log-relevant)

```
start(phase)   → status=running, transcript_offset_start=size(now), offset_end=NULL, path=NULL
turn_completed → status=succeeded, transcript_offset_end=size(now), transcript_path=locate()
exit(≠0)/abort → status=failed,    transcript_offset_end=size(now), transcript_path=locate()
server-reboot  → reapOrphans(): running→orphaned (offset_end evtl. NULL → Live-Fallback)
```

## Derived View: Lauf-Log

Kein persistiertes Volltext-Artefakt für Phasen-Läufe; das Log ist eine **abgeleitete
Sicht**, on-demand erzeugt:

- **Quelle**: Transkript-Ausschnitt `readTranscriptRange(transcript_path,
  transcript_offset_start, transcript_offset_end ?? size(now))`.
- **Transformation**: `renderTranscriptLog(lines)` → bereinigter, ANSI-freier Klartext
  (Prompt, Assistant-Text, Tool-Aufrufe/-Ergebnisse, Abbruch-Marker).
- **Für datei-basierte Arten**: unverändert der Inhalt von `<dataDir>/logs/<id>.log`.

## Betroffene Typen (Code)

- `ExecutionRecord` / `ExecutionStartInput` (`repos.ts`): Felder `transcriptPath`,
  `transcriptOffsetEnd` ergänzen; `list()`- und neues `get(id)`-Mapping.
- `ExecutionInfo` (`web/src/api.ts`): optionale Felder nur falls die UI sie braucht —
  aktuell **nicht** erforderlich (die UI ruft nur den Log-Endpoint auf). Keine
  Pflicht-Erweiterung des API-Typs.
