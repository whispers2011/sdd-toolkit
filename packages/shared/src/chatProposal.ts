/**
 * Marker-Protokoll für Feature-Vorschläge aus dem Projekt-Chat:
 * `<feature-vorschlag name="kebab-slug">Beschreibung</feature-vorschlag>`.
 * Der Marker wird aus dem Anzeigetext entfernt; nur der erste gültige zählt.
 */

export interface ProposalParseResult {
  cleanText: string;
  proposal: { name: string; description: string } | null;
}

const MARKER_RE = /<feature-vorschlag\s+name="([^"]*)"\s*>([\s\S]*?)<\/feature-vorschlag>/gi;

export function parseFeatureProposal(text: string): ProposalParseResult {
  let proposal: ProposalParseResult['proposal'] = null;

  const cleanText = text
    .replace(MARKER_RE, (_match, name: string, description: string) => {
      const n = name.trim();
      const d = description.trim();
      if (!proposal && n && d) proposal = { name: n, description: d };
      return '';
    })
    // Marker-Entfernung hinterlässt sonst Leerzeilen-Löcher.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanText, proposal };
}
