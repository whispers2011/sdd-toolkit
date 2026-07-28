import { useRef, useState } from 'react';
import {
  MAX_DOCUMENTS_PER_FEATURE,
  MAX_DOCUMENT_BYTES,
  formatBytes,
  reasonEmpty,
  reasonTooLarge,
  reasonTooMany,
} from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog, DialogActions, FeatureSourceToggle } from './Sidebar.js';
import { VoiceButton } from './VoiceButton.js';

/**
 * Feature anlegen — genutzt von der Sidebar (leer) und vom Projekt-Chat
 * (vorbefüllt aus einem Feature-Vorschlag). Mit `onCreated` übernimmt der
 * Aufrufer die Navigation; ohne springt der Dialog zur Feature-Konsole.
 *
 * Dokumente sind optional: ohne ausgewählte Datei läuft der bisherige
 * JSON-Weg unverändert weiter (FR-017, SC-006).
 */
export function NewFeatureDialog({
  projectId,
  onClose,
  initialName,
  initialDescription,
  onCreated,
  onSwitchToJira,
}: {
  projectId: string;
  onClose: () => void;
  initialName?: string;
  initialDescription?: string;
  onCreated?: (featureId: string) => void;
  /** Wenn gesetzt (Jira verbunden): Umschalter auf den Jira-Import anzeigen. */
  onSwitchToJira?: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Auswahl gegen dieselben Grenzen prüfen, die der Server durchsetzt (FR-011, FR-018). */
  const addFiles = (incoming: File[]) => {
    const next = [...files];
    const abgelehnt: string[] = [];
    for (const file of incoming) {
      if (next.length >= MAX_DOCUMENTS_PER_FEATURE) abgelehnt.push(reasonTooMany(file.name));
      else if (file.size === 0) abgelehnt.push(reasonEmpty(file.name));
      else if (file.size > MAX_DOCUMENT_BYTES) abgelehnt.push(reasonTooLarge(file.name, file.size));
      else next.push(file);
    }
    setFiles(next);
    // Abgelehnte benennen, die übrige Auswahl bleibt bestehen (FR-011, SC-005).
    if (abgelehnt.length > 0) dispatch({ type: 'error', message: abgelehnt.join('\n') });
  };

  const removeFile = (index: number) => setFiles((current) => current.filter((_, i) => i !== index));

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const beschreibung = description.trim() || undefined;
      if (files.length === 0) {
        // Unveränderter Weg ohne Dokumente (FR-017).
        const feature = await api.createFeature(projectId, name.trim(), beschreibung);
        dispatch({ type: 'feature_updated', feature });
        if (onCreated) onCreated(feature.id);
        else dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } });
        onClose();
        return;
      }

      const result = await api.createFeatureWithDocuments(projectId, name.trim(), beschreibung, files);
      dispatch({ type: 'feature_updated', feature: result.feature });
      // Nicht übernommene Dokumente melden — das Feature ist trotzdem angelegt (FR-014).
      if (result.rejected.length > 0) {
        dispatch({ type: 'error', message: result.rejected.map((r) => r.reason).join('\n') });
      }
      if (onCreated) onCreated(result.feature.id);
      else dispatch({ type: 'set_view', view: { kind: 'console', featureId: result.feature.id } });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Neues Feature" onClose={onClose}>
      {onSwitchToJira && <FeatureSourceToggle mode="manual" onJira={onSwitchToJira} onManual={() => {}} />}
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

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mt-2 rounded border border-dashed px-3 py-3 text-center text-xs ${
          dragging ? 'border-emerald-600 bg-emerald-950/30 text-emerald-300' : 'border-zinc-700 text-zinc-500'
        }`}
      >
        <p>
          Dokumente hierher ziehen oder{' '}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
          >
            auswählen
          </button>
        </p>
        {/* Grenzen sichtbar, bevor eine Datei gewählt wird (FR-018). */}
        <p className="mt-1 text-zinc-600">
          bis {MAX_DOCUMENT_BYTES / (1024 * 1024)} MB je Datei, höchstens {MAX_DOCUMENTS_PER_FEATURE} Dokumente
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = ''; // dieselbe Datei erneut wählbar halten
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300"
            >
              <span className="truncate" title={file.name}>
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-zinc-500">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  title="Aus der Auswahl entfernen"
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-xs text-zinc-600">
        Legt Worktree + Branch an und öffnet die Feature-Konsole.
      </p>
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Anlegen" />
    </Dialog>
  );
}
