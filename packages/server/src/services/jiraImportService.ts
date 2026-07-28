import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTicketDossier,
  fieldValueToText,
  jiraContentToMarkdown,
  type Feature,
  type FeaturePhase,
  type JiraImportResult,
  type TicketComment,
  type TicketField,
} from '@sdd/shared';
import type { AtlassianMcpClient } from './atlassianMcpClient.js';
import { sanitizeFilename, uniqueFilename } from './safeFilename.js';
import { slugify } from './orchestrator.js';
import type { FeatureRepo } from '../db/repos.js';
import { bus } from '../events.js';

/** Felder, die gesondert behandelt werden und nicht in die Feld-Tabelle gehören. */
const HANDLED_FIELDS = new Set(['summary', 'description', 'comment', 'attachment', 'issuelinks']);

export interface JiraImportDeps {
  jira: Pick<AtlassianMcpClient, 'callTool' | 'getAccessToken'>;
  features: Pick<FeatureRepo, 'get' | 'getByName' | 'setJiraRef' | 'listJiraKeys'>;
  orchestrator: {
    createFeature(projectId: string, name: string, description?: string): Promise<Feature>;
    startPhaseRun(featureId: string, phase: FeaturePhase, extraPrompt?: string): Promise<{ gateRunning: boolean }>;
  };
  /** Download-Injektion für Tests; Default: authentifizierter fetch (FR-018). */
  fetchAttachment?: (url: string, token: string | null) => Promise<Buffer | null>;
}

/**
 * Ticket-Übernahme (US3/US4): je Ticket genau ein Feature über den normalen
 * Orchestrator-Weg (FR-016), vollständiges Dossier + Anhänge in den Worktree
 * (FR-017/FR-018), Ticket-Referenz persistiert (FR-012). Fehler einzelner
 * Tickets stoppen die übrigen nicht (FR-015).
 */
export class JiraImportService {
  constructor(private deps: JiraImportDeps) {}

  async importIssues(
    projectId: string,
    siteId: string,
    issueKeys: string[],
    confirmedReimports: string[] = [],
  ): Promise<JiraImportResult[]> {
    // Site-URL vorab auflösen: scheitert schon das, ist der Gesamtvorgang
    // unmöglich (401/503) — der Fehler propagiert zur Route.
    const siteUrl = await this.resolveSiteUrl(siteId);
    const importedKeys = new Set(this.deps.features.listJiraKeys(projectId));
    const confirmed = new Set(confirmedReimports);

    const results: JiraImportResult[] = [];
    for (const issueKey of issueKeys) {
      if (importedKeys.has(issueKey) && !confirmed.has(issueKey)) {
        results.push({ issueKey, status: 'skipped_duplicate' });
        continue;
      }
      try {
        results.push(await this.importOne(projectId, siteId, siteUrl, issueKey));
      } catch (err) {
        results.push({ issueKey, status: 'failed', error: (err as Error).message });
      }
    }
    return results;
  }

  private async importOne(
    projectId: string,
    siteId: string,
    siteUrl: string,
    issueKey: string,
  ): Promise<JiraImportResult> {
    const raw = await this.deps.jira.callTool('getJiraIssue', {
      cloudId: siteId,
      issueIdOrKey: issueKey,
      fields: ['*all'],
      expand: 'names',
      responseContentFormat: 'adf',
    });
    const issue = asRecord(raw);
    const fields = asRecord(issue.fields);
    const names = asRecord(issue.names);
    const title = str(fields.summary) || issueKey;
    const browseUrl = `${siteUrl.replace(/\/$/, '')}/browse/${issueKey}`;

    // Eindeutiger Name (FR-013): Kollision → Suffix aus Ticketschlüssel, dann Zähler.
    const name = this.uniqueName(projectId, title, issueKey);
    const slug = slugify(name);

    const description = jiraContentToMarkdown(fields.description);
    const comments = extractComments(fields.comment);
    const remoteLinks = await this.loadRemoteLinks(siteId, issueKey);
    const ticketFields = buildTicketFields(fields, names, remoteLinks);

    // Feature ohne Beschreibung anlegen (noch kein Specify-Start), damit das
    // Dossier VOR dem Agenten im Worktree liegt; dann regulär starten (FR-016).
    const feature = await this.deps.orchestrator.createFeature(projectId, name);
    const attachmentNotes = await this.writeTicketMaterial(feature, slug, {
      key: issueKey,
      url: browseUrl,
      title,
      description,
      comments,
      fields: ticketFields,
      attachments: extractAttachments(fields.attachment),
      siteId,
    });

    this.deps.features.setJiraRef(feature.id, { key: issueKey, url: browseUrl, importedAt: Date.now() });
    const fresh = this.deps.features.get(feature.id);
    if (fresh) bus.emitEvent('feature_updated', fresh);

    const prompt = buildSpecifyPrompt(issueKey, browseUrl, title, description, slug, attachmentNotes.length > 0);
    await this.deps.orchestrator.startPhaseRun(feature.id, 'specify', prompt);

    return { issueKey, status: 'created', featureId: feature.id };
  }

