import type { ReviewComment } from './types.js';

/**
 * Kompiliert offene Reviewer-Kommentare + optionalen Freitext zu einem
 * strukturierten deutschen Arbeitsauftrag für die Feature-Konsole
 * (Zurückweisen im Review-Portal).
 */
export function compileReviewPrompt(comments: ReviewComment[], freeText: string): string {
  const open = comments.filter((c) => c.status === 'open');
  const parts: string[] = [
    'Das Review dieses Features wurde zurückgewiesen. Bitte arbeite die folgenden Punkte ab',
    'und melde dich danach für ein erneutes Review.',
  ];

  if (open.length > 0) {
    parts.push('', 'Reviewer-Kommentare:');
    open.forEach((c, i) => {
      const anchor =
        c.filePath === null
          ? 'Allgemein'
          : c.line === null
            ? c.filePath
            : `${c.filePath}:${c.line}${c.side === 'old' ? ' (alte Fassung)' : ''}`;
      parts.push(`${i + 1}. [${anchor}] ${c.text.trim()}`);
    });
  }

  const trimmed = freeText.trim();
  if (trimmed) {
    parts.push('', 'Anmerkung des Reviewers:', trimmed);
  }

  return parts.join('\n');
}
