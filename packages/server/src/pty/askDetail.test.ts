import { describe, expect, it } from 'vitest';
import { askDetail } from './hookBridge.js';

/**
 * Der Fragetext lag im Hook-Payload vor und wurde verworfen: Die Inbox meldete nur
 * „hat eine Frage", während drei ausformulierte Fragen mit je drei Optionen anstanden
 * (beobachtet am 27.07.2026, Lauf token-und-kostenmessung).
 */
describe('askDetail — Kurzfassung der Agentenbitte', () => {
  it('nimmt die erste Frage einer AskUserQuestion', () => {
    const detail = askDetail('AskUserQuestion', {
      questions: [{ question: 'Soll der gemeldete Geldbetrag in der Oberfläche erscheinen?' }],
    });
    expect(detail).toBe('Soll der gemeldete Geldbetrag in der Oberfläche erscheinen?');
  });

  it('weist weitere Fragen aus, statt sie zu verschlucken', () => {
    const detail = askDetail('AskUserQuestion', {
      questions: [{ question: 'Erste?' }, { question: 'Zweite?' }, { question: 'Dritte?' }],
    });
    expect(detail).toBe('Erste? (+2 weitere)');
  });

  it('kürzt sehr lange Fragen auf Inbox-Länge', () => {
    const detail = askDetail('AskUserQuestion', { questions: [{ question: 'x'.repeat(400) }] })!;
    expect(detail.length).toBeLessThanOrEqual(140);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('normalisiert Umbrüche zu einer Zeile', () => {
    expect(askDetail('AskUserQuestion', { questions: [{ question: 'Zeile eins\n\n  Zeile zwei' }] })).toBe(
      'Zeile eins Zeile zwei',
    );
  });

  it('nimmt bei ExitPlanMode die erste Überschrift des Plans', () => {
    expect(askDetail('ExitPlanMode', { plan: '## Umbau der Merge-Queue\n\nDetails …' })).toBe(
      'Umbau der Merge-Queue',
    );
  });

  it('liefert null für unbekannte Formen — dann bleibt es beim bisherigen Text', () => {
    expect(askDetail('Bash', { command: 'ls' })).toBeNull();
    expect(askDetail('AskUserQuestion', {})).toBeNull();
    expect(askDetail('AskUserQuestion', { questions: [{}] })).toBeNull();
    expect(askDetail('AskUserQuestion', null)).toBeNull();
    expect(askDetail('ExitPlanMode', { plan: '' })).toBeNull();
  });
});
