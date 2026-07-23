import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initialPhases } from '@sdd/shared';
import { openMemoryDatabase } from '../db/database.js';
import { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { JiraImportService } from './jiraImportService.js';

const SITE = { id: 'site-1', name: 'IWF', url: 'https://iwf.atlassian.net' };

function fullIssue(key: string, summary: string) {
  return {
    key,
    names: { customfield_10001: 'Akzeptanzkriterien', priority: 'Priorität', labels: 'Labels' },
    fields: {
      summary,
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Als Nutzer möchte ich…' }] }],
      },
      priority: { name: 'Hoch' },
      labels: ['backend', 'auth'],
      customfield_10001: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AK: Login klappt' }] }],
      },
      customfield_leer: null,
      comment: {
        comments: [
          {
            author: { displayName: 'Louis Michel' },
            created: '2026-07-20T09:30:00.000Z',
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bitte beachten.' }] }] },
          },
        ],
      },
      attachment: [
        { id: '900', filename: 'skizze.png', content: 'https://iwf.atlassian.net/rest/api/3/attachment/content/900' },
        { id: '901', filename: 'geheim.pdf', content: 'https://iwf.atlassian.net/rest/api/3/attachment/content/901' },
      ],
      issuelinks: [
        {
          type: { inward: 'wird blockiert von', outward: 'blockiert' },
          outwardIssue: { key: 'PROJ-99', fields: { summary: 'Anderes Ticket' } },
        },
      ],
    },
  };
}

function setup(opts: { issueError?: string } = {}) {
  const db = openMemoryDatabase();
  const projects = new ProjectRepo(db);
  const features = new FeatureRepo(db);
  const project = projects.create({
    name: 'P',
    path: '/repo',
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify', 'implement'],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
  });

  const worktreeRoot = mkdtempSync(join(tmpdir(), 'sdd-import-'));
  const startPhaseRun = vi.fn(() => Promise.resolve());
  const orchestrator = {
    createFeature: vi.fn((projectId: string, name: string) => {
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/[äöüß]/g, (c: string) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      if (features.getByName(projectId, slug)) return Promise.reject(new Error(`Feature '${slug}' existiert bereits`));
      const feature = features.create({
        projectId,
        name: slug,
        branch: `feature/${slug}`,
        worktreePath: worktreeRoot,
        phases: initialPhases(['specify', 'implement']),
        integration: 'none',
        automation: {},
        optimization: {},
        tasksDone: 0,
        tasksTotal: 0,
      });
      return Promise.resolve(feature);
    }),
    startPhaseRun,
  };

  const callTool = vi.fn((name: string, args: Record<string, unknown> = {}) => {
    if (name === 'getAccessibleAtlassianResources') return Promise.resolve([SITE]);
    if (name === 'getJiraIssueRemoteIssueLinks') {
      return Promise.resolve([{ object: { url: 'https://wiki/np', title: 'Konzept' } }]);
    }
    if (name === 'getJiraIssue') {
      const key = args.issueIdOrKey as string;
      if (opts.issueError && key === 'PROJ-404') return Promise.reject(new Error(opts.issueError));
      return Promise.resolve(fullIssue(key, key === 'PROJ-2' ? 'Zweites Ticket' : 'Login bauen'));
    }
    return Promise.reject(new Error(`Unerwarteter Tool-Call: ${name}`));
  });

  const fetched: string[] = [];
  const fetchAttachment = vi.fn((url: string) => {
    fetched.push(url);
    // Anhang 901 ist nirgends abrufbar (FR-018-Fallback).
    if (url.includes('901')) return Promise.resolve(null);
    return Promise.resolve(Buffer.from('png-bytes'));
  });

  const service = new JiraImportService({
    jira: { callTool, getAccessToken: () => 'at-1' },
    features,
    orchestrator,
    fetchAttachment,
  });

  return { service, project, features, orchestrator, startPhaseRun, worktreeRoot, callTool, fetched };
}

