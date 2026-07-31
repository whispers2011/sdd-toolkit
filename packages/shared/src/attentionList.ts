import type { AttentionItem } from './types.js';

/**
 * Entfernt die aufgelöste Meldung aus der angezeigten Liste.
 *
 * Zuordnung ausschliesslich über die eigene Kennung der Meldung (FR-004): ein Abgleich über
 * `sessionId`, `featureId` oder `conversationId` findet NICHT statt. Auflösungs-Meldungen tragen
 * per Vertrag nur Item-IDs (siehe contracts/attention-resolution.md, C1).
 *
 * Damit bleibt eine Meldung, die unmittelbar nach der Auflösung ihrer Vorgängerin neu entsteht,
 * sichtbar — sie hat eine eigene ID. Eine Zuordnung über die Session würde sie mitentfernen.
 */
export function applyAttentionResolved(items: readonly AttentionItem[], resolvedId: string): AttentionItem[] {
  return items.filter((a) => a.id !== resolvedId);
}
