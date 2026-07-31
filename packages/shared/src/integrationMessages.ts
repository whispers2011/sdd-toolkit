/**
 * Texte der Meldungen an der Entscheidungsstelle — an genau einem Ort, weil ihr
 * Wortlaut Teil der Abnahme ist (SC-001, SC-003) und ohne Server, DB oder Git
 * geprüft werden muss. Reine Funktionen, keine IO.
 *
 * Zwei Zusicherungen, die hier und nur hier zu halten sind:
 * - Für Projekte OHNE Verifikationskommandos taucht weder „verifiziert" noch
 *   „Verifikation läuft" auf (FR-003, SC-001).
 * - Für Projekte MIT Kommandos bleibt der Verifikationsteil wortgleich zum
 *   Stand vor diesem Feature; ergänzt wird ausschließlich der Aufgabenstand
 *   (FR-011, INV-4).
 */
import type { Feature } from './types.js';

type TaskCounts = Pick<Feature, 'tasksDone' | 'tasksTotal'>;
type NamedFeature = Pick<Feature, 'name' | 'tasksDone' | 'tasksTotal'>;

/** Trennt den Sachstand vom Aufgabenstand — INV-4 prüft den Teil links davon. */
const TRENNER = ' · ';

/**
 * Aufgabenstand als Satzteil. Ohne Aufgabenliste wird das benannt, statt „0/0"
 * zu zeigen (FR-013). Widersprüchliche Zählung (`tasksDone > tasksTotal`) wird
 * als Rohwert gezeigt und nicht zurechtgebogen; nur die offenen Aufgaben sind
 * nach unten auf 0 begrenzt, damit dort keine negative Zahl steht.
 */
export function taskProgressText(f: TaskCounts): string {
  if (f.tasksTotal === 0) return 'keine Aufgabenliste vorhanden';
  const offen = Math.max(0, f.tasksTotal - f.tasksDone);
  return `${f.tasksDone}/${f.tasksTotal} erledigt, ${offen === 0 ? 'keine offen' : `${offen} offen`}`;
}

/** Meldung, mit der ein Feature zum menschlichen Review gerufen wird (FR-003, FR-012, FR-013). */
export function reviewDueMessage(f: NamedFeature, opts: { verificationConfigured: boolean }): string {
  const sachstand = opts.verificationConfigured
    ? 'verifiziert — bereit für dein Review & Merge'
    : 'keine Verifikation konfiguriert — es wurde nichts geprüft; bereit für dein Review & Merge';
  return `${f.name}: ${sachstand}${TRENNER}${taskProgressText(f)}`;
}

/**
 * Meldung, mit der ein Feature zur manuellen Abnahme gerufen wird (FR-024/FR-030).
 *
 * Die Adresse steht mit im Text, damit die Inbox ohne Umweg über die Lane sagt,
 * wo die Anwendung läuft. Ist sie nicht bekannt — kein Stack konfiguriert oder
 * der Haupteingang antwortet nicht —, wird das benannt statt eines Links ins
 * Leere (FR-033).
 */
export function manualTestDueMessage(f: NamedFeature, url: string | null): string {
  const adresse = url ?? 'keine erreichbare Adresse — Stack auf der Karte starten';
  return `${f.name}: wartet auf manuelle Abnahme — ${adresse}${TRENNER}${taskProgressText(f)}`;
}

/**
 * Text der Meldung über den vollzogenen Merge bzw. den erstellten PR (FR-012a).
 * Auf beiden Merge-Pfaden ist das die einzige Gelegenheit, den Aufgabenstand zu
 * sehen — es gibt dort kein menschliches Review-Halt.
 */
export function mergedNotificationBody(f: NamedFeature, target: string): string {
  return `${f.name} → ${target}${TRENNER}${taskProgressText(f)}`;
}
