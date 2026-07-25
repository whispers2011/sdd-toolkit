import { describe, expect, it } from 'vitest';
import { parseFeatureProposal } from './chatProposal.js';

describe('parseFeatureProposal', () => {
  it('liefert Text unverändert ohne Marker', () => {
    const r = parseFeatureProposal('Nur eine normale Antwort.');
    expect(r).toEqual({ cleanText: 'Nur eine normale Antwort.', proposal: null });
  });

  it('extrahiert einen Marker mitten im Text und entfernt ihn', () => {
    const text = [
      'Das klingt nach einem eigenen Feature. Soll ich es anlegen?',
      '',
      '<feature-vorschlag name="pdf-export">Export aller Features als PDF-Report mit Kostenübersicht.</feature-vorschlag>',
      '',
      'Sag einfach Bescheid.',
    ].join('\n');
    const r = parseFeatureProposal(text);
    expect(r.proposal).toEqual({
      name: 'pdf-export',
      description: 'Export aller Features als PDF-Report mit Kostenübersicht.',
    });
    expect(r.cleanText).not.toContain('feature-vorschlag');
    expect(r.cleanText).toContain('Soll ich es anlegen?');
    expect(r.cleanText).toContain('Sag einfach Bescheid.');
    expect(r.cleanText).not.toMatch(/\n{3,}/);
  });

  it('zählt bei mehreren Markern nur den ersten, entfernt aber alle', () => {
    const text =
      '<feature-vorschlag name="erster">A</feature-vorschlag> und ' +
      '<feature-vorschlag name="zweiter">B</feature-vorschlag>';
    const r = parseFeatureProposal(text);
    expect(r.proposal?.name).toBe('erster');
    expect(r.cleanText).toBe('und');
  });

  it('mehrzeilige Beschreibung bleibt erhalten', () => {
    const text = '<feature-vorschlag name="multi">Zeile 1\nZeile 2</feature-vorschlag>';
    expect(parseFeatureProposal(text).proposal?.description).toBe('Zeile 1\nZeile 2');
  });

  it('leerer Name oder leere Beschreibung → kein Vorschlag, Marker trotzdem entfernt', () => {
    const leererName = parseFeatureProposal('<feature-vorschlag name="  ">Beschreibung</feature-vorschlag>');
    expect(leererName.proposal).toBeNull();
    expect(leererName.cleanText).toBe('');

    const leereBeschreibung = parseFeatureProposal('<feature-vorschlag name="x">   </feature-vorschlag>');
    expect(leereBeschreibung.proposal).toBeNull();
    expect(leereBeschreibung.cleanText).toBe('');
  });

  it('kaputter Marker (fehlendes name-Attribut / nicht geschlossen) bleibt unangetastet', () => {
    const ohneName = 'Text <feature-vorschlag>abc</feature-vorschlag>';
    expect(parseFeatureProposal(ohneName)).toEqual({ cleanText: ohneName, proposal: null });

    const offen = 'Text <feature-vorschlag name="x">abc';
    expect(parseFeatureProposal(offen)).toEqual({ cleanText: offen, proposal: null });
  });
});
