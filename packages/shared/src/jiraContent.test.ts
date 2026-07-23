import { describe, expect, it } from 'vitest';
import {
  adfToMarkdown,
  buildTicketDossier,
  fieldValueToText,
  formatComment,
  jiraContentToMarkdown,
  wikiMarkupToMarkdown,
} from './jiraContent.js';

describe('adfToMarkdown (FR-019)', () => {
  it('rendert Absätze, Überschriften und Auszeichnung', () => {
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ziel' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Sehr ' },
            { type: 'text', text: 'wichtig', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' und ' },
            { type: 'text', text: 'kursiv', marks: [{ type: 'em' }] },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
    expect(md).toBe('## Ziel\n\nSehr **wichtig** und *kursiv*.');
  });

  it('rendert Listen, Codeblöcke und Links', () => {
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'eins' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'zwei' }] }] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1;' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Doku', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        },
      ],
    });
    expect(md).toContain('- eins\n- zwei');
    expect(md).toContain('```ts\nconst a = 1;\n```');
    expect(md).toContain('[Doku](https://example.com)');
  });

  it('rendert Tabellen als Markdown-Tabelle', () => {
    const cell = (text: string, header = false) => ({
      type: header ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('Feld', true), cell('Wert', true)] },
            { type: 'tableRow', content: [cell('Prio'), cell('Hoch')] },
          ],
        },
      ],
    });
    expect(md).toBe('| Feld | Wert |\n| --- | --- |\n| Prio | Hoch |');
  });

  it('gibt Erwähnungen als Klarnamen aus (keine rohen Marker)', () => {
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'abc123', text: '@Louis Michel' } },
            { type: 'text', text: ' übernimmt.' },
          ],
        },
      ],
    });
    expect(md).toBe('Louis Michel übernimmt.');
    expect(md).not.toContain('abc123');
  });

  it('verliert unbekannte Blöcke nicht, sondern rendert ihren Inhalt', () => {
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        { type: 'weirdFutureNode', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inhalt bleibt' }] }] },
      ],
    });
    expect(md).toBe('Inhalt bleibt');
  });
});

describe('wikiMarkupToMarkdown (Altformat)', () => {
  it('konvertiert Überschriften, Listen und Auszeichnung', () => {
    const md = wikiMarkupToMarkdown('h2. Ziel\n* eins\n* zwei\nDas ist *fett* und _kursiv_ und {{code}}.');
    expect(md).toContain('## Ziel');
    expect(md).toContain('- eins\n- zwei');
    expect(md).toContain('**fett**');
    expect(md).toContain('*kursiv*');
    expect(md).toContain('`code`');
  });

  it('konvertiert Codeblöcke und Links', () => {
    const md = wikiMarkupToMarkdown('{code:java}\nint a = 1;\n{code}\nSiehe [Doku|https://example.com].');
    expect(md).toContain('```java\nint a = 1;\n```');
    expect(md).toContain('[Doku](https://example.com)');
  });

  it('ersetzt Account-Erwähnungen durch lesbaren Text', () => {
    const md = wikiMarkupToMarkdown('Bitte [~accountid:557058:abc] prüfen, danke [~lmichel].');
    expect(md).not.toContain('accountid');
    expect(md).toContain('lmichel');
  });
});

describe('fieldValueToText (FR-017: nur ausgefüllte Felder)', () => {
  it('lässt leere Werte aus', () => {
    expect(fieldValueToText(null)).toBeNull();
    expect(fieldValueToText('')).toBeNull();
    expect(fieldValueToText('  ')).toBeNull();
    expect(fieldValueToText([])).toBeNull();
    expect(fieldValueToText({})).toBeNull();
  });

  it('reduziert Jira-Objekte auf ihren Anzeigwert', () => {
    expect(fieldValueToText({ name: 'Bug' })).toBe('Bug');
    expect(fieldValueToText({ displayName: 'Louis Michel' })).toBe('Louis Michel');
    expect(fieldValueToText({ value: 'Hoch' })).toBe('Hoch');
    expect(fieldValueToText([{ name: 'backend' }, { name: 'jira' }])).toBe('backend, jira');
  });

  it('konvertiert ADF-Feldwerte nach Markdown', () => {
    expect(
      fieldValueToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AK 1' }] }] }),
    ).toBe('AK 1');
  });
});

describe('formatComment / buildTicketDossier (FR-017)', () => {
  it('formatiert Kommentare mit Autor + Zeitpunkt', () => {
    const md = formatComment({ author: 'Louis Michel', createdAt: '2026-07-20T09:30:00.000Z', body: 'Bitte prüfen.' });
    expect(md).toContain('### Louis Michel — 2026-07-20 09:30 UTC');
    expect(md).toContain('Bitte prüfen.');
  });

  it('baut ein vollständiges Dossier ohne rohe Markup-Reste', () => {
    const md = buildTicketDossier(
      { key: 'PROJ-7', url: 'https://iwf.atlassian.net/browse/PROJ-7', title: 'Login bauen', description: 'Als Nutzer…' },
      [{ author: 'Louis Michel', createdAt: '2026-07-20T09:30:00.000Z', body: 'Kommentar 1' }],
      [
        { name: 'Priorität', value: 'Hoch' },
        { name: 'Labels', value: 'backend, auth' },
        { name: 'Leeres Feld', value: '   ' },
      ],
      ['`logo.png` → jira/attachments/logo.png', '`groß.zip` — nicht abrufbar: https://…/groß.zip'],
    );
    expect(md).toContain('# PROJ-7: Login bauen');
    expect(md).toContain('[PROJ-7](https://iwf.atlassian.net/browse/PROJ-7)');
    expect(md).toContain('## Beschreibung');
    expect(md).toContain('| Priorität | Hoch |');
    expect(md).not.toContain('Leeres Feld');
    expect(md).toContain('## Kommentare (1)');
    expect(md).toContain('### Louis Michel');
    expect(md).toContain('## Anhänge');
    expect(md).toContain('nicht abrufbar');
  });

  it('lässt leere Abschnitte vollständig aus', () => {
    const md = buildTicketDossier({ key: 'P-1', url: 'https://x/browse/P-1', title: 'T' }, [], [], []);
    expect(md).not.toContain('## Beschreibung');
    expect(md).not.toContain('## Felder');
    expect(md).not.toContain('## Kommentare');
    expect(md).not.toContain('## Anhänge');
  });
});

describe('jiraContentToMarkdown (Dispatch)', () => {
  it('erkennt ADF, Wiki-Markup und Rohtext', () => {
    expect(jiraContentToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'adf' }] }] })).toBe('adf');
    expect(jiraContentToMarkdown('h1. Titel')).toBe('# Titel');
    expect(jiraContentToMarkdown(null)).toBe('');
  });
});
