import { describe, expect, it } from 'vitest';
import { mergedNotificationBody, reviewDueMessage, taskProgressText } from './integrationMessages.js';

/**
 * Der Wortlaut ist Teil der Abnahme (SC-001, SC-003) — deshalb steht er hier
 * zeichengenau und nicht als „enthält ungefähr".
 *
 * INV-4 (Vergleichsgrundlage aus T001, mergeQueueService.ts vor der Änderung):
 * `${feature.name}: verifiziert — bereit für dein Review & Merge`
 */
const HEUTIGER_VERIFIKATIONSSATZ = 'verifiziert — bereit für dein Review & Merge';

describe('taskProgressText', () => {
  it('nennt erledigte und offene Aufgaben', () => {
    expect(taskProgressText({ tasksDone: 68, tasksTotal: 76 })).toBe('68/76 erledigt, 8 offen');
  });

  it('sagt „keine offen", wenn alles erledigt ist', () => {
    expect(taskProgressText({ tasksDone: 76, tasksTotal: 76 })).toBe('76/76 erledigt, keine offen');
  });

  it('zeigt eine unangetastete Liste vollständig offen', () => {
    expect(taskProgressText({ tasksDone: 0, tasksTotal: 76 })).toBe('0/76 erledigt, 76 offen');
  });

  it('benennt die fehlende Aufgabenliste statt „0/0" zu zeigen (FR-013)', () => {
    expect(taskProgressText({ tasksDone: 0, tasksTotal: 0 })).toBe('keine Aufgabenliste vorhanden');
  });

  it('zeigt widersprüchliche Zählung als Rohwerte, offene nie negativ', () => {
    expect(taskProgressText({ tasksDone: 80, tasksTotal: 76 })).toBe('80/76 erledigt, keine offen');
  });
});

describe('reviewDueMessage', () => {
  const feature = { name: 'ehrlichkeit-vor-dem-merge', tasksDone: 68, tasksTotal: 76 };

  it('behält für konfigurierte Projekte den heutigen Verifikationssatz (FR-011, INV-4)', () => {
    const text = reviewDueMessage(feature, { verificationConfigured: true });
    expect(text).toBe(
      'ehrlichkeit-vor-dem-merge: verifiziert — bereit für dein Review & Merge · 68/76 erledigt, 8 offen',
    );
    // Der Teil vor dem Trenner ist zeichengleich mit dem Wortlaut vor dieser Änderung.
    expect(text.split(' · ')[0]).toBe(`${feature.name}: ${HEUTIGER_VERIFIKATIONSSATZ}`);
  });

  it('benennt für unkonfigurierte Projekte die fehlende Verifikation (FR-003)', () => {
    expect(reviewDueMessage(feature, { verificationConfigured: false })).toBe(
      'ehrlichkeit-vor-dem-merge: keine Verifikation konfiguriert — es wurde nichts geprüft; ' +
        'bereit für dein Review & Merge · 68/76 erledigt, 8 offen',
    );
  });

  it('behauptet ohne Konfiguration nirgends eine Verifikation (INV-2, SC-001)', () => {
    const text = reviewDueMessage(feature, { verificationConfigured: false });
    expect(text).not.toContain('verifiziert');
    expect(text).not.toContain('Verifikation läuft');
  });

  it('nennt den Aufgabenstand in jeder Variante (FR-012, R6.3)', () => {
    for (const verificationConfigured of [true, false]) {
      expect(reviewDueMessage(feature, { verificationConfigured })).toContain('68/76 erledigt, 8 offen');
    }
  });

  it('nennt die fehlende Aufgabenliste auch in der Review-Meldung', () => {
    const ohneListe = { name: 'ohne-liste', tasksDone: 0, tasksTotal: 0 };
    expect(reviewDueMessage(ohneListe, { verificationConfigured: true })).toBe(
      'ohne-liste: verifiziert — bereit für dein Review & Merge · keine Aufgabenliste vorhanden',
    );
  });
});

describe('mergedNotificationBody', () => {
  it('trägt Zielbranch und Aufgabenstand (FR-012a)', () => {
    expect(mergedNotificationBody({ name: 'feature-x', tasksDone: 68, tasksTotal: 76 }, 'main')).toBe(
      'feature-x → main · 68/76 erledigt, 8 offen',
    );
  });

  it('trägt den Stand auch bei vollständiger Liste', () => {
    expect(mergedNotificationBody({ name: 'feature-x', tasksDone: 76, tasksTotal: 76 }, 'develop')).toBe(
      'feature-x → develop · 76/76 erledigt, keine offen',
    );
  });

  it('nennt die fehlende Aufgabenliste statt „0/0" (FR-013)', () => {
    expect(mergedNotificationBody({ name: 'feature-x', tasksDone: 0, tasksTotal: 0 }, 'main')).toBe(
      'feature-x → main · keine Aufgabenliste vorhanden',
    );
  });
});
