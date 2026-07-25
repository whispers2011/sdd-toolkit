/**
 * Jira-Inhalte → lesbares Markdown (FR-019): ADF (Atlassian Document Format)
 * und Wiki-Markup-Altformat, plus Dossier-Rendering für die Ticket-Übernahme
 * (FR-017). Pure Funktionen, vollständig testbar.
 */

// ---------- ADF ----------

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Beliebigen Jira-Inhaltswert (ADF-Objekt, Wiki-Markup-String, Rohtext) nach Markdown. */
export function jiraContentToMarkdown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return wikiMarkupToMarkdown(value).trim();
  if (typeof value === 'object' && (value as AdfNode).type === 'doc') {
    return adfToMarkdown(value as AdfNode).trim();
  }
  if (typeof value === 'object') {
    // Unbekannte Struktur: lesbare Kurzform statt rohem JSON-Dump, wo möglich.
    const text = fieldValueToText(value);
    return text ?? '';
  }
  return String(value);
}

/** ADF-Dokument nach Markdown. */
export function adfToMarkdown(doc: AdfNode): string {
  return renderBlocks(doc.content ?? []).replace(/\n{3,}/g, '\n\n');
}

function renderBlocks(nodes: AdfNode[], indent = ''): string {
  return nodes
    .map((n) => renderBlock(n, indent))
    .filter((s) => s !== null)
    .join('\n\n');
}

function renderBlock(node: AdfNode, indent: string): string | null {
  switch (node.type) {
    case 'paragraph':
      return indent + renderInline(node.content ?? []);
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${'#'.repeat(level)} ${renderInline(node.content ?? [])}`;
    }
    case 'bulletList':
      return (node.content ?? [])
        .map((li) => renderListItem(li, `${indent}- `, indent + '  '))
        .join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map((li, i) => renderListItem(li, `${indent}${i + 1}. `, indent + '   '))
        .join('\n');
    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.state === 'DONE' ? 'x' : ' ';
          return `${indent}- [${checked}] ${renderInline(item.content?.[0]?.content ?? item.content ?? [])}`;
        })
        .join('\n');
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const code = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case 'blockquote':
      return renderBlocks(node.content ?? [])
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'panel': {
      const kind = typeof node.attrs?.panelType === 'string' ? node.attrs.panelType : 'info';
      return renderBlocks(node.content ?? [])
        .split('\n')
        .map((l, i) => (i === 0 ? `> **${kind}:** ${l}` : `> ${l}`))
        .join('\n');
    }
    case 'rule':
      return '---';
    case 'table':
      return renderTable(node);
    case 'mediaGroup':
    case 'mediaSingle':
      return (node.content ?? [])
        .map((m) => {
          const name = m.attrs?.alt ?? m.attrs?.id ?? 'Anhang';
          return `${indent}📎 ${String(name)}`;
        })
        .join('\n');
    case 'expand':
      return [
        `**${String(node.attrs?.title ?? 'Details')}**`,
        renderBlocks(node.content ?? []),
      ].join('\n\n');
    default:
      // Unbekannter Block: Inhalt bestmöglich erhalten statt verlieren.
      if (node.content) return renderBlocks(node.content, indent) || null;
      if (node.text) return indent + node.text;
      return null;
  }
}

function renderListItem(li: AdfNode, marker: string, indent: string): string {
  const blocks = li.content ?? [];
  const parts: string[] = [];
  for (const [i, block] of blocks.entries()) {
    const rendered = renderBlock(block, i === 0 ? '' : indent) ?? '';
    parts.push(i === 0 ? marker + rendered : rendered);
  }
  return parts.join('\n');
}

function renderTable(table: AdfNode): string {
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow');
  if (rows.length === 0) return '';
  const cells = (row: AdfNode): string[] =>
    (row.content ?? []).map((c) => renderBlocks(c.content ?? []).replaceAll('\n', ' ').replaceAll('|', '\\|').trim());
  const header = cells(rows[0]!);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${cells(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map(renderInlineNode).join('');
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks ?? []);
    case 'mention':
      // Erwähnungen als Klarnamen (FR-019); attrs.text ist z. B. "@Ada Lovelace".
      return String(node.attrs?.text ?? node.attrs?.displayName ?? '').replace(/^@/, '') || 'Unbekannt';
    case 'emoji':
      return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
    case 'hardBreak':
      return '\n';
    case 'inlineCard':
    case 'blockCard':
      return String(node.attrs?.url ?? '');
    case 'date': {
      const ts = Number(node.attrs?.timestamp);
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
    }
    case 'status':
      return `[${String(node.attrs?.text ?? '')}]`;
    default:
      if (node.content) return renderInline(node.content);
      return node.text ?? '';
  }
}

function applyMarks(text: string, marks: { type: string; attrs?: Record<string, unknown> }[]): string {
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        out = `**${out}**`;
        break;
      case 'em':
        out = `*${out}*`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'link':
        out = `[${out}](${String(mark.attrs?.href ?? '')})`;
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------- Wiki-Markup (Altformat) ----------

/** Jira-Wiki-Markup nach Markdown (häufige Konstrukte; Rest bleibt Klartext). */
export function wikiMarkupToMarkdown(text: string): string {
  let out = text.replace(/\r\n/g, '\n');

  // Codeblöcke zuerst schützen: {code:java}…{code} / {noformat}…{noformat}
  out = out.replace(/\{code(?::([^}]*))?\}\n?([\s\S]*?)\{code\}/g, (_m, lang: string | undefined, body: string) => {
    return `\`\`\`${(lang ?? '').split(/[|:]/)[0] ?? ''}\n${body.replace(/\n$/, '')}\n\`\`\``;
  });
  out = out.replace(/\{noformat\}\n?([\s\S]*?)\{noformat\}/g, (_m, body: string) => `\`\`\`\n${body.replace(/\n$/, '')}\n\`\`\``);
  out = out.replace(/\{quote\}\n?([\s\S]*?)\{quote\}/g, (_m, body: string) =>
    body
      .trim()
      .split('\n')
      .map((l: string) => `> ${l}`)
      .join('\n'),
  );

  // Listen VOR den Überschriften: Wiki-'#'-Marker kollidieren sonst mit
  // frisch erzeugten '#'-Markdown-Überschriften.
  out = out.replace(/^\*{2}\s+/gm, '  - ');
  out = out.replace(/^#{2}\s+/gm, '   1. ');
  out = out.replace(/^\*\s+/gm, '- ');
  out = out.replace(/^#\s+/gm, '1. ');

  // Überschriften: h1. … h6.
  out = out.replace(/^h([1-6])\.\s*/gm, (_m, level: string) => `${'#'.repeat(Number(level))} `);

  // Links: [Text|http://…] bzw. [http://…]
  out = out.replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_m, label: string, href: string) => `[${label}](${href.split('|')[0]})`);
  out = out.replace(/\[(https?:\/\/[^\]]+)\]/g, '$1');

  // Erwähnungen: [~accountid:…] → Klarname unbekannt → neutraler Platzhalter; [~name] → name
  out = out.replace(/\[~accountid:[^\]]+\]/g, 'Erwähnung');
  out = out.replace(/\[~([^\]]+)\]/g, '$1');

  // Inline-Auszeichnung (konservativ, nur innerhalb einer Zeile).
  out = out.replace(/\{\{([^}]+)\}\}/g, '`$1`');
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?)]|$)/g, '$1**$2**');
  out = out.replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:!?)]|$)/g, '$1*$2*');
  out = out.replace(/(^|\s)-([^-\n]{2,})-(?=\s|[.,;:!?)]|$)/g, '$1~~$2~~');

  // Farbe/Anker u. ä. entfernen, Inhalt behalten.
  out = out.replace(/\{color(?::[^}]*)?\}([\s\S]*?)\{color\}/g, '$1');
  out = out.replace(/\{anchor:[^}]*\}/g, '');

  return out;
}

