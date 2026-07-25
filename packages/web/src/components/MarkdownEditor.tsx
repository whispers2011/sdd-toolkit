import { Component } from 'react';
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
import { MarkdownView } from './MarkdownView.js';

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
        <MarkdownView markdown={value} />
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
