import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Führendes YAML-Frontmatter (`---\n…\n---`) abtrennen. ReactMarkdown würde es
 * sonst als riesige Setext-H2 rendern (die vorletzte `---`-Zeile macht den Block
 * davor zur Überschrift) — schwer lesbarer Einstieg. Hier separat behandelt.
 */
export function splitFrontmatter(md: string): { meta: string | null; body: string } {
  const m = md.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { meta: null, body: md };
  return { meta: m[1] ?? '', body: md.slice(m[0].length) };
}

/** Frontmatter als kompakte, lesbare Metadaten-Liste (statt roher Textblock). */
function Frontmatter({ text }: { text: string }) {
  const rows = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      const m = line.trim().match(/^([^:]+):\s*(.*)$/);
      const key = (m?.[1] ?? line.trim()).trim();
      const value = (m?.[2] ?? '').trim().replace(/^["']|["']$/g, '');
      return { indent, key, value };
    });
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 rounded border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Metadaten</div>
      <dl className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-x-2 text-xs" style={{ paddingLeft: r.indent * 10 }}>
            <dt className="shrink-0 text-zinc-500">{r.key}</dt>
            {r.value && <dd className="min-w-0 text-zinc-300">{r.value}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Einheitliche Leseansicht für Markdown-Dokumente (Speckit-Artefakte, Schritt-Definitionen,
 * Agent-Berichte). Typografie kommt vollständig aus `.sdd-prose` — eine Quelle statt je
 * Dialog eigener Element-Klassen, die sich auseinanderentwickeln.
 */
export function MarkdownView({ markdown, className = '' }: { markdown: string; className?: string }) {
  const { meta, body } = splitFrontmatter(markdown);
  return (
    <div className={`sdd-prose max-w-none ${className}`}>
      {meta !== null && <Frontmatter text={meta} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
