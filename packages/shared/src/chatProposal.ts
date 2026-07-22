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

/** Ein aus der Arbeits-Session vorgeschlagenes Feature. */
export interface ProposedFeature {
  name: string;
  description: string;
}

/** Offener Feature-Vorschlag einer Session (Bestätigungskarte im Chat-Panel). */
export interface ChatFeatureProposal {
  id: string;
  features: ProposedFeature[];
}

/**
 * Marker, mit dem eine Arbeits-Chat-Session ein oder mehrere Features vorschlägt:
 * `<sdd:features>[{"name":"kebab-name","description":"…"}]</sdd:features>`.
 * Das Toolkit zeigt daraufhin eine Bestätigungskarte. Nur der erste gültige Marker zählt.
 */
const FEATURES_MARKER_RE = /<sdd:features>([\s\S]*?)<\/sdd:features>/i;

export function parseSessionFeatures(text: string): ProposedFeature[] | null {
  const m = FEATURES_MARKER_RE.exec(text);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]!.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: ProposedFeature[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const description = typeof o.description === 'string' ? o.description.trim() : '';
    if (name && description) out.push({ name, description });
  }
  return out.length > 0 ? out : null;
}
