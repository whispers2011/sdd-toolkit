import type { Feature, FeaturePhase } from './types.js';

/**
 * Dokumente, die beim manuellen Anlegen eines Features mitgegeben wurden.
 * Pure Bausteine: Typen, Grenzen und der Prompt-Verweis — ohne Dateisystem,
 * damit Dialog, Server und Tests dieselbe Wahrheit nennen (FR-018).
 */

/** Ein übernommenes Dokument. Ablage: `specs/<slug>/docs/<storedName>`. */
export interface FeatureDocument {
  /** Anzeigename = ursprünglicher Dateiname des Nutzers, unverändert. */
  name: string;
  /** Abgelegter Dateiname; weicht von `name` ab, wenn bereinigt oder entkollidiert (FR-005). */
  storedName: string;
  /** Fundort relativ zur Worktree-Wurzel — genau der Pfad, den der Prompt nennt. */
  relPath: string;
  bytes: number;
  /** Vom Browser gemeldet; rein informativ, die Übernahme hängt nicht davon ab (FR-013). */
  mimeType: string;
  uploadedAt: number;
}

/** Ein nicht übernommenes Dokument samt Grund — nie ein stiller Verlust (FR-014). */
export interface RejectedDocument {
  name: string;
  reason: string;
}

/** Antwort des Anlegens mit Dokumenten: was gelungen und was liegengeblieben ist. */
export interface FeatureDocumentsResult {
  feature: Feature;
  documents: FeatureDocument[];
  rejected: RejectedDocument[];
}

/** Manifest-Eintrag: wie `FeatureDocument`, aber ohne den ableitbaren `relPath`. */
export type DocumentManifestEntry = Omit<FeatureDocument, 'relPath'>;

/** On-Disk-Format von `specs/<slug>/docs/documents.json`. */
export interface DocumentManifest {
  version: number;
  documents: DocumentManifestEntry[];
}

// ---------- Grenzen (FR-011, FR-018) ----------

/** Größe je Dokument — deckungsgleich mit der Multipart-Grenze des Servers. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Anzahl Dokumente je Feature. */
export const MAX_DOCUMENTS_PER_FEATURE = 20;
export const DOCUMENTS_DIR_NAME = 'docs';
export const DOCUMENTS_MANIFEST = 'documents.json';
/** Aktuelle Manifest-Version; erlaubt ein späteres Format ohne Bruch. */
export const DOCUMENT_MANIFEST_VERSION = 1;

/** Lesbare Größe: `840 Byte`, `4.3 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Byte`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Ablehnungsgründe (contracts/feature-documents-api.md) ----------
// Wortlaut zentral, damit Dialog-Vorprüfung und Server-Prüfung dasselbe sagen (SC-005).

export function reasonTooLarge(name: string, bytes: number): string {
  return `${name}: zu groß (${formatBytes(bytes)}, max. ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB)`;
}

export function reasonEmpty(name: string): string {
  return `${name}: leere Datei (0 Byte)`;
}

export function reasonTooMany(name: string): string {
  return `${name}: Höchstzahl von ${MAX_DOCUMENTS_PER_FEATURE} Dokumenten je Feature erreicht`;
}

export function reasonUnsafeName(name: string): string {
  return `${name}: unsicherer Dateiname`;
}

export function reasonWriteFailed(name: string, cause: string): string {
  return `${name}: konnte nicht abgelegt werden (${cause})`;
}

// ---------- Prompt-Verweis (contracts/document-preamble.md) ----------

/**
 * Verweis auf die hinterlegten Dokumente für den Phasen-Auftrag: Namen und
 * Fundorte, niemals Inhalte (FR-009). Ohne Dokumente ein leerer String — der
 * Prompt bleibt dann zeichengleich mit dem bisherigen (FR-017, SC-006).
 */
export function buildDocumentsPreamble(phase: FeaturePhase, docs: FeatureDocument[]): string {
  if (docs.length === 0) return '';

  const dir = documentsDirOf(docs);
  const count =
    docs.length === 1 ? 'wurde 1 Dokument hinterlegt' : `wurden ${docs.length} Dokumente hinterlegt`;
  const lines = [
    '',
    '',
    `[Dokumente] Zu diesem Feature ${count} (Ablage: ${dir}):`,
    ...docs.map((d) => `- \`${d.name}\` → ${d.relPath} (${formatBytes(d.bytes)})`),
    phase === 'specify'
      ? 'Verwende dieses Material als Ausgangsbasis der Spezifikation.'
      : 'Berücksichtige dieses Material bei diesem Schritt; lies gezielt, was für den Schritt relevant ist.',
  ];
  return lines.join('\n');
}

/** Ablageordner aus den Fundorten ableiten (mit abschließendem `/`). */
function documentsDirOf(docs: FeatureDocument[]): string {
  const first = docs[0]?.relPath ?? '';
  const cut = first.lastIndexOf('/');
  return cut > 0 ? `${first.slice(0, cut)}/` : `${DOCUMENTS_DIR_NAME}/`;
}