  /** Feature-Name eindeutig machen (FR-013/FR-014: Re-Import → weiteres Feature). */
  private uniqueName(projectId: string, title: string, issueKey: string): string {
    const candidates = [title, `${title} ${issueKey}`];
    for (let i = 2; i <= 20; i++) candidates.push(`${title} ${issueKey} ${i}`);
    for (const candidate of candidates) {
      const slug = slugify(candidate);
      if (slug && !this.deps.features.getByName(projectId, slug)) return candidate;
    }
    throw new Error(`Kein eindeutiger Feature-Name für ${issueKey} ableitbar`);
  }

  private async resolveSiteUrl(siteId: string): Promise<string> {
    const resources = await this.deps.jira.callTool('getAccessibleAtlassianResources');
    for (const r of Array.isArray(resources) ? resources : []) {
      const rec = asRecord(r);
      if (rec.id === siteId && typeof rec.url === 'string') return rec.url;
    }
    // cloudId darf laut Tool-Contract auch der Hostname sein.
    return siteId.includes('.') ? `https://${siteId}` : `https://${siteId}.atlassian.net`;
  }

  private async loadRemoteLinks(siteId: string, issueKey: string): Promise<string[]> {
    try {
      const raw = await this.deps.jira.callTool('getJiraIssueRemoteIssueLinks', {
        cloudId: siteId,
        issueIdOrKey: issueKey,
      });
      return (Array.isArray(raw) ? raw : [])
        .map((l) => {
          const obj = asRecord(asRecord(l).object);
          const url = str(obj.url);
          const label = str(obj.title) || url;
          return url ? `[${label}](${url})` : '';
        })
        .filter(Boolean);
    } catch {
      // Remote-Links sind Zusatzkontext — ihr Fehlen bricht die Übernahme nicht.
      return [];
    }
  }

  /**
   * Dossier + Anhänge in den Feature-Worktree schreiben (US4). Liefert die
   * Anhangs-Notizen (lokal übernommen bzw. Verweis auf nicht abrufbare, FR-018).
   */
  private async writeTicketMaterial(
    feature: Feature,
    slug: string,
    ticket: {
      key: string;
      url: string;
      title: string;
      description: string;
      comments: TicketComment[];
      fields: TicketField[];
      attachments: RawAttachment[];
      siteId: string;
    },
  ): Promise<string[]> {
    if (!feature.worktreePath) throw new Error('Feature hat keinen Worktree — Dossier nicht ablegbar');
    const jiraDir = join(feature.worktreePath, 'specs', slug, 'jira');
    mkdirSync(jiraDir, { recursive: true });

    const attachmentNotes: string[] = [];
    if (ticket.attachments.length > 0) {
      const attachmentsDir = join(jiraDir, 'attachments');
      mkdirSync(attachmentsDir, { recursive: true });
      const token = this.deps.jira.getAccessToken();
      const fetchAttachment = this.deps.fetchAttachment ?? defaultFetchAttachment;
      const usedNames = new Set<string>();
      for (const attachment of ticket.attachments) {
        const filename = uniqueFilename(sanitizeFilename(attachment.filename, 'anhang'), usedNames);
        // Erst die tokenfähige api.atlassian.com-Route, dann die Original-URL (FR-018).
        const urls = [
          ...(attachment.id
            ? [`https://api.atlassian.com/ex/jira/${ticket.siteId}/rest/api/3/attachment/content/${attachment.id}`]
            : []),
          ...(attachment.content ? [attachment.content] : []),
        ];
        let data: Buffer | null = null;
        for (const url of urls) {
          data = await fetchAttachment(url, token);
          if (data) break;
        }
        if (data) {
          writeFileSync(join(attachmentsDir, filename), data);
          attachmentNotes.push(`\`${attachment.filename}\` → attachments/${filename}`);
        } else {
          const source = attachment.content || ticket.url;
          attachmentNotes.push(`\`${attachment.filename}\` — nicht abrufbar, Quelle: ${source}`);
        }
      }
    }

    const dossier = buildTicketDossier(
      { key: ticket.key, url: ticket.url, title: ticket.title, description: ticket.description },
      ticket.comments,
      ticket.fields,
      attachmentNotes,
    );
    writeFileSync(join(jiraDir, 'ticket.md'), dossier);
    return attachmentNotes;
  }
}

