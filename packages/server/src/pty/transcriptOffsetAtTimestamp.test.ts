import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offsetAtTimestamp, readTranscriptDelta } from './transcriptWatcher.js';

/**
 * Startmarke für einen Lauf, dessen Transkriptdatei beim Start noch unbekannt war
 * (fortgesetzte Session: die Claude-Session-ID steht erst fest, wenn die Phase
 * schon läuft). Ohne sie wurde die ganze Datei abgerechnet — ein 2-Minuten-Lauf
 * kam so auf 62 Mio. Tokens / $132, weil der 35-Minuten-Vorlauf in derselben
 * Datei mitgezählt wurde.
 */
describe('offsetAtTimestamp', () => {
  let dir: string;
  let path: string;

  const line = (ts: string, text: string) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text }] } }) + '\n';

  const vorlauf1 = line('2026-07-26T18:28:40.000Z', 'alter lauf a');
  const vorlauf2 = line('2026-07-26T19:03:00.000Z', 'alter lauf b');
  const neu1 = line('2026-07-26T21:19:30.000Z', 'neuer lauf a');
  const neu2 = line('2026-07-26T21:20:00.000Z', 'neuer lauf b');

  const RESUME = Date.parse('2026-07-26T21:19:11.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-offset-'));
    path = join(dir, 't.jsonl');
    writeFileSync(path, vorlauf1 + vorlauf2 + neu1 + neu2, 'utf8');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('setzt die Marke auf die erste Zeile des fortgesetzten Laufs', () => {
    const offset = offsetAtTimestamp(path, RESUME);
    expect(offset).toBe(Buffer.byteLength(vorlauf1 + vorlauf2, 'utf8'));

    // Und damit misst der Lauf nur seinen eigenen Verbrauch.
    const lines = readTranscriptDelta(path, offset);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => (JSON.parse(l) as { message: { content: { text: string }[] } }).message.content[0]!.text.startsWith('neuer'))).toBe(true);
  });

  it('misst ab 0, wenn die Datei ganz zum Lauf gehört (neue Session)', () => {
    writeFileSync(path, neu1 + neu2, 'utf8');
    expect(offsetAtTimestamp(path, RESUME)).toBe(0);
  });

  it('liefert die Dateigröße, wenn nichts neu genug ist (nichts zu messen)', () => {
    writeFileSync(path, vorlauf1 + vorlauf2, 'utf8');
    const size = Buffer.byteLength(vorlauf1 + vorlauf2, 'utf8');
    expect(offsetAtTimestamp(path, RESUME)).toBe(size);
    expect(readTranscriptDelta(path, size)).toEqual([]);
  });

  it('bleibt bei 0 für fehlende Datei oder Zeilen ohne Zeitstempel', () => {
    expect(offsetAtTimestamp(join(dir, 'weg.jsonl'), RESUME)).toBe(0);
    writeFileSync(path, JSON.stringify({ type: 'summary' }) + '\n', 'utf8');
    expect(offsetAtTimestamp(path, RESUME)).toBe(0);
  });
});
