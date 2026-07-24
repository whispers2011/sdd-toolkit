import { useState } from 'react';
import { FEATURE_PHASES, type FeaturePhase } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { TerminalPane } from './TerminalPane.js';
import { VoiceButton } from './VoiceButton.js';
import { FeatureKnowledgeSelect } from './FeatureKnowledgeSelect.js';
import { FeatureAgentSelect } from './FeatureAgentSelect.js';
import { KnowledgeIcon } from './icons.js';
import { ConfirmDialog } from './Sidebar.js';
import { FeatureDashboard } from './FeatureDashboard.js';

/** Konsole pro Feature: Header + Phasen-Leiste + Terminal. */
export function FeatureConsole({ featureId }: { featureId: string }) {
  const { state, dispatch } = useStore();
  const [connected, setConnected] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);

  if (!feature) return <div className="p-8 text-zinc-500">Feature nicht gefunden.</div>;

  const runningPhase = FEATURE_PHASES.find((p) => feature.phases[p]?.status === 'running');
  // Abgeschlossen (gemergt/archiviert) → keine neue Session mehr; statt Terminal ein
  // Ergebnis-Dashboard (Artefakte, Token-Statistik, Logs).
  const completed = feature.integration === 'merged' || !!feature.archivedAt;

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
        <div className="ml-auto flex items-center gap-1">
          <HeaderIcon title="Im Finder öffnen" onClick={() => void api.openFeature(featureId, 'finder')}>📂</HeaderIcon>
          <HeaderIcon title="Im Editor öffnen" onClick={() => void api.openFeature(featureId, 'editor')}>⌨</HeaderIcon>
          <HeaderIcon title="Projektwissen für dieses Feature" onClick={() => setShowKnowledge(true)}><KnowledgeIcon /></HeaderIcon>
          <HeaderIcon title="Agents für dieses Feature" onClick={() => setShowAgents(true)}>⚖</HeaderIcon>
          <HeaderIcon
            title="Worktree-Pfad kopieren"
            onClick={() => feature.worktreePath && void navigator.clipboard.writeText(feature.worktreePath)}
          >
            📋
          </HeaderIcon>
          <HeaderIcon title="Feature löschen (Worktree + alle Spuren entfernen)" onClick={() => setShowDelete(true)}>
            🗑
          </HeaderIcon>
        </div>
        <span className="text-xs text-zinc-500">
          {completed ? 'abgeschlossen ✓' : connected ? 'verbunden' : 'getrennt …'}
        </span>
      </div>
      {showKnowledge && <FeatureKnowledgeSelect featureId={featureId} onClose={() => setShowKnowledge(false)} />}
      {showAgents && <FeatureAgentSelect featureId={featureId} onClose={() => setShowAgents(false)} />}
      {showDelete && (
        <ConfirmDialog
          title="Feature löschen?"
          message={`„${feature.name}" wird endgültig gelöscht: Worktree, Branch, Läufe, Logs und alle Spuren werden entfernt. Das kann nicht rückgängig gemacht werden.`}
          confirmLabel="Endgültig löschen"
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
          <PhaseStrip featureId={featureId} runningPhase={runningPhase ?? null} />

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
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} className="rounded px-1.5 py-0.5 text-base leading-none text-zinc-300 hover:bg-zinc-800">
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

/** Phasen-Leiste über der Konsole: Status + Aktion pro Phase. */
function PhaseStrip({ featureId, runningPhase }: { featureId: string; runningPhase: FeaturePhase | null }) {
  const { state, dispatch } = useStore();
  const feature = state.app?.features.find((f) => f.id === featureId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);
  if (!feature) return null;

  const call = (fn: () => Promise<unknown>) =>
    fn().catch((e: Error) => {
      // Doppel-Start („läuft bereits") ist harmlos — nicht als Fehler anzeigen.
      if (/läuft bereits/i.test(e.message)) return;
      dispatch({ type: 'error', message: e.message });
    });

  const live = !!session && (session.status === 'working' || session.status === 'awaiting_input');

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-4 py-1.5">
      {FEATURE_PHASES.filter((p) => feature.phases[p]).map((phase) => {
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
        return (
          <button
            key={phase}
            disabled={runningPhase !== null || (ps.status === 'idle' && live)}
            title={
              ps.status === 'idle'
                ? live
                  ? 'Session ist beschäftigt — läuft gerade'
                  : `/speckit.${phase} starten`
                : ps.status === 'awaiting_review'
                  ? 'Klick = approven'
                  : ps.status === 'running'
                    ? live
                      ? 'läuft …'
                      : 'wird gestartet …'
                    : ps.status
            }
            onClick={() => {
              if (ps.status === 'idle') void call(() => api.startPhase(featureId, phase));
              else if (ps.status === 'awaiting_review') void call(() => api.approvePhase(featureId, phase));
            }}
            className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap disabled:opacity-60 ${cls} ${ps.stale ? 'line-through' : ''}`}
          >
            {ps.status === 'approved' ? '✓ ' : ''}
            {phase}
          </button>
        );
      })}
      {state.gateRunning[featureId] && (
        <span
          className="animate-pulse rounded border border-violet-800 px-2 py-0.5 text-xs whitespace-nowrap text-violet-300"
          title="Ein Qualitäts-Gate (Agent) läuft — Start/Fortschritt folgt nach PASS"
        >
          ⚖ Gate läuft …
        </span>
      )}
      <span className="mx-2 text-zinc-700">|</span>
      {feature.integration === 'none' ? (
        <button
          onClick={() => void call(() => api.integrate(featureId))}
          className="rounded border border-sky-900 px-2 py-0.5 text-xs whitespace-nowrap text-sky-400 hover:border-sky-700"
        >
          ⇥ Integrieren
        </button>
      ) : (
        <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-sky-400">{feature.integration}</span>
      )}
    </div>
  );
}
