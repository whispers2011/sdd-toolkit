import {
  extractSprintsFromIssues,
  mergeSprints,
  type JiraIssueSummary,
  type JiraProject,
  type JiraSite,
  type JiraSprint,
} from '@sdd/shared';
import { JiraAuthRequiredError, JiraUnreachableError } from './atlassianMcpClient.js';
import type { AtlassianMcpClient } from './atlassianMcpClient.js';

/** Obergrenzen gegen ausufernde Pagination (Sicherheitsnetz, keine fachliche Grenze). */
const MAX_PROJECT_PAGES = 20;
const MAX_SPRINT_PAGES = 3;
const MAX_ISSUES = 200;

/**
 * Browse-Sicht auf Jira über den Rovo MCP (US2): Sites → Projekte → Sprints →
 * Tickets. Sprints werden mangels Agile-Tools per JQL aggregiert (R4).
 */
export class JiraBrowseService {
  constructor(private jira: Pick<AtlassianMcpClient, 'callTool'>) {}

  /** Erreichbare Jira-Sites (FR-006). */
  async listSites(): Promise<JiraSite[]> {
    const raw = await this.jira.callTool('getAccessibleAtlassianResources');
    return asArray(raw)
      .map((r) => {
        const rec = asRecord(r);
        const url = str(rec.url);
        return { id: str(rec.id), name: str(rec.name) || url, url };
      })
      .filter((s) => s.id && s.url);
  }

  /** Für den Nutzer sichtbare Projekte einer Site, Pagination vollständig aufgelöst (FR-006). */
  async listProjects(siteId: string): Promise<JiraProject[]> {
    const projects: JiraProject[] = [];
    let startAt = 0;
    for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
      const raw = await this.jira.callTool('getVisibleJiraProjects', {
        cloudId: siteId,
        action: 'view',
        maxResults: 50,
        startAt,
        expandIssueTypes: false,
      });
      const rec = asRecord(raw);
      const values = asArray(rec.values ?? raw);
      for (const v of values) {
        const p = asRecord(v);
        const key = str(p.key);
        if (key) projects.push({ id: str(p.id), key, name: str(p.name) || key });
      }
      const isLast = rec.isLast === true || values.length === 0;
      const total = typeof rec.total === 'number' ? rec.total : null;
      startAt += values.length;
      if (isLast || (total !== null && startAt >= total)) break;
    }
    return projects;
  }

  /**
   * Aktive + zukünftige Sprints eines Projekts über alle Boards (FR-007):
   * JQL-Aggregation `sprint in openSprints()/futureSprints()`, Sprint-Feld der
   * Treffer auswerten, Dedupe per Sprint-ID. Projekte ohne Sprints → [] (FR-008).
   */
  async listSprints(siteId: string, projectKey: string): Promise<JiraSprint[]> {
    const collect = async (fn: 'openSprints()' | 'futureSprints()') => {
      const issues = await this.searchIssues(
        siteId,
        `project = "${escapeJql(projectKey)}" AND sprint in ${fn}`,
        ['*all'],
        MAX_SPRINT_PAGES,
      );
      return extractSprintsFromIssues(issues);
    };
    try {
      const [open, future] = await Promise.all([collect('openSprints()'), collect('futureSprints()')]);
      return mergeSprints([...open, ...future]);
    } catch (err) {
      // Auth-/Netzfehler durchreichen; JQL-Fehler (z. B. reines Kanban-Projekt
      // ohne Sprint-Feld) bedeuten schlicht: keine Sprints (FR-008).
      if (err instanceof JiraAuthRequiredError || err instanceof JiraUnreachableError) throw err;
      return [];
    }
  }

  /**
   * Tickets eines Sprints bzw. der Projekt-/Backlog-Ebene (FR-008): Schlüssel,
   * Titel, Typ, Status. `imported` ergänzt die Route projektbezogen (FR-010).
   */
  async listIssues(
    siteId: string,
    projectKey: string,
    sprintId?: number,
  ): Promise<Omit<JiraIssueSummary, 'imported'>[]> {
    const jql =
      sprintId !== undefined
        ? `project = "${escapeJql(projectKey)}" AND sprint = ${sprintId} ORDER BY created ASC`
        : `project = "${escapeJql(projectKey)}" ORDER BY updated DESC`;
    const issues = await this.searchIssues(siteId, jql, ['summary', 'issuetype', 'status'], 10);
    return issues.slice(0, MAX_ISSUES).map((i) => {
      const rec = asRecord(i);
      const fields = asRecord(rec.fields);
      return {
        key: str(rec.key),
        title: str(fields.summary),
        type: str(asRecord(fields.issuetype).name) || 'Vorgang',
        status: str(asRecord(fields.status).name) || 'Unbekannt',
      };
    });
  }

  /** JQL-Suche mit nextPageToken-Pagination (bis maxPages bzw. MAX_ISSUES). */
  private async searchIssues(
    siteId: string,
    jql: string,
    fields: string[],
    maxPages: number,
  ): Promise<unknown[]> {
    const issues: unknown[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const raw = await this.jira.callTool('searchJiraIssuesUsingJql', {
        cloudId: siteId,
        jql,
        fields,
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      const rec = asRecord(raw);
      const pageIssues = asArray(rec.issues ?? raw);
      issues.push(...pageIssues);
      nextPageToken = typeof rec.nextPageToken === 'string' ? rec.nextPageToken : undefined;
      if (!nextPageToken || pageIssues.length === 0 || issues.length >= MAX_ISSUES) break;
    }
    return issues;
  }
}

function escapeJql(value: string): string {
  return value.replaceAll('"', '\\"');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
