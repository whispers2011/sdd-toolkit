import { describe, expect, it, vi } from 'vitest';
import { JiraBrowseService } from './jiraBrowseService.js';
import { JiraAuthRequiredError } from './atlassianMcpClient.js';

/** Gemockter MCP-Client: Antworten je Tool-Name (Funktion oder Wert). */
function mockJira(handlers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const callTool = vi.fn((name: string, args: Record<string, unknown> = {}) => {
    const h = handlers[name];
    if (h === undefined) return Promise.reject(new Error(`Unerwarteter Tool-Call: ${name}`));
    const value = typeof h === 'function' ? (h as (a: Record<string, unknown>) => unknown)(args) : h;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
  return { callTool };
}

const sprintIssue = (sprints: unknown[]) => ({ fields: { customfield_10020: sprints } });

describe('JiraBrowseService.listSites', () => {
  it('mappt erreichbare Ressourcen auf JiraSite', async () => {
    const svc = new JiraBrowseService(
      mockJira({
        getAccessibleAtlassianResources: [
          { id: 'site-1', name: 'Example', url: 'https://example.atlassian.net', scopes: [] },
          { id: '', url: 'https://kaputt' },
        ],
      }),
    );
    expect(await svc.listSites()).toEqual([{ id: 'site-1', name: 'Example', url: 'https://example.atlassian.net' }]);
  });
});

describe('JiraBrowseService.listProjects (FR-006)', () => {
  it('löst die Pagination vollständig auf', async () => {
    const pages = [
      { values: Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, key: `P${i}`, name: `Projekt ${i}` })), total: 60, isLast: false },
      { values: Array.from({ length: 10 }, (_, i) => ({ id: `${50 + i}`, key: `P${50 + i}`, name: `Projekt ${50 + i}` })), total: 60, isLast: true },
    ];
    const jira = mockJira({
      getVisibleJiraProjects: (args) => pages[(args.startAt as number) === 0 ? 0 : 1],
    });
    const svc = new JiraBrowseService(jira);
    const projects = await svc.listProjects('site-1');
    expect(projects).toHaveLength(60);
    expect(projects[0]).toEqual({ id: '0', key: 'P0', name: 'Projekt 0' });
    expect(jira.callTool).toHaveBeenCalledWith(
      'getVisibleJiraProjects',
      expect.objectContaining({ cloudId: 'site-1', action: 'view' }),
    );
  });
});

describe('JiraBrowseService.listSprints (FR-007/R4)', () => {
  it('aggregiert Sprints aus open+future JQL und dedupliziert über Boards', async () => {
    const jira = mockJira({
      searchJiraIssuesUsingJql: (args) => {
        const jql = args.jql as string;
        if (jql.includes('openSprints()')) {
          return {
            issues: [
              sprintIssue([{ id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-07-20' }]),
              // Zweites Board, gleicher Sprint → Dedupe.
              sprintIssue([{ id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-07-20' }]),
            ],
          };
        }
        return { issues: [sprintIssue([{ id: 6, name: 'Sprint 6', state: 'future', startDate: '2026-08-01' }])] };
      },
    });
    const svc = new JiraBrowseService(jira);
    const sprints = await svc.listSprints('site-1', 'PROJ');
    expect(sprints.map((s) => s.id)).toEqual([5, 6]);
    expect(sprints[0]?.state).toBe('active');
  });

  it('Projekt ohne Sprint-Feld (JQL-Fehler) → leere Liste statt Fehler (FR-008)', async () => {
    const svc = new JiraBrowseService(
      mockJira({ searchJiraIssuesUsingJql: new Error(`Field 'sprint' does not exist`) }),
    );
    expect(await svc.listSprints('site-1', 'KANBAN')).toEqual([]);
  });

  it('Auth-Fehler werden NICHT verschluckt', async () => {
    const svc = new JiraBrowseService(
      mockJira({ searchJiraIssuesUsingJql: new JiraAuthRequiredError('abgelaufen', 'reauth_required') }),
    );
    await expect(svc.listSprints('site-1', 'PROJ')).rejects.toBeInstanceOf(JiraAuthRequiredError);
  });
});

describe('JiraBrowseService.listIssues (FR-008)', () => {
  const issue = (key: string, summary: string) => ({
    key,
    fields: { summary, issuetype: { name: 'Story' }, status: { name: 'To Do' } },
  });

  it('liefert Tickets eines Sprints mit Key, Titel, Typ, Status', async () => {
    const jira = mockJira({ searchJiraIssuesUsingJql: { issues: [issue('P-1', 'Login bauen')] } });
    const svc = new JiraBrowseService(jira);
    const issues = await svc.listIssues('site-1', 'PROJ', 42);
    expect(issues).toEqual([{ key: 'P-1', title: 'Login bauen', type: 'Story', status: 'To Do' }]);
    expect(jira.callTool).toHaveBeenCalledWith(
      'searchJiraIssuesUsingJql',
      expect.objectContaining({ jql: expect.stringContaining('sprint = 42') }),
    );
  });

  it('ohne sprintId → Projekt-/Backlog-Sicht', async () => {
    const jira = mockJira({ searchJiraIssuesUsingJql: { issues: [] } });
    const svc = new JiraBrowseService(jira);
    await svc.listIssues('site-1', 'PROJ');
    const jql = (jira.callTool.mock.calls[0]?.[1] as { jql: string }).jql;
    expect(jql).not.toContain('sprint');
    expect(jql).toContain('project = "PROJ"');
  });

  it('leerer Sprint → leere Liste (kein Fehler, US2-Szenario 6)', async () => {
    const svc = new JiraBrowseService(mockJira({ searchJiraIssuesUsingJql: { issues: [] } }));
    expect(await svc.listIssues('site-1', 'PROJ', 42)).toEqual([]);
  });

  it('folgt nextPageToken über mehrere Seiten', async () => {
    let calls = 0;
    const jira = mockJira({
      searchJiraIssuesUsingJql: () => {
        calls++;
        return calls === 1
          ? { issues: [issue('P-1', 'a')], nextPageToken: 'tok' }
          : { issues: [issue('P-2', 'b')] };
      },
    });
    const svc = new JiraBrowseService(jira);
    const issues = await svc.listIssues('site-1', 'PROJ');
    expect(issues.map((i) => i.key)).toEqual(['P-1', 'P-2']);
    expect(calls).toBe(2);
  });
});
