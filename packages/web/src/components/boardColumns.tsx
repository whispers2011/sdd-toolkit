import {
  AUTOMATION_META,
  FEATURE_PHASES,
  INTEGRATION_STAGE_META,
  INTEGRATION_STEPS,
  INTEGRATION_TONE_CLASS,
  type AutomationSettings,
  type Feature,
  type FeaturePhase,
  type IntegrationStage,
  type IntegrationStep,
  type LifecycleStageId,
} from '@sdd/shared';
import { Dialog } from './Sidebar.js';
import { CheckIcon, FlaskIcon, GitMergeIcon, ReviewIcon, VerifyIcon, type IconProps } from './icons.js';

/**
 * Das Spaltenmodell des Boards — eigene Datei, weil sowohl das Board als auch
 * der Erklär-Dialog es brauchen und ein gegenseitiger Import der beiden
 * Komponenten ein Zyklus wäre.
 *
 * Spalten nach `implement` sind danach sortiert, WER am Zug ist:
 *
 *   Implement → Prüfung → Abnahme → Review → Merge → Done
 *               (Toolkit)  (Mensch)  (Mensch)  (Toolkit)
 *
 * Bis 31.07.2026 lagen alle neun Integrationsstufen in EINER Spalte
 * („Integration"). Ein Feature, das auf einen Menschen wartete, war damit
 * optisch nicht von einem zu unterscheiden, bei dem gerade ein Merge lief.
 */
export type IntegrationColumn = 'verify' | 'accept' | 'review' | 'merge' | 'done';
export type Column = FeaturePhase | IntegrationColumn;

export const PHASE_LABELS: Record<FeaturePhase, string> = {
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  analyze: 'Analyze',
  tasks: 'Tasks',
  implement: 'Implement',
};

export const INTEGRATION_COLUMN_LABELS: Record<IntegrationColumn, string> = {
  verify: 'Prüfung',
  accept: 'Abnahme',
  review: 'Review',
  merge: 'Merge',
  done: 'Done',
};

/**
 * Über `Record<IntegrationStage, …>` getypt: eine neue Stufe bricht hier den
 * Typcheck, statt still in der falschen Spalte zu landen (Muster aus
 * workflowModel.ts).
 */
export const COLUMN_FOR_STAGE: Record<IntegrationStage, Column> = {
  // Erreicht die Spalte nur über den Phasen-Zweig (alles approved).
  none: 'verify',
  verifying: 'verify',
  verification_unconfigured: 'verify',
  verify_failed: 'verify',
  review_gate: 'verify',
  gate_failed: 'verify',
  awaiting_manual_test: 'accept',
  awaiting_human_review: 'review',
  queued: 'merge',
  merging: 'merge',
  conflict_resolving: 'merge',
  conflict_escalated: 'merge',
  merged: 'done',
};

/** Spalten, in denen die Maschine arbeitet — schmal, ohne eigene Aktionsleiste. */
export const AUTOMATIC_COLUMNS = new Set<Column>(['verify', 'merge']);

/** Spalten, in denen ein Mensch entscheidet. Bestimmt auch den Erklärtext. */
const HUMAN_COLUMNS = new Set<IntegrationColumn>(['accept', 'review']);

/** Schritte der Integrations-Pipeline je Spalte, in Ausführungsreihenfolge. */
const STEPS_FOR_COLUMN: Record<IntegrationColumn, LifecycleStageId[]> = {
  verify: ['verify', 'review_gate'],
  accept: ['manual_test'],
  review: ['human_review'],
  merge: ['merge_queue'],
  done: ['merged'],
};

const COLUMN_ICONS: Record<IntegrationColumn, (p: IconProps) => React.ReactElement> = {
  verify: VerifyIcon,
  accept: FlaskIcon,
  review: ReviewIcon,
  merge: GitMergeIcon,
  done: CheckIcon,
};

/** Spalte, in der ein Feature aktuell steht. */
export function columnOf(feature: Feature): Column {
  if (feature.integration !== 'none') return COLUMN_FOR_STAGE[feature.integration];
  for (const p of FEATURE_PHASES) {
    const state = feature.phases[p];
    if (state && state.status !== 'approved') return p;
  }
  return 'verify'; // alles approved → bereit zur Integration
}

export function isIntegrationColumn(column: Column): column is IntegrationColumn {
  return !(column in PHASE_LABELS);
}

/**
 * Was der Schritt im aktuellen Projekt TATSÄCHLICH tut — abgeleitet aus den
 * Automation-Schaltern, nicht aus einem festen Text. Ein Schritt, der bei
 * dieser Einstellung gar nicht läuft, soll das auch sagen.
 */