// ---------- Feld-Rendering & Dossier (FR-017) ----------

export interface TicketComment {
  author: string;
  /** ISO-Zeitpunkt der Erstellung (leer, wenn unbekannt). */
  createdAt?: string;
  /** Bereits nach Markdown konvertierter Kommentartext. */
  body: string;
}

export interface TicketField {
  name: string;
  value: string;
}

/**
 * Beliebigen Jira-Feldwert in lesbaren Text überführen; `null` = leer/nicht
 * darstellbar → Feld wird ausgelassen (FR-017: nur ausgefüllte Felder).
 */
export function fieldValueToText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? wikiMarkupToMarkdown(trimmed) : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(fieldValueToText).filter((v): v is string => v !== null);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.type === 'doc') {
      const md = adfToMarkdown(obj as AdfNode).trim();
      return md || null;
    }
    for (const key of ['displayName', 'name', 'value', 'text', 'summary', 'key', 'emailAddress']) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim()) return obj[key] as string;
    }
    return null;
  }
  return null;
}

/** Kommentar mit Autor + Zeitpunkt als Markdown-Abschnitt (FR-017/US4-Szenario 1). */
export function formatComment(comment: TicketComment): string {
  const when = comment.createdAt ? ` — ${formatTimestamp(comment.createdAt)}` : '';
  return `### ${comment.author}${when}\n\n${comment.body.trim() || '*(leer)*'}`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * Vollständiges Ticket-Dossier als Markdown (FR-017–FR-019): Titel, Beschreibung,
 * alle ausgefüllten Felder, sämtliche Kommentare (Autor + Zeitpunkt) und die
 * Anhangsliste (lokal übernommene wie nicht abrufbare Verweise).
 */
export function buildTicketDossier(
  issue: { key: string; url: string; title: string; description?: string },
  comments: TicketComment[],
  fields: TicketField[],
  attachmentNotes: string[],
): string {
  const sections: string[] = [];
  sections.push(`# ${issue.key}: ${issue.title}`);
  sections.push(`Quelle: [${issue.key}](${issue.url}) — Schnappschuss der Übernahme, keine Synchronisation.`);

  if (issue.description?.trim()) {
    sections.push(`## Beschreibung\n\n${issue.description.trim()}`);
  }

  const filled = fields.filter((f) => f.value.trim());
  if (filled.length > 0) {
    const rows = filled.map((f) => {
      const value = f.value.includes('\n') ? f.value.replaceAll('\n', ' ') : f.value;
      return `| ${f.name.replaceAll('|', '\\|')} | ${value.replaceAll('|', '\\|')} |`;
    });
    sections.push(`## Felder\n\n| Feld | Wert |\n| --- | --- |\n${rows.join('\n')}`);
  }

  if (comments.length > 0) {
    sections.push(`## Kommentare (${comments.length})\n\n${comments.map(formatComment).join('\n\n')}`);
  }

  if (attachmentNotes.length > 0) {
    sections.push(`## Anhänge\n\n${attachmentNotes.map((n) => `- ${n}`).join('\n')}`);
  }

  return sections.join('\n\n') + '\n';
}
