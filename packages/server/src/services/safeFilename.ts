import { resolve, sep } from 'node:path';

/**
 * Dateinamen aus fremder Quelle (Jira-Anhang, Dokument-Upload) sicher ablegbar
 * machen. Gemeinsam genutzt, damit es nur eine getestete Härtung gibt (R7).
 */

/** Obergrenze für den abgelegten Namen; Endung bleibt erhalten. */
const MAX_FILENAME_LENGTH = 200;
/** Längere „Endungen" sind keine — dann wird stumpf gekürzt. */
const MAX_EXTENSION_LENGTH = 20;

/**
 * Bereinigt einen Dateinamen: Pfadseparatoren werden ersetzt, führende Punkte
 * entwertet (kein Dotfile, kein `..`), Steuerzeichen entfernt, die Länge
 * begrenzt. Bleibt nichts übrig, greift `fallback`.
 */
export function sanitizeFilename(name: string, fallback = 'dokument'): string {
  const clean = name
    // eslint-disable-next-line no-control-regex -- NUL und Steuerzeichen sind genau das Ziel
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .replace(/^\.+/, '_')
    .trim();
  return truncate(clean) || fallback;
}

/** Kürzt auf `MAX_FILENAME_LENGTH`, ohne die Endung zu verlieren. */
function truncate(name: string): string {
  if (name.length <= MAX_FILENAME_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= MAX_EXTENSION_LENGTH ? name.slice(dot) : '';
  return name.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
}

/**
 * Macht den Namen innerhalb von `used` eindeutig — `bericht.txt` →
 * `bericht-2.txt` → `bericht-3.txt`. Kein stilles Überschreiben (FR-005).
 * Vergibt den Namen zugleich (Seiteneffekt auf `used`).
 */
export function uniqueFilename(name: string, used: Set<string>): string {
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) {
    const dot = name.lastIndexOf('.');
    candidate = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Gürtel plus Hosenträger zur Bereinigung: liefert den absoluten Zielpfad nur,
 * wenn er tatsächlich unterhalb von `dir` liegt — sonst `null`
 * (Muster: `knowledgeService.safeRepoRelative`).
 */
export function resolveInside(dir: string, name: string): string | null {
  const base = resolve(dir);
  const abs = resolve(base, name);
  return abs.startsWith(base + sep) ? abs : null;
}
