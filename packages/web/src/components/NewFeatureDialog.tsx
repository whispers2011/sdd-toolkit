import { useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog, DialogActions } from './Sidebar.js';
import { VoiceButton } from './VoiceButton.js';

/**
 * Feature anlegen — genutzt von der Sidebar (leer) und vom Projekt-Chat
 * (vorbefüllt aus einem Feature-Vorschlag). Mit `onCreated` übernimmt der
 * Aufrufer die Navigation; ohne springt der Dialog zur Feature-Konsole.
 */
export function NewFeatureDialog({
  projectId,
  onClose,
  initialName,
  initialDescription,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  initialName?: string;
  initialDescription?: string;
  onCreated?: (featureId: string) => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const feature = await api.createFeature(projectId, name.trim(), description.trim() || undefined);
      dispatch({ type: 'feature_updated', feature });
      if (onCreated) onCreated(feature.id);
      else dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Neues Feature" onClose={onClose}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="feature-name"
        className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
      />
      <div className="relative">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beschreibung (optional) — startet direkt /speckit.specify mit diesem Text"
          rows={4}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 pr-10 text-sm text-zinc-200 outline-none focus:border-zinc-500"
        />
        <div className="absolute top-1.5 right-1.5">
          <VoiceButton onText={(t) => setDescription((cur) => cur + t)} />
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Legt Worktree + Branch an und öffnet die Feature-Konsole.
      </p>
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Anlegen" />
    </Dialog>
  );
}
