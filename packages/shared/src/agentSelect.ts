import type { AgentDefinition, AgentFeatureDecision, AgentTrigger } from './types.js';

/**
 * Pure Auflösungslogik: welche Agents laufen für einen Trigger?
 * Regeln: (1) Trigger muss matchen (kind + ggf. phase), (2) ein Per-Feature-
 * 'exclude' schlägt alles, (3) ein 'include' erzwingt den Lauf auch bei
 * deaktiviertem Agent, (4) sonst entscheidet `enabled`.
 */
export function resolveAgentsForTrigger(
  agents: AgentDefinition[],
  selection: ReadonlyMap<string, AgentFeatureDecision>,
  trigger: AgentTrigger,
): AgentDefinition[] {
  return agents
    .filter((a) => triggerMatches(a.trigger, trigger))
    .filter((a) => {
      const decision = selection.get(a.id);
      if (decision === 'exclude') return false;
      if (decision === 'include') return true;
      return a.enabled;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function triggerMatches(configured: AgentTrigger, fired: AgentTrigger): boolean {
  if (configured.kind !== fired.kind) return false;
  if (fired.kind === 'after_phase' || fired.kind === 'before_phase') {
    return configured.phase === fired.phase;
  }
  return true;
}

// ---------- Bericht-Parser (Konvention: Markdown-Report des Agents) ----------

/**
 * Verdict aus dem Bericht; Fallback: Exit-Code (speckit-assistant-Muster).
 * Übernommen aus dem bisherigen reviewGateService.
 */
export function parseVerdict(reviewContent: string | null, exitCode: number): 'PASS' | 'FAIL' {
  if (reviewContent) {
    const m = reviewContent.match(/VERDICT:\s*(PASS|FAIL)/i);
    if (m?.[1]) return m[1].toUpperCase() as 'PASS' | 'FAIL';
  }
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

/** Wurde überhaupt ein auswertbares Urteil abgegeben? (Berichte ohne Urteil ⇒ nie PASS) */
export function hasExplicitVerdict(reviewContent: string | null): boolean {
  return !!reviewContent && /VERDICT:\s*(PASS|FAIL)/i.test(reviewContent);
}

/** Optionale `GESAMTENTSCHEIDUNG:`-Zeile, z. B. 'FREIGEGEBEN MIT ÄNDERUNGEN'. */
export function parseDecisionLabel(reviewContent: string | null): string | null {
  if (!reviewContent) return null;
  const m = reviewContent.match(/^GESAMTENTSCHEIDUNG:\s*(.+)$/im);
  return m?.[1]?.trim() || null;
}

/**
 * Kurzzusammenfassung: bevorzugt die `ZUSAMMENFASSUNG:`-Zeile, sonst der erste
 * inhaltliche Absatz (ohne Überschriften), gekappt auf 300 Zeichen.
 */
export function extractSummary(reviewContent: string | null): string | null {
  if (!reviewContent) return null;
  const explicit = reviewContent.match(/^ZUSAMMENFASSUNG:\s*(.+)$/im);
  if (explicit?.[1]?.trim()) return truncate(explicit[1].trim());

  for (const block of reviewContent.split(/\n\s*\n/)) {
    const text = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('#') && !/^VERDICT:/i.test(l.trim()))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return truncate(text);
  }
  return null;
}

function truncate(s: string): string {
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

/**
 * Explizit gemeldeter menschlicher Freigabebedarf: alle
 * `FREIGABE ERFORDERLICH: <thema>`-Zeilen (auch bei PASS relevant).
 */
export function parseApprovalItems(reviewContent: string | null): string[] {
  if (!reviewContent) return [];
  const items: string[] = [];
  for (const m of reviewContent.matchAll(/^\s*(?:[-*]\s*)?FREIGABE ERFORDERLICH:\s*(.+)$/gim)) {
    const topic = m[1]?.trim();
    if (topic) items.push(topic);
  }
  return items;
}