// ---------- pure Helfer ----------

interface RawAttachment {
  id: string;
  filename: string;
  content: string;
}

function buildSpecifyPrompt(
  key: string,
  url: string,
  title: string,
  description: string,
  slug: string,
  hasAttachments: boolean,
): string {
  const lines = [
    `Jira-Ticket ${key} (${url}): ${title}`,
    '',
    description || '*(Ticket ohne Beschreibung)*',
    '',
    `Vollständiger Ticketkontext (alle Felder, Kommentare${hasAttachments ? ', Anhänge unter specs/' + slug + '/jira/attachments/' : ''}) liegt als Dossier in specs/${slug}/jira/ticket.md — dieses Material als Ausgangsbasis der Spezifikation verwenden.`,
  ];
  return lines.join('\n');
}

function extractComments(commentField: unknown): TicketComment[] {
  const comments = asRecord(commentField).comments;
  return (Array.isArray(comments) ? comments : []).map((c) => {
    const rec = asRecord(c);
    const author = asRecord(rec.author);
    return {
      author: str(author.displayName) || str(author.name) || 'Unbekannt',
      ...(typeof rec.created === 'string' ? { createdAt: rec.created } : {}),
      body: jiraContentToMarkdown(rec.body),
    };
  });
}

function extractAttachments(attachmentField: unknown): RawAttachment[] {
  return (Array.isArray(attachmentField) ? attachmentField : [])
    .map((a) => {
      const rec = asRecord(a);
      return {
        id: rec.id === undefined ? '' : String(rec.id),
        filename: str(rec.filename) || 'anhang',
        content: str(rec.content),
      };
    })
    .filter((a) => a.id || a.content);
}

/** Alle ausgefüllten Felder (Standard + Custom) lesbar machen (FR-017). */
function buildTicketFields(
  fields: Record<string, unknown>,
  names: Record<string, unknown>,
  remoteLinks: string[],
): TicketField[] {
  const result: TicketField[] = [];
  for (const [fieldId, value] of Object.entries(fields)) {
    if (HANDLED_FIELDS.has(fieldId)) continue;
    const text = fieldValueToText(value);
    if (text === null) continue;
    result.push({ name: str(names[fieldId]) || fieldId, value: text });
  }
  result.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Verknüpfte Tickets gesondert und lesbar (FR-017).
  const linked = (Array.isArray(fields.issuelinks) ? fields.issuelinks : [])
    .map((l) => {
      const rec = asRecord(l);
      const type = asRecord(rec.type);
      const inward = asRecord(rec.inwardIssue);
      const outward = asRecord(rec.outwardIssue);
      const target = inward.key ? inward : outward;
      const relation = inward.key ? str(type.inward) : str(type.outward);
      const summary = str(asRecord(target.fields).summary);
      return target.key ? `${relation || 'verknüpft mit'} ${str(target.key)}${summary ? `: ${summary}` : ''}` : '';
    })
    .filter(Boolean);
  if (linked.length > 0) result.push({ name: 'Verknüpfte Tickets', value: linked.join('; ') });
  if (remoteLinks.length > 0) result.push({ name: 'Externe Links', value: remoteLinks.join('; ') });
  return result;
}

async function defaultFetchAttachment(url: string, token: string | null): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
