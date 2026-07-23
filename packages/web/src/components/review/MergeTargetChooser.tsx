import { useEffect, useMemo, useState } from 'react';
import { isValidBranchName, suggestBranchName } from '@sdd/shared';
import type { BranchInfo } from '@sdd/shared';
import { api } from '../../api.js';

export interface MergeTarget {
  targetBranch: string;
  createBranch: boolean;
  valid: boolean;
}

/**
 * Integrations-Zielwahl (nur Human-in-the-loop): bestehender Branch (Vorauswahl
 * Default-Branch) ODER neuer Branch mit editierbarem Namensvorschlag und
 * Live-Validierung. Auto-Merge bleibt unberührt auf dem Default-Branch.
 */
export function MergeTargetChooser({
  projectId,
  featureName,
  featureBranch,
  defaultBranch,
  onChange,
  onError,
}: {
  projectId: string;
  featureName: string;
  featureBranch: string;
  defaultBranch: string;
  onChange: (target: MergeTarget) => void;
  onError: (e: Error) => void;
}) {
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [existing, setExisting] = useState(defaultBranch);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    api
      .branches(projectId)
      .then((all) => {
        setBranches(all);
        setNewName(suggestBranchName(featureName, all.map((b) => b.name)));
      })
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const validation = useMemo((): { valid: boolean; hint: string | null } => {
    if (mode === 'existing') return { valid: true, hint: null };
    const name = newName.trim();
    if (!name) return { valid: false, hint: 'Branch-Name fehlt' };
    if (!isValidBranchName(name)) return { valid: false, hint: 'Ungültiger Branch-Name (git check-ref-format)' };
    if (name === featureBranch) return { valid: false, hint: 'Ziel darf nicht der Feature-Branch selbst sein' };
    if (branches?.some((b) => b.name === name)) return { valid: false, hint: 'Branch existiert bereits' };
    return { valid: true, hint: null };
  }, [mode, newName, featureBranch, branches]);

  useEffect(() => {
    onChange(
      mode === 'existing'
        ? { targetBranch: existing, createBranch: false, valid: true }
        : { targetBranch: newName.trim(), createBranch: true, valid: validation.valid },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing, newName, validation.valid]);

  const selectable = (branches ?? []).filter((b) => b.name !== featureBranch && !b.isFeatureBranch);

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-zinc-500">Ziel:</span>
      <label className="flex items-center gap-1 text-zinc-300">
        <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
        Bestehend
      </label>
      {mode === 'existing' && (
        <select
          value={existing}
          onChange={(e) => setExisting(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
        >
          {selectable.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.isDefault ? ' (Default)' : ''}
            </option>
          ))}
          {!branches && <option>{defaultBranch}</option>}
        </select>
      )}
      <label className="flex items-center gap-1 text-zinc-300">
        <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
        Neuer Branch
      </label>
      {mode === 'new' && (
        <span className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            spellCheck={false}
            className={`w-64 rounded border bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 outline-none ${
              validation.valid ? 'border-zinc-700 focus:border-zinc-500' : 'border-red-800 focus:border-red-600'
            }`}
          />
          {validation.hint && <span className="text-red-400">{validation.hint}</span>}
        </span>
      )}
    </div>
  );
}
