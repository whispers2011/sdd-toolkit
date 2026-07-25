import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscriptRange } from './transcriptWatcher.js';

describe('readTranscriptRange', () => {
  let dir: string;
  let path: string;
  // Drei Zeilen; jede endet mit \n.
  const l1 = JSON.stringify({ type: 'user', message: { content: 'a' } }) + '\n';
  const l2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }) + '\n';
  const l3 = JSON.stringify({ type: 'user', message: { content: 'c' } }) + '\n';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-range-'));
    path = join(dir, 't.jsonl');
    writeFileSync(path, l1 + l2 + l3, 'utf8');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('liest genau den Byte-Bereich [start, end) — nur der eine Lauf', () => {
    const start = Buffer.byteLength(l1, 'utf8');
    const end = start + Buffer.byteLength(l2, 'utf8');
    const lines = readTranscriptRange(path, start, end);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).message.content[0].text).toBe('b');
  });

  it('kappt end jenseits EOF auf die Dateigröße (laufender Lauf)', () => {
    const start = Buffer.byteLength(l1 + l2, 'utf8');
    const lines = readTranscriptRange(path, start, Number.MAX_SAFE_INTEGER);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).message.content).toBe('c');
  });

  it('leeres Array bei fehlender Datei', () => {
    expect(readTranscriptRange(join(dir, 'weg.jsonl'), 0, 100)).toEqual([]);
  });

  it('leeres Array wenn end <= start', () => {
    expect(readTranscriptRange(path, 10, 10)).toEqual([]);
    expect(readTranscriptRange(path, 20, 5)).toEqual([]);
  });
});
