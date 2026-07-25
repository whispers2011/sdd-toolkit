import { describe, expect, it } from 'vitest';
import { compileReviewPrompt } from './reviewPrompt.js';
import type { ReviewComment } from './types.js';

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: 'c1',
    featureId: 'f1',
    filePath: null,
    line: null,
    side: null,
    text: 'Text',
    status: 'open',
    createdAt: 1,
    resolvedAt: null,
    ...overrides,
  };
}

describe('compileReviewPrompt', () => {
  it('nummeriert offene Kommentare mit Datei-/Zeilen-Anker', () => {
    const prompt = compileReviewPrompt(
      [
        comment({ id: 'a', filePath: 'src/x.ts', line: 12, side: 'new', text: 'Null-Check fehlt' }),
        comment({ id: 'b', filePath: 'src/y.ts', line: null, text: 'Datei aufteilen' }),
        comment({ id: 'c', filePath: null, text: 'Commit-Message präzisieren' }),
      ],
      '',
    );
    expect(prompt).toContain('1. [src/x.ts:12] Null-Check fehlt');
    expect(prompt).toContain('2. [src/y.ts] Datei aufteilen');
    expect(prompt).toContain('3. [Allgemein] Commit-Message präzisieren');
    expect(prompt).toContain('zurückgewiesen');
  });

  it('kennzeichnet Anker auf der alten Diff-Seite', () => {
    const prompt = compileReviewPrompt(
      [comment({ filePath: 'a.ts', line: 3, side: 'old', text: 'Warum entfernt?' })],
      '',
    );
    expect(prompt).toContain('[a.ts:3 (alte Fassung)] Warum entfernt?');
  });

  it('ignoriert erledigte Kommentare und hängt Freitext an', () => {
    const prompt = compileReviewPrompt(
      [
        comment({ id: 'a', text: 'offen' }),
        comment({ id: 'b', text: 'erledigt', status: 'resolved' }),
      ],
      'Bitte auch die Tests ergänzen.',
    );
    expect(prompt).toContain('offen');
    expect(prompt).not.toContain('erledigt');
    expect(prompt).toContain('Anmerkung des Reviewers:');
    expect(prompt).toContain('Bitte auch die Tests ergänzen.');
  });

  it('funktioniert mit nur Freitext (keine Kommentare)', () => {
    const prompt = compileReviewPrompt([], 'Nur eine Anmerkung.');
    expect(prompt).not.toContain('Reviewer-Kommentare:');
    expect(prompt).toContain('Nur eine Anmerkung.');
  });
});
