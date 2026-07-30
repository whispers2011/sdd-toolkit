import { useEffect, useState } from 'react';
import { FEATURE_PHASES, evaluateAction, INTEGRATION_STAGE_META, INTEGRATION_TONE_CLASS } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { TerminalPane } from './TerminalPane.js';
import { VoiceButton } from './VoiceButton.js';
import { FeatureKnowledgeSelect } from './FeatureKnowledgeSelect.js';
import { FeatureAgentSelect } from './FeatureAgentSelect.js';
import { FeatureLifecycleStepSelect } from './FeatureLifecycleStepSelect.js';
import { StackPanel } from './StackPanel.js';
import { FeatureDocumentsDialog } from './FeatureDocumentsDialog.js';
import {
  CodeIcon,
  CopyIcon,
  DeleteIcon,
  DocumentIcon,
  FolderOpenIcon,
  KnowledgeIcon,
  ShieldIcon,
  StepsIcon,
} from './icons.js';
import { ConfirmDialog } from './Sidebar.js';
import { FeatureDashboard } from './FeatureDashboard.js';

/** Konsole pro Feature: Header + Phasen-Leiste + Terminal. */
export function FeatureConsole({ featureId }: { featureId: string }) {
  const { state, dispatch } = useStore();
  const [connected, setConnected] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  // Einstieg nur zeigen, wenn es etwas zu zeigen gibt (FR-016).
  const [documentCount, setDocumentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .featureDocuments(featureId)
      .then((d) => !cancelled && setDocumentCount(d.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [featureId]);

  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);
  const ctx = featureActionContext(state, featureId);
  // Löschen ist destruktiv und trifft uncommittete Arbeit — seit 27.07.2026 sperrt
  // die Policy es, solange gearbeitet wird, statt nur im Dialog davor zu warnen.
  const deleteV = ctx ? evaluateAction('delete', ctx) : null;

  if (!feature) return <div className="p-8 text-zinc-500">Feature nicht gefunden.</div>;

  // Abgeschlossen (gemergt/archiviert) → keine neue Session mehr; statt Terminal ein
  // Ergebnis-Dashboard (Artefakte, Token-Statistik, Logs).
  const completed = feature.integration === 'merged' || !!feature.archivedAt;
  // Bei gemergtem Feature ist der Code bereits im Haupt-Branch — „Löschen" entfernt
  // nur die Toolkit-Spuren, NICHT die gemergten Projektdateien. Nur bei ungemergter
  // Arbeit gehen Worktree/Branch (und damit Code) verloren.
  const merged = feature.integration === 'merged';
  // Ab `implement` gibt es einen Stack zu bedienen; auf der Abnahme-Stufe steht
  // das Feld offen, weil dort genau damit gearbeitet wird.
  const stackRelevant = feature.phases.implement?.status !== 'idle' || feature.integration !== 'none';
  const stackOpen = feature.integration === 'awaiting_manual_test';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <span className={`status-dot status-${session?.status ?? 'stopped'}`} />
        <span className="text-sm font-medium text-zinc-200">
          {project?.name} / {feature.name}
        </span>
        <span className="text-xs text-zinc-500">{feature.branch}</span>
        {feature.jiraRef && (
          <a
            href={feature.jiraRef.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-xs text-sky-400 hover:bg-sky-900 hover:text-sky-300"
            title={`Jira-Ticket ${feature.jiraRef.key} öffnen`}
          >
            {feature.jiraRef.key}
          </a>
        )}
        {feature.worktreePath && (
          <span className="truncate text-xs text-zinc-600" title={feature.worktreePath}>
            {feature.worktreePath}
          </span>
        )}
        {/* Die Zurückweisung bleibt sichtbar, bis der letzte Schritt neu freigegeben ist (FR-026). */}
        {feature.reviewRejectedAt !== null && (
          <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-xs whitespace-nowrap text-amber-300">
            ↩ im Review zurückgewiesen
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* Worktree-abhängige Aktionen nur zeigen, wenn ein Worktree existiert (nach Abschluss entfernt). */}
          {feature.worktreePath && (
            <>
              <HeaderIcon title="Im Finder öffnen" onClick={() => void api.openFeature(featureId, 'finder')}>
                <FolderOpenIcon />
              </HeaderIcon>
              <HeaderIcon title="Im Editor öffnen" onClick={() => void api.openFeature(featureId, 'editor')}>
                <CodeIcon />
              </HeaderIcon>
              <HeaderIcon
                title="Worktree-Pfad kopieren"
                onClick={() => void navigator.clipboard.writeText(feature.worktreePath!)}
              >
                <CopyIcon />
              </HeaderIcon>
            </>
          )}
          {/* Ausgangsmaterial bleibt auch nach Abschluss einsehbar (SC-007). */}
          {documentCount > 0 && (
            <HeaderIcon
              title={`Hinterlegte Dokumente (${documentCount})`}
              onClick={() => setShowDocuments(true)}
            >
              <DocumentIcon />
            </HeaderIcon>
          )}
          {/* Wissen/Agents konfigurieren künftige Läufe — nach Abschluss wirkungslos, daher ausgeblendet. */}
          {!completed && (
            <>
              <HeaderIcon title="Projektwissen für dieses Feature" onClick={() => setShowKnowledge(true)}>
                <KnowledgeIcon />
              </HeaderIcon>
              <HeaderIcon title="Agents für dieses Feature" onClick={() => setShowAgents(true)}>
                <ShieldIcon />
              </HeaderIcon>
              <HeaderIcon title="Schritte für dieses Feature" onClick={() => setShowSteps(true)}>
                <StepsIcon />
              </HeaderIcon>
            </>
          )}
          <HeaderIcon
            title={
              merged
                ? 'Aus dem Toolkit entfernen — gemergter Code im Haupt-Branch bleibt erhalten'
                : 'Feature löschen (Worktree + Branch + alle Spuren entfernen)'
            }
            onClick={() => setShowDelete(true)}
            disabledReason={deleteV && deleteV.availability !== 'available' ? deleteV.reason : null}
          >
            <DeleteIcon />
          </HeaderIcon>
        </div>
        <span className="text-xs text-zinc-500">
          {completed ? 'abgeschlossen ✓' : connected ? 'verbunden' : 'getrennt …'}
        </span>
      </div>
      {/* Stack-Feld: dieselbe Darstellung wie in der Lane, kompakt. Sichtbar ab
          Beginn von `implement` — davor gibt es nichts zu bedienen (ui-contract §3). */}
      {stackRelevant && (
        <details className="border-b border-zinc-800 px-3 py-2" open={stackOpen}>
          <summary className="cursor-pointer text-xs font-medium text-zinc-300">Stack</summary>
          <div className="pt-2">
            <StackPanel featureId={featureId} compact />
          </div>
        </details>
      )}
      {showDocuments && <FeatureDocumentsDialog featureId={featureId} onClose={() => setShowDocuments(false)} />}
      {showKnowledge && <FeatureKnowledgeSelect featureId={featureId} onClose={() => setShowKnowledge(false)} />}
      {showAgents && <FeatureAgentSelect featureId={featureId} onClose={() => setShowAgents(false)} />}
      {showSteps && <FeatureLifecycleStepSelect featureId={featureId} onClose={() => setShowSteps(false)} />}
      {showDelete && (
        <ConfirmDialog
          title={merged ? 'Feature aus dem Toolkit entfernen?' : 'Feature löschen?'}
          message={
            (merged
              ? `„${feature.name}" wird aus dem Toolkit entfernt: Läufe, Logs, Verlauf und interne Spuren. ` +
                `Der bereits in „${project?.defaultBranch ?? 'den Haupt-Branch'}" gemergte Code bleibt vollständig erhalten.`
              : `„${feature.name}" wird endgültig gelöscht: Worktree und Branch (inkl. NICHT gemergter Arbeit), ` +
                `Läufe, Logs und alle Spuren werden entfernt. Das kann nicht rückgängig gemacht werden.`)
          }
          confirmLabel={merged ? 'Aus Toolkit entfernen' : 'Endgültig löschen'}
          onConfirm={() => {
            setShowDelete(false);
            void api
              .deleteFeature(featureId)
              .catch((e) => dispatch({ type: 'error', message: (e as Error).message }));
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {completed ? (
        <FeatureDashboard feature={feature} />
      ) : (
        <>
          <PhaseStrip featureId={featureId} />

          <div className="min-h-0 flex-1 bg-[#09090b] p-2">
            <TerminalPane key={featureId} featureId={featureId} focused onConnectionChange={setConnected} />
          </div>

          <PromptBar featureId={featureId} />
        </>
      )}
    </div>
  );
}

function HeaderIcon({
  title,
  onClick,
  children,
  disabledReason,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  /** Gesetzt ⇒ Icon ist gesperrt und nennt im Tooltip den Grund. */
  disabledReason?: string | null;
}) {
  const blocked = !!disabledReason;
  return (
    <button
      onClick={blocked ? undefined : onClick}
      disabled={blocked}
      title={disabledReason ?? title}
      className={`rounded px-1.5 py-0.5 text-base leading-none ${
        blocked ? 'cursor-not-allowed text-zinc-600' : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Prompt-Leiste (WP15): optionale Text-/Voice-Eingabe — standardmäßig eingeklappt,
 * die primäre Interaktion ist das echte Terminal darüber.
 */
function PromptBar({ featureId }: { featureId: string }) {
  const { dispatch } = useStore();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(localStorage.getItem('sdd-promptbar') === 'on');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem('sdd-promptbar', next ? 'on' : 'off');
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void api.sendPrompt(featureId, t).catch((e: Error) => dispatch({ type: 'error', message: e.message }));
  };

  if (!open) {
    return (
      <div className="flex items-center border-t border-zinc-800 px-3 py-0.5">
        <button onClick={toggle} className="text-xs text-zinc-600 hover:text-zinc-400">
          ▸ Prompt-Leiste (Voice 🎙)
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
      <button onClick={toggle} className="text-xs text-zinc-600 hover:text-zinc-400" title="Einklappen">
        ▾
      </button>
      <VoiceButton hotkey onText={(t) => setText((cur) => cur + t)} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder="Prompt an den Agent … (🎙 = Voice, ⌘⇧M)"
        className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-600"
      />
      <button
        onClick={send}
        disabled={!text.trim()}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-40"
      >
        Senden
      </button>
    </div>
  );
}

/**
 * Phasen-Leiste über der Konsole: Status + Aktion pro Phase. Welche Aktion eine
 * Kachel anbietet und ob sie auslösbar ist, entscheidet ausschließlich die
 * gemeinsame Festlegung (FR-022) — die Leiste prüft nichts mehr selbst. Der
 * Grund einer Sperrung steht dauerhaft unter der Leiste, nicht im Tooltip (FR-028).
 */
function PhaseStrip({ featureId }: { featureId: string }) {
  const { state } = useStore();
  const run = useAction();
  const feature = state.app?.features.find((f) => f.id === featureId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);
  const ctx = featureActionContext(state, featureId);
  if (!feature || !ctx) return null;

  const live = !!session && (session.status === 'working' || session.status === 'awaiting_input');
  const phases = FEATURE_PHASES.filter((p) => feature.phases[p]);
  const integrateV = evaluateAction('integrate', ctx);
  const reason = blockedReason(
    ...phases.flatMap((phase) => [
      evaluateAction('phase_start', ctx, { phase }),
      evaluateAction('phase_approve', ctx, { phase }),
    ]),
    integrateV,
  );

  return (
    <ActionGroup
      reason={reason}
      className="border-b border-zinc-800 px-4 py-1.5"
      actionsClassName="flex items-center gap-1 overflow-x-auto"
    >
      {phases.map((phase) => {
        const ps = feature.phases[phase];
        const cls =
          ps.status === 'approved'
            ? 'text-emerald-500 border-emerald-900'
            : ps.status === 'running'
              ? live
                ? 'text-emerald-300 border-emerald-700 animate-pulse'
                : 'text-zinc-400 border-zinc-700'
              : ps.status === 'awaiting_review'
                ? 'text-amber-400 border-amber-800'
                : 'text-zinc-500 border-zinc-800';
        const chipClass = `rounded border px-2 py-0.5 text-xs whitespace-nowrap ${cls} ${ps.stale ? 'line-through' : ''}`;
        const label = `${ps.status === 'approved' ? '✓ ' : ''}${phase}`;
        const startV = evaluateAction('phase_start', ctx, { phase });
        const approveV = evaluateAction('phase_approve', ctx, { phase });
        // Genau eine Aktion je Kachel — welche, sagt die Policy: ein offener
        // Schritt lässt sich starten, ein wartender freigeben. Trifft keine zu,
        // ist die Kachel reine Statusanzeige.
        if (startV.availability !== 'hidden') {
          return (
            <ActionButton
              key={phase}
              verdict={startV}
              onClick={() => run(`start:${featureId}:${phase}`, () => api.startPhase(featureId, phase))}
              className={chipClass}
            >
              {label}
            </ActionButton>
          );
        }
        if (approveV.availability !== 'hidden') {
          return (
            <ActionButton
              key={phase}
              verdict={approveV}
              onClick={() => run(`approve:${featureId}:${phase}`, () => api.approvePhase(featureId, phase))}
              className={chipClass}
            >
              {label}
            </ActionButton>
          );
        }
        return (
          <span key={phase} className={chipClass}>
            {label}
          </span>
        );
      })}
      {state.gateRunning[featureId] && (
        <span className="animate-pulse rounded border border-violet-800 px-2 py-0.5 text-xs whitespace-nowrap text-violet-300">
          ⚖ Gate läuft …
        </span>
      )}
      {/* Trenner nur, wenn rechts davon überhaupt etwas steht. */}
      {(integrateV.availability !== 'hidden' || feature.integration !== 'none') && (
        <span className="mx-2 text-zinc-700">|</span>
      )}
      <ActionButton
        verdict={integrateV}
        onClick={() => run(`integrate:${featureId}`, () => api.integrate(featureId))}
        className="rounded border border-sky-900 px-2 py-0.5 text-xs whitespace-nowrap text-sky-400 hover:border-sky-700"
      >
        ⇥ Integrieren
      </ActionButton>
      {feature.integration !== 'none' && (
        // Beschriftung und Ton aus dem geteilten Katalog: hier stand der Rohbezeichner
        // in Sky-Blau, der Farbe für laufende Vorgänge — „keine Verifikation
        // konfiguriert" hätte damit wie Fortschritt gelesen (FR-001a, SC-001).
        <span
          className={`rounded bg-zinc-800 px-2 py-0.5 text-xs ${
            INTEGRATION_TONE_CLASS[INTEGRATION_STAGE_META[feature.integration].tone]
          }`}
        >
          {INTEGRATION_STAGE_META[feature.integration].label}
        </span>
      )}
    </ActionGroup>
  );
}