function stepStatus(
  step: IntegrationStep,
  automation: AutomationSettings,
  column: IntegrationColumn,
): { text: string; tone: string } {
  if (step.requires && automation[step.requires] !== true) {
    return {
      text: `entfällt — „${AUTOMATION_META[step.requires].label}" ist aus`,
      tone: 'text-zinc-500',
    };
  }
  if (step.humanUnless && automation[step.humanUnless] === true) {
    return {
      text: `entfällt — „${AUTOMATION_META[step.humanUnless].label}" ist an`,
      tone: 'text-zinc-500',
    };
  }
  if (step.terminal) return { text: 'Abschluss', tone: 'text-emerald-400' };
  if (HUMAN_COLUMNS.has(column)) return { text: 'du entscheidest', tone: 'text-amber-400' };
  if (step.autoBy) {
    return automation[step.autoBy] === true
      ? { text: 'läuft automatisch', tone: 'text-sky-400' }
      : { text: 'du stößt es an', tone: 'text-amber-400' };
  }
  return { text: 'läuft automatisch', tone: 'text-sky-400' };
}

/** Stufen, die in dieser Spalte erscheinen — aus COLUMN_FOR_STAGE abgeleitet. */
function stagesIn(column: IntegrationColumn): IntegrationStage[] {
  return (Object.keys(COLUMN_FOR_STAGE) as IntegrationStage[]).filter(
    (s) => COLUMN_FOR_STAGE[s] === column && s !== 'none',
  );
}

/**
 * Erklärung einer Integrations-Spalte — das Gegenstück zum „i" der
 * Schritt-Spalten. Dort steht die Kommando-Definition zum Ansehen und
 * Bearbeiten; hier gibt es keine, sondern eine Pipeline-Stufe. Der Text kommt
 * deshalb vollständig aus INTEGRATION_STEPS und INTEGRATION_STAGE_META und kann
 * nicht gegenüber dem Ablauf veralten.
 */
export function IntegrationColumnDialog({
  column,
  automation,
  onClose,
}: {
  column: IntegrationColumn;
  automation: AutomationSettings | null;
  onClose: () => void;
}) {
  const steps = STEPS_FOR_COLUMN[column]
    .map((id) => INTEGRATION_STEPS.find((s) => s.id === id))
    .filter((s): s is IntegrationStep => s !== undefined);
  const stages = stagesIn(column);
  const Icon = COLUMN_ICONS[column];

  return (
    <Dialog title={`Spalte „${INTEGRATION_COLUMN_LABELS[column]}"`} onClose={onClose}>
      <div className="space-y-4 text-xs">
        <p className="flex items-start gap-2 text-zinc-400">
          <span className="mt-0.5 shrink-0 text-zinc-500">
            <Icon />
          </span>
          <span>
            {HUMAN_COLUMNS.has(column)
              ? 'Hier bist du am Zug — das Toolkit wartet auf deine Entscheidung.'
              : column === 'done'
                ? 'Erledigt. Karten liegen hier nur, wenn „Abgeschlossene zeigen" an ist.'
                : 'Hier arbeitet das Toolkit. Du musst nichts tun, außer es hakt.'}
          </span>
        </p>

        <section className="space-y-2">
          {steps.map((step) => {
            const status = automation ? stepStatus(step, automation, column) : null;
            return (
              <div key={step.id} className="rounded border border-zinc-800 p-2">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-medium text-zinc-200">{step.label}</span>
                  {status && <span className={`ml-auto ${status.tone}`}>{status.text}</span>}
                </div>
                <p className="text-zinc-400">{step.detail}</p>
                {step.escalatesTo && (
                  <p className="mt-1 text-zinc-500">
                    Bei einem Fehlschlag bleibt die Karte hier stehen als{' '}
                    <span className={INTEGRATION_TONE_CLASS[INTEGRATION_STAGE_META[step.escalatesTo].tone]}>
                      {INTEGRATION_STAGE_META[step.escalatesTo].label}
                    </span>{' '}
                    — mit einem Eintrag in „Braucht dich".
                  </p>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h3 className="mb-1 font-medium text-zinc-300">Zustände, die hier stehen können</h3>
          <ul className="space-y-0.5">
            {stages.map((s) => (
              <li key={s} className={INTEGRATION_TONE_CLASS[INTEGRATION_STAGE_META[s].tone]}>
                {INTEGRATION_STAGE_META[s].label}
              </li>
            ))}
          </ul>
        </section>

        {column === 'verify' && (
          <p className="text-zinc-500">
            Nur diese Spalte nimmt gezogene Karten an — sie ist der Eintritt in die Integration.
          </p>
        )}
        {column === 'accept' && (
          <p className="text-zinc-500">
            Eine Ablehnung setzt das Feature auf <strong className="text-zinc-400">Specify</strong>{' '}
            zurück: die Befunde gehen als Auftrag in die bestehende Spezifikation, alles Nachgelagerte
            wird als veraltet markiert und der Lebenszyklus läuft erneut.
          </p>
        )}
      </div>
    </Dialog>
  );
}
