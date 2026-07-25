import { describe, it, expect } from 'vitest';
import { parseSessionFeatures } from './chatProposal.js';

describe('parseSessionFeatures', () => {
  it('ohne Marker → null', () => {
    expect(parseSessionFeatures('Einfach nur Text.')).toBeNull();
  });

  it('extrahiert mehrere Features aus dem Marker', () => {
    const text = `Vorschlag:\n<sdd:features>[{"name":"pdf-export","description":"PDF"},{"name":"csv-import","description":"CSV"}]</sdd:features>`;
    expect(parseSessionFeatures(text)).toEqual([
      { name: 'pdf-export', description: 'PDF' },
      { name: 'csv-import', description: 'CSV' },
    ]);
  });

  it('ignoriert Einträge ohne name/description; trimmt', () => {
    const text = `<sdd:features>[{"name":" a ","description":" b "},{"name":"","description":"x"},{"foo":1}]</sdd:features>`;
    expect(parseSessionFeatures(text)).toEqual([{ name: 'a', description: 'b' }]);
  });

  it('leeres/ungültiges JSON → null', () => {
    expect(parseSessionFeatures('<sdd:features>kein json</sdd:features>')).toBeNull();
    expect(parseSessionFeatures('<sdd:features>[]</sdd:features>')).toBeNull();
  });
});
