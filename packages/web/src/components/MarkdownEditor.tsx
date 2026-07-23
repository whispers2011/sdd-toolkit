import { Component } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useTheme } from '../theme.js';

/** Fallback-Rendering (kein WYSIWYG-Crash): gerendertes Markdown bzw. Klartext-Editor. */
const MD: Components = {
  h1: (p) => <h1 className="mt-4 mb-2 text-lg font-semibold text-zinc-100" {...p} />,
  h2: (p) => <h2 className="mt-4 mb-2 text-base font-semibold text-zinc-100" {...p} />,
  h3: (p) => <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-200" {...p} />,
  p: (p) => <p className="my-2 text-sm leading-relaxed text-zinc-300" {...p} />,
  ul: (p) => <ul className="my-2 ml-5 list-disc space-y-1 text-sm text-zinc-300" {...p} />,
  ol: (p) => <ol className="my-2 ml-5 list-decimal space-y-1 text-sm text-zinc-300" {...p} />,
  li: (p) => <li className="text-sm text-zinc-300" {...p} />,
  a: (p) => <a className="text-emerald-400 hover:underline" {...p} />,
  code: (p) => <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-zinc-200" {...p} />,
  pre: (p) => <pre className="my-2 overflow-x-auto rounded bg-zinc-800 p-3 text-xs text-zinc-200" {...p} />,
  table: (p) => <table className="my-2 w-full border-collapse text-xs text-zinc-300" {...p} />,
  th: (p) => <th className="border border-zinc-700 px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border border-zinc-700 px-2 py-1" {...p} />,
};

const CODE_LANGUAGES: Record<string, string> = {
  '': 'Text',
  text: 'Text',
  txt: 'Text',
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  py: 'Python',
  diff: 'Diff',
};

type Props = {
  /** Markdown-Quelle (roh); wird als Rich-Text dargestellt. */
  value: string;
  readOnly: boolean;
  onChange?: ((markdown: string) => void) | undefined;
};

function Wysiwyg({ value, readOnly, onChange }: Props) {
  // MDXEditor bringt eigene Styles mit und ist per Default hell (dunkle Schrift auf
  // hellem Grund). Im Dark-Mode fehlte die Umschaltung → dunkle Schrift auf dunklem
  // Modal-Grund. `dark-theme` aktiviert die Dark-Palette der Bibliothek; im Light-Mode
  // bleibt der helle Default. Beides ist damit lesbar.
  const dark = useTheme() === 'dark';
  return (
    <MDXEditor
      {...(dark ? { className: 'dark-theme' } : {})}
      markdown={value}
      readOnly={readOnly}
      onChange={(md) => onChange?.(md)}
      contentEditableClassName="sdd-prose"
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        tablePlugin(),
        frontmatterPlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
        codeMirrorPlugin({ codeBlockLanguages: CODE_LANGUAGES }),
        markdownShortcutPlugin(),
        ...(readOnly
          ? []
          : [
              toolbarPlugin({
                toolbarContents: () => (
                  <>
                    <UndoRedo />
                    <BoldItalicUnderlineToggles />
                    <ListsToggle />
                    <BlockTypeSelect />
                    <CreateLink />
                    <InsertTable />
                    <InsertThematicBreak />
                  </>
                ),
              }),
            ]),
      ]}
    />
  );
}

/**
 * WYSIWYG-Anzeige/-Editor für Speckit-Artefakte: zeigt Markdown als lesbaren Rich-Text
 * (kein Quelltext) und schreibt strukturerhaltend zurück. Bei Parse-Fehlern des WYSIWYG-Kerns
 * greift ein Fallback (gerenderte Ansicht bzw. Klartext-Editor), damit die App nie abstürzt.
 */
export class MarkdownEditor extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const { value, readOnly, onChange } = this.props;
    if (this.state.failed) {
      return readOnly ? (
        <div className="sdd-prose max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck={false}
          className="h-full min-h-[24rem] w-full resize-none rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
        />
      );
    }
    return <Wysiwyg value={value} readOnly={readOnly} onChange={onChange} />;
  }

  componentDidCatch(): void {
    /* Fehler bereits über getDerivedStateFromError behandelt. */
  }
}
