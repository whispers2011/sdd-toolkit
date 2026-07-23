import type { JiraSprint } from './types.js';

/**
 * Sprint-Aggregation ohne Agile-API (R4): Der Rovo MCP liefert Sprints nur als
 * Feld an Tickets. Diese puren Helfer extrahieren Sprints aus JQL-Treffern und
 * führen sie über mehrere Boards zusammen (FR-007).
 */

/** Roh-Sprintwert, wie er im Ticket-Feld ankommt (Jira Cloud, Objektform). */
interface RawSprintObject {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

/**
 * Sprints aus den Feldern von JQL-Treffern extrahieren. Die Sprint-Feld-ID ist
 * instanzabhängig (customfield_NNNNN) — deshalb werden alle Felder nach
 * sprint-förmigen Werten durchsucht: Objekte mit id/name/state (Objektform)
 * oder das Greenhopper-Altformat als String.
 */
export function extractSprintsFromIssues(issues: unknown[]): JiraSprint[] {
  const found: JiraSprint[] = [];
  for (const issue of issues) {
    const fields = (issue as { fields?: Record<string, unknown> })?.fields;
    if (!fields) continue;
    for (const value of Object.values(fields)) {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        const sprint = toSprint(candidate);
        if (sprint) found.push(sprint);
      }
    }
  }
  return found;
}

function toSprint(value: unknown): JiraSprint | null {
  if (typeof value === 'string') return parseGreenhopperSprint(value);
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as RawSprintObject;
  if (typeof raw.id !== 'number' || typeof raw.name !== 'string' || typeof raw.state !== 'string') {
    return null;
  }
  const state = raw.state.toLowerCase();
  if (state !== 'active' && state !== 'future') return null;
  return {
    id: raw.id,
    name: raw.name,
    state,
    ...(typeof raw.startDate === 'string' ? { startDate: raw.startDate } : {}),
    ...(typeof raw.endDate === 'string' ? { endDate: raw.endDate } : {}),
  };
}

/** Altformat: "com.atlassian.greenhopper.service.sprint.Sprint@…[id=5,state=ACTIVE,name=Sprint 3,…]" */
function parseGreenhopperSprint(value: string): JiraSprint | null {
  if (!value.includes('com.atlassian.greenhopper')) return null;
  const inner = /\[(.*)\]/.exec(value)?.[1];
  if (!inner) return null;
  const attrs = new Map<string, string>();
  for (const pair of inner.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) attrs.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  const id = Number(attrs.get('id'));
  const name = attrs.get('name');
  const state = attrs.get('state')?.toLowerCase();
  if (!Number.isFinite(id) || !name || (state !== 'active' && state !== 'future')) return null;
  const startDate = attrs.get('startDate');
  const endDate = attrs.get('endDate');
  return {
    id,
    name,
    state,
    ...(startDate && startDate !== '<null>' ? { startDate } : {}),
    ...(endDate && endDate !== '<null>' ? { endDate } : {}),
  };
}

/**
 * Sprints mehrerer Boards zusammenführen (FR-007): Dedupe über Sprint-ID,
 * nur aktive + zukünftige, Sortierung aktiv vor zukünftig, dann Startdatum.
 */
export function mergeSprints(sprints: JiraSprint[]): JiraSprint[] {
  const byId = new Map<number, JiraSprint>();
  for (const sprint of sprints) {
    if (sprint.state !== 'active' && sprint.state !== 'future') continue;
    const existing = byId.get(sprint.id);
    // Vollständigere Fassung gewinnt (z. B. mit Startdatum).
    if (!existing || (!existing.startDate && sprint.startDate)) byId.set(sprint.id, sprint);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'active' ? -1 : 1;
    const aStart = a.startDate ?? '';
    const bStart = b.startDate ?? '';
    if (aStart !== bStart) {
      // Ohne Startdatum ans Ende der jeweiligen Gruppe.
      if (!aStart) return 1;
      if (!bStart) return -1;
      return aStart.localeCompare(bStart);
    }
    return a.id - b.id;
  });
}
