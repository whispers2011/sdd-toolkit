import type { ManualTestFinding, ManualTestSeverity } from './types.js';

/** Überschrift je Gewicht — die Reihenfolge ist zugleich die Ausgabereihenfolge. */
const SEVERITY_HEADING: Record<ManualTestSeverity, string> = {
  blocker: 'Blocker',
  rework: 'Nacharbeit',
  note: 'Hinweise',
};

const SEVERITY_ORDER: ManualTestSeverity[] = ['blocker', 'rework', 'note'];

/**
 * Kompiliert die Befunde einer abgelehnten Abnahme zum Arbeitsauftrag für
 * `specify`.
 *
 * Der Auftrag lautet bewusst NICHT „behebe diese Punkte", sondern „arbeite sie
 * in die Spezifikation ein". Was nur im Prompt steht, ist nach einer Runde
 * verloren; was als Akzeptanzkriterium in der Spezifikation steht, überlebt und
 * ist das, wogegen die nächste Abnahme prüft. Erst damit wird aus der Schleife
 * eine Annäherung statt eines Kreisels.
 *
 * Der Text geht als `extraPrompt` an `startPhaseRun('specify', …)` und landet
 * damit hinter dem Slash-Kommando — dieselbe Stelle, an der bei der Erstanlage
 * die Feature-Beschreibung steht.
 */
export function compileManualTestPrompt(
  findings: ManualTestFinding[],
  freeText: string,
  round: number,
): string {
  const parts: string[] = [
    `Die manuelle Abnahme dieses Features wurde in Runde ${round} abgelehnt. ` +
      'Die laufende Anwendung wurde durchgeklickt; die folgenden Befunde widersprechen der Absicht.',
  ];

  let n = 0;
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    parts.push('', `${SEVERITY_HEADING[severity]}:`);
    for (const f of group) {
      n += 1;
      const anchor = f.where === null || f.where.trim() === '' ? 'Allgemein' : f.where.trim();
      parts.push(`${n}. [${anchor}] ${f.text.trim()}`);
    }
  }

  const trimmed = freeText.trim();
  if (trimmed) parts.push('', 'Anmerkung aus der Abnahme:', trimmed);

  parts.push(
    '',
    'Arbeite diese Befunde in die BESTEHENDE Spezifikation ein — als Anforderung bzw. ' +
      'Akzeptanzkriterium, nicht als Fehlerliste und nicht als Änderungsprotokoll. ' +
      'Schreibe die Spezifikation nicht neu: ergänze sie und korrigiere, was den Befunden ' +
      'widerspricht. Jeder Blocker MUSS danach als prüfbares Kriterium in der Spezifikation ' +
      'stehen, damit die nächste Abnahme dagegen prüfen kann.',
  );

  return parts.join('\n');
}
