import type { SessionDisplayStatus } from './types.js';

/**
 * Kandidat für die automatische Grid-Belegung — die Teilmenge der Session-Felder,
 * die für Auswahl und Sortierung nötig ist (Feature „Grid zeigt aktive Sessions").
 */
export interface GridSessionCandidate {
  featureId: string | null;
  projectId: string;
  kind: string;
  status: SessionDisplayStatus;
  exited: boolean;
  /** Letzter Aktivitätszeitpunkt (begann zu arbeiten / stellte Rückfrage); fehlt → wie 0. */
  lastActiveAt?: number;
}

/**
 * Ermittelt die automatisch anzuzeigenden Feature-Kacheln beim Öffnen der Grid-Ansicht.
 *
 * Regeln (Spec FR-002/003/004/005/006/008/009/011/012/013):
 * - Nur Sessions des aktuellen Projekts, mit Feature-Bezug, deren Feature sichtbar ist.
 * - Nur „aufmerksamkeitsbedürftige" Sessions: `working` oder `awaiting_input`, nicht beendet.
 * - Höchstens eine Kachel pro Feature — bei mehreren Sessions zählt die zuletzt aktive.
 * - Sortierung: zuletzt aktiv zuerst; stabiler Tiebreak über die Feature-Id (kein Springen).
 * - Auf `max` Kacheln gekappt.
 *
 * Rein und deterministisch. Fehlt `lastActiveAt`, greift der stabile Id-Tiebreak.
 */
export function selectAutoPanes(
  sessions: GridSessionCandidate[],
  opts: { projectId: string | null; visibleFeatureIds: ReadonlySet<string>; max: number },
): string[] {
  if (opts.projectId === null || opts.max <= 0) return [];

  // Pro Feature den höchsten (= jüngsten) Aktivitätszeitpunkt festhalten.
  const bestByFeature = new Map<string, number>();
  for (const s of sessions) {
    if (s.projectId !== opts.projectId) continue;
    if (s.featureId === null || !opts.visibleFeatureIds.has(s.featureId)) continue;
    if (s.exited) continue;
    if (s.status !== 'working' && s.status !== 'awaiting_input') continue;

    const at = s.lastActiveAt ?? 0;
    const prev = bestByFeature.get(s.featureId);
    if (prev === undefined || at > prev) bestByFeature.set(s.featureId, at);
  }

  return [...bestByFeature.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, opts.max)
    .map(([featureId]) => featureId);
}
