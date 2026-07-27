import { useEffect, useState } from 'react';
import { formatBytes, type FeatureDocument } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';

/**
 * Hinterlegte Dokumente eines Features ansehen und öffnen (US3, FR-016).
 * Zeigt Anzeigename, Größe und Fundort; ein Klick öffnet die Datei mit der
 * Systemanwendung — der Server wählt sie aus dem Manifest, nie über den Pfad.
 */
export function FeatureDocumentsDialog({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const { dispatch } = useStore();
  const [documents, setDocuments] = useState<FeatureDocument[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .featureDocuments(featureId)
      .then((d) => !cancelled && setDocuments(d))
      .catch((e: Error) => {
        if (cancelled) return;
        setDocuments([]);
        dispatch({ type: 'error', message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [featureId, dispatch]);

  const open = (storedName: string) => {
    void api.openFeatureDocument(featureId, storedName).catch((e: Error) => {
      dispatch({ type: 'error', message: e.message });
    });
  };

  return (
    <Dialog title="Hinterlegte Dokumente" onClose={onClose}>
      {documents === null ? (
        <p className="text-xs text-zinc-500">Lade …</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-zinc-600">Zu diesem Feature wurden keine Dokumente hinterlegt.</p>
      ) : (
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li key={doc.storedName}>
              <button
                type="button"
                onClick={() => open(doc.storedName)}
                title="Mit der Systemanwendung öffnen"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left hover:bg-zinc-800"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-zinc-200">{doc.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatBytes(doc.bytes)}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-600">{doc.relPath}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
