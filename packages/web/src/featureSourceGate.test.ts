import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Vorauswahl der Ticket-Quelle (Contract U7, FR-029 … FR-032).
 *
 * Regressions-Tripwire über den Quelltext — dasselbe Muster wie in
 * `server.test.ts` („Auto-Submit vs. reine Einfügung"). Geprüft wird, WELCHE
 * Entscheidung an welcher Stelle getroffen wird; das Rendern selbst deckt
 * quickstart V13/V14 ab.
 */

const src = (datei: string) => readFileSync(new URL(`./components/${datei}`, import.meta.url), 'utf8');

const SIDEBAR = src('Sidebar.tsx');
const JIRA_IMPORT = src('JiraImportDialog.tsx');
const NEW_FEATURE = src('NewFeatureDialog.tsx');

/** Rumpf einer Funktion ab ihrem Namen bis zur nächsten Deklaration auf Modulebene. */
function funktionsRumpf(quelle: string, name: string): string {
  const start = quelle.indexOf(`function ${name}(`);
  expect(start, `Funktion nicht gefunden: ${name}`).toBeGreaterThanOrEqual(0);
  const rest = quelle.slice(start + name.length);
  const next = rest.search(/\n(export )?function \w+/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('FeatureSourceGate entscheidet über die Startquelle (U7.1/U7.2)', () => {
  const rumpf = funktionsRumpf(SIDEBAR, 'NewFeatureFlow');

  it('liest bei verbundenem Jira die nutzerweite Vorauswahl (FR-029, SC-010)', () => {
    expect(rumpf).toContain('getPersonal().ticketSource');
    // Nicht mehr hart auf 'jira' verdrahtet.
    expect(rumpf).not.toMatch(/setMode\(c \? 'jira' : 'manual'\)/);
  });

  it('öffnet ohne Verbindung zwingend die manuelle Erfassung (FR-030, U7.2)', () => {
    // Beide Zweige — Statusabfrage erfolgreich und fehlgeschlagen — enden auf 'manual'.
    expect(rumpf).toMatch(/c \? getPersonal\(\)\.ticketSource : 'manual'/);
    expect(rumpf).toMatch(/setMode\('manual'\)/);
  });

  it('schreibt beim Öffnen nichts in die Einstellungen zurück (U7.2, FR-030)', () => {
    expect(rumpf).not.toContain('patchPersonal');
    expect(rumpf).not.toContain('savePersonal');
  });
});

describe('Der Umschalter bleibt in beiden Dialogen erreichbar (U7.3, SC-012)', () => {
  it('der Jira-Import zeigt den Umschalter zur manuellen Erfassung', () => {
    expect(JIRA_IMPORT).toContain('<FeatureSourceToggle');
    expect(JIRA_IMPORT).toContain('onManual={onSwitchToManual}');
  });

  it('die manuelle Erfassung zeigt den Umschalter zum Jira-Import', () => {
    expect(NEW_FEATURE).toContain('<FeatureSourceToggle');
    expect(NEW_FEATURE).toContain('onJira={onSwitchToJira}');
  });

  it('der Wechsel im Dialog verändert die gespeicherte Vorauswahl nicht (U7.4, FR-031)', () => {
    for (const [name, quelle] of [
      ['JiraImportDialog', JIRA_IMPORT],
      ['NewFeatureDialog', NEW_FEATURE],
    ] as const) {
      expect(quelle, `${name} schreibt die Vorauswahl`).not.toContain('patchPersonal');
      expect(quelle, `${name} schreibt die Vorauswahl`).not.toContain('savePersonal');
    }
  });
});

describe('Die beiden Jira-Einstellungen bleiben getrennt (U7.5, FR-032, SC-011)', () => {
  it('der Import-Dialog schreibt nur seine eigene Auswahl', () => {
    // `jira.lastSelection` läuft ausschliesslich über saveJiraSelection …
    expect(JIRA_IMPORT).toContain('saveJiraSelection(');
    // … und die Vorauswahl fasst er nicht an.
    expect(JIRA_IMPORT).not.toContain('ticketSource');
  });

  it('die Vorauswahl fasst die letzte Jira-Auswahl nicht an', () => {
    const dialog = readFileSync(new URL('./components/PersonalSettingsDialog.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain('ticketSource');
    expect(dialog).not.toContain('saveJiraSelection');
    expect(dialog).not.toContain('lastSelection');
  });
});