describe('JiraImportService.importIssues (US3)', () => {
  it('legt je Ticket genau ein Feature mit Referenz an und startet Specify (FR-011/012/016)', async () => {
    const { service, project, features, startPhaseRun, worktreeRoot } = setup();
    const results = await service.importIssues(project.id, 'site-1', ['PROJ-1']);

    expect(results).toEqual([{ issueKey: 'PROJ-1', status: 'created', featureId: expect.any(String) }]);
    const feature = features.get(results[0]!.featureId!)!;
    expect(feature.name).toBe('login-bauen');
    expect(feature.jiraRef).toMatchObject({ key: 'PROJ-1', url: 'https://iwf.atlassian.net/browse/PROJ-1' });
    expect(features.listJiraKeys(project.id)).toEqual(['PROJ-1']);

    // Specify startet mit Ticketmaterial + Dossier-Verweis (FR-016/FR-017).
    expect(startPhaseRun).toHaveBeenCalledWith(feature.id, 'specify', expect.stringContaining('PROJ-1'));
    const prompt = startPhaseRun.mock.calls[0]?.[2] as string;
    expect(prompt).toContain('Als Nutzer möchte ich…');
    expect(prompt).toContain('specs/login-bauen/jira/ticket.md');

    // Dossier liegt im Worktree (US4).
    const dossier = readFileSync(join(worktreeRoot, 'specs', 'login-bauen', 'jira', 'ticket.md'), 'utf8');
    expect(dossier).toContain('# PROJ-1: Login bauen');
    expect(dossier).toContain('Louis Michel');
    expect(dossier).toContain('| Priorität | Hoch |');
    expect(dossier).toContain('| Akzeptanzkriterien | AK: Login klappt |');
    expect(dossier).toContain('blockiert PROJ-99: Anderes Ticket');
    expect(dossier).toContain('[Konzept](https://wiki/np)');
    expect(dossier).not.toContain('customfield_leer');
  });

  it('übernimmt zugängliche Anhänge und vermerkt nicht abrufbare als Verweis (FR-018)', async () => {
    const { service, project, worktreeRoot } = setup();
    await service.importIssues(project.id, 'site-1', ['PROJ-1']);

    expect(existsSync(join(worktreeRoot, 'specs', 'login-bauen', 'jira', 'attachments', 'skizze.png'))).toBe(true);
    expect(existsSync(join(worktreeRoot, 'specs', 'login-bauen', 'jira', 'attachments', 'geheim.pdf'))).toBe(false);
    const dossier = readFileSync(join(worktreeRoot, 'specs', 'login-bauen', 'jira', 'ticket.md'), 'utf8');
    expect(dossier).toContain('`skizze.png` → attachments/skizze.png');
    expect(dossier).toContain('`geheim.pdf` — nicht abrufbar');
    expect(dossier).toContain('attachment/content/901');
  });

  it('überspringt bereits importierte Tickets ohne Bestätigung (FR-014)', async () => {
    const { service, project } = setup();
    await service.importIssues(project.id, 'site-1', ['PROJ-1']);
    const results = await service.importIssues(project.id, 'site-1', ['PROJ-1']);
    expect(results).toEqual([{ issueKey: 'PROJ-1', status: 'skipped_duplicate' }]);
  });

  it('bestätigter Re-Import erzeugt ein zweites Feature mit Ticketschlüssel-Suffix (FR-013/FR-014)', async () => {
    const { service, project, features } = setup();
    await service.importIssues(project.id, 'site-1', ['PROJ-1']);
    const results = await service.importIssues(project.id, 'site-1', ['PROJ-1'], ['PROJ-1']);
    expect(results[0]?.status).toBe('created');
    const all = features.listByProject(project.id);
    expect(all.map((f) => f.name).sort()).toEqual(['login-bauen', 'login-bauen-proj-1']);
  });

  it('Fehler eines Tickets stoppt die übrigen nicht (FR-015, Reihenfolge erhalten)', async () => {
    const { service, project } = setup({ issueError: 'Issue does not exist' });
    const results = await service.importIssues(project.id, 'site-1', ['PROJ-1', 'PROJ-404', 'PROJ-2']);
    expect(results.map((r) => r.status)).toEqual(['created', 'failed', 'created']);
    expect(results[1]).toMatchObject({ issueKey: 'PROJ-404', error: expect.stringContaining('does not exist') });
  });

  it('lädt Anhänge bevorzugt über die tokenfähige api.atlassian.com-Route', async () => {
    const { service, project, fetched } = setup();
    await service.importIssues(project.id, 'site-1', ['PROJ-1']);
    expect(fetched[0]).toBe('https://api.atlassian.com/ex/jira/site-1/rest/api/3/attachment/content/900');
  });
});
