import { useMemo, useState } from 'react';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [], isFile: false };
  for (const file of files) {
    let node = root;
    const parts = file.split('/');
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], isFile: i === parts.length - 1 };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

/** Dateibaum des Feature-Arbeitsstands (git ls-files), lazy auf-/zuklappbar. */
export function FileTreePane({
  files,
  selected,
  onSelect,
}: {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <ul className="overflow-y-auto p-2 text-xs">
      {tree.map((node) => (
        <TreeRow key={node.path} node={node} depth={0} selected={selected} onSelect={onSelect} />
      ))}
      {files.length === 0 && <li className="px-2 py-4 text-zinc-600">Kein Worktree vorhanden.</li>}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <button
        onClick={() => (node.isFile ? onSelect(node.path) : setOpen((o) => !o))}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left ${
          selected === node.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span className="w-3 shrink-0 text-zinc-600">{node.isFile ? '' : open ? '▾' : '▸'}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && !node.isFile && (
        <ul>
          {node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
