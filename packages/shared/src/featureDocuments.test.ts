import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_FEATURE,
  buildDocumentsPreamble,
  formatBytes,
  reasonEmpty,
  reasonTooLarge,
  reasonTooMany,
  type FeatureDocument,
} from './featureDocuments.js';

function doc(patch: Partial<FeatureDocument> = {}): FeatureDocument {
  return {
    name: 'Anforderungen 2026.pdf',
    storedName: 'Anforderungen 2026.pdf',
    relPath: 'specs/kundenimport/docs/Anforderungen 2026.pdf',
    bytes: 1258291,
    mimeType: 'application/pdf',
    uploadedAt: 1785312000000,
    ...patch,
  };
}

const schema = doc({
  name: 'schema.sql',
  storedName: 'schema.sql',
  relPath: 'specs/kundenimport/docs/schema.sql',
  bytes: 4403,
  mimeType: 'application/sql',
});

describe('formatBytes', () => {
  it('nennt Byte, KB und MB in der Form, die die Ablehnungsgründe zitieren', () => {
    expect(formatBytes(0)).toBe('0 Byte');
    expect(formatBytes(840)).toBe('840 Byte');
    expect(formatBytes(4403)).toBe('4.3 KB');
    expect(formatBytes(1258291)).toBe('1.2 MB');
    expect(formatBytes(31457280)).toBe('30.0 MB');
  });

  it('setzt die Grenzen der Ablehnungsgründe aus den Konstanten zusammen (FR-018)', () => {
    expect(reasonTooLarge('dump.sql', 43200000)).toBe('dump.sql: zu groß (41.2 MB, max. 25 MB)');
    expect(reasonEmpty('leer.txt')).toBe('leer.txt: leere Datei (0 Byte)');
    expect(reasonTooMany('elf.txt')).toBe('elf.txt: Höchstzahl von 20 Dokumenten je Feature erreicht');
    expect(MAX_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_DOCUMENTS_PER_FEATURE).toBe(20);
  });
});

describe('buildDocumentsPreamble', () => {
  // SC-006: der einzige Schutz davor, dass der dokumentlose Prompt still wächst.
  it('liefert ohne Dokumente einen leeren String — kein leerer Abschnitt (FR-017, SC-006)', () => {
    expect(buildDocumentsPreamble('specify', [])).toBe('');
    expect(buildDocumentsPreamble('implement', [])).toBe('');
  });

  it('baut für specify den Block aus contracts/document-preamble.md', () => {
    expect(buildDocumentsPreamble('specify', [doc(), schema])).toBe(
      '\n\n[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt (Ablage: specs/kundenimport/docs/):\n' +
        '- `Anforderungen 2026.pdf` → specs/kundenimport/docs/Anforderungen 2026.pdf (1.2 MB)\n' +
        '- `schema.sql` → specs/kundenimport/docs/schema.sql (4.3 KB)\n' +
        'Verwende dieses Material als Ausgangsbasis der Spezifikation.',
    );
  });

  it('setzt für die übrigen Phasen dieselbe Liste mit anderer Schlusszeile (FR-007)', () => {
    for (const phase of ['clarify', 'plan', 'checklist', 'analyze', 'tasks', 'implement'] as const) {
      const text = buildDocumentsPreamble(phase, [doc(), schema]);
      expect(text).toContain(
        '[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt (Ablage: specs/kundenimport/docs/):',
      );
      expect(text).toContain('- `schema.sql` → specs/kundenimport/docs/schema.sql (4.3 KB)');
      expect(text.endsWith('Berücksichtige dieses Material bei diesem Schritt; lies gezielt, was für den Schritt relevant ist.')).toBe(true);
      expect(text).not.toContain('Ausgangsbasis der Spezifikation');
    }
  });

  it('setzt sich mit \\n\\n vom vorangehenden Prompt-Text ab', () => {
    expect(buildDocumentsPreamble('plan', [doc()]).startsWith('\n\n[Dokumente]')).toBe(true);
  });

  it('nennt Anzeigename UND Fundort je Eintrag (FR-006, FR-007)', () => {
    const umbenannt = doc({ name: 'bericht.txt', storedName: 'bericht-2.txt', relPath: 'specs/x/docs/bericht-2.txt' });
    const text = buildDocumentsPreamble('specify', [umbenannt]);
    expect(text).toContain('`bericht.txt`'); // Anzeigename, wie der Nutzer die Datei nannte
    expect(text).toContain('specs/x/docs/bericht-2.txt'); // Fundort, unter dem sie liegt
  });

  it('formuliert die Kopfzeile im Singular, wenn genau ein Dokument hinterlegt ist', () => {
    expect(buildDocumentsPreamble('specify', [doc()])).toContain(
      'Zu diesem Feature wurde 1 Dokument hinterlegt',
    );
  });

  // FR-009 / Edge Case „Sehr großes Dokument": der Block trägt Verweise, keinen Inhalt.
  it('wächst nicht mit der Dateigröße — 20 MB erzeugt denselben Text wie 2 KB (FR-009)', () => {
    const klein = doc({ name: 'klein.txt', relPath: 'specs/x/docs/klein.txt', bytes: 2048 });
    const gross = doc({ name: 'klein.txt', relPath: 'specs/x/docs/klein.txt', bytes: 20 * 1024 * 1024 });

    const textKlein = buildDocumentsPreamble('plan', [klein]);
    const textGross = buildDocumentsPreamble('plan', [gross]);

    expect(textKlein.replace('2.0 KB', 'X')).toBe(textGross.replace('20.0 MB', 'X'));
    expect(textGross.length - textKlein.length).toBeLessThan(5); // nur die Größenangabe unterscheidet sich
  });
});
