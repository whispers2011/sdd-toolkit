import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  JiraConnectionStatus,
  JiraImportResult,
  JiraIssueSummary,
  JiraProject,
  JiraSelection,
  JiraSite,
  JiraSprint,
} from '@sdd/shared';
import { api, JiraApiError } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog, Dialog } from './Sidebar.js';

type SprintSelection = number | 'backlog';

interface LoadError {
  step: 'sites' | 'projects' | 'sprints' | 'issues' | 'import';
  message: string;
  reauth: boolean;
}

/**
 * „Aus Jira importieren" (US2/US3): Kaskade Site → Projekt → Sprint (bzw.
 * Backlog-Sicht), Ticketliste mit Mehrfachauswahl und Import in das aktuelle
 * Toolkit-Projekt. Letzte Auswahl wird vorbelegt (FR-009); bereits übernommene
 * Tickets sind markiert und verlangen vor Re-Import eine Bestätigung (FR-010/FR-014).
 */
export function JiraImportDialog({
  projectId,
  onClose,
  onOpenSettings,
}: {
  projectId: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { dispatch } = useStore();
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null);
  const [sites, setSites] = useState<JiraSite[] | null>(null);
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [sprints, setSprints] = useState<JiraSprint[] | null>(null);
  const [issues, setIssues] = useState<JiraIssueSummary[] | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [sprintSel, setSprintSel] = useState<SprintSelection | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<LoadError | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<JiraImportResult[] | null>(null);
  const [confirmReimport, setConfirmReimport] = useState<string[] | null>(null);
  /** „Erneut versuchen": Zähler triggert die Lade-Effekte neu (String-States wären wertgleich). */
  const [attempt, setAttempt] = useState(0);
  /** Gemerkte letzte Auswahl — nur für die Erst-Vorbelegung der Kaskade (FR-009). */
  const remembered = useRef<{ siteId?: string; projectKey?: string; sprintId?: number }>({});
  const closedRef = useRef(false);

  const fail = useCallback((step: LoadError['step'], e: unknown) => {
    const reauth = e instanceof JiraApiError && e.status === 401;
    setError({ step, message: (e as Error).message, reauth });
  }, []);

  // Verbindungsstatus laden + überwachen: Trennen bei offenem Dialog →
  // Rückfall in den unverbundenen Zustand ohne Datenverlust (Edge Case, T024).
  useEffect(() => {
    closedRef.current = false;
    const check = () =>
      api
        .jiraStatus()
        .then((s) => {
          if (!closedRef.current) setStatus(s);
        })
        .catch(() => {});
    void check();
    const interval = setInterval(() => void check(), 5000);
    return () => {
      closedRef.current = true;
      clearInterval(interval);
    };
  }, []);

  const connected = status?.state === 'connected';

  // Nach Verbindung: letzte Auswahl + Sites laden (FR-006/FR-009).
  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        const [selection, siteList] = await Promise.all([
          api.getJiraSelection().catch((): JiraSelection => ({})),
          api.jiraSites(),
        ]);
        if (closedRef.current) return;
        remembered.current = selection;
        setSites(siteList);
        const preselect =
          siteList.find((s) => s.id === selection.siteId)?.id ??
          (siteList.length === 1 ? siteList[0]!.id : null);
        if (preselect) setSiteId(preselect);
      } catch (e) {
        fail('sites', e);
      }
    })();
  }, [connected, attempt, fail]);

  // Site gewählt → Projekte laden.
  useEffect(() => {
    if (!siteId) return;
    setProjects(null);
    setProjectKey(null);
    setSprints(null);
    setSprintSel(null);
    setIssues(null);
    setSelected(new Set());
    void api
      .jiraProjects(siteId)
      .then((list) => {
        if (closedRef.current) return;
        setProjects(list);
        const rememberedKey = remembered.current.projectKey;
        delete remembered.current.projectKey;
        if (rememberedKey && list.some((p) => p.key === rememberedKey)) setProjectKey(rememberedKey);
      })
      .catch((e: unknown) => fail('projects', e));
  }, [siteId, attempt, fail]);

  // Projekt gewählt → Sprints laden; ohne Sprints automatische Backlog-Sicht (FR-008).
  useEffect(() => {
    if (!siteId || !projectKey) return;
    setSprints(null);
    setSprintSel(null);
    setIssues(null);
    setSelected(new Set());
    void api
      .jiraSprints(siteId, projectKey)
      .then((list) => {
        if (closedRef.current) return;
        setSprints(list);
        if (list.length === 0) {
          setSprintSel('backlog');
          return;
        }
        const rememberedSprint = remembered.current.sprintId;
        delete remembered.current.sprintId;
        const preselect = list.find((s) => s.id === rememberedSprint)?.id ?? list[0]!.id;
        setSprintSel(preselect);
      })
      .catch((e: unknown) => fail('sprints', e));
  }, [siteId, projectKey, attempt, fail]);

  // Sprint/Backlog gewählt → Tickets laden; Auswahl beim Kontextwechsel zurücksetzen (Edge Case).
  useEffect(() => {
    if (!siteId || !projectKey || sprintSel === null) return;
    setIssues(null);
    setSelected(new Set());
    const sprintId = sprintSel === 'backlog' ? undefined : sprintSel;
    void api
      .jiraIssues(siteId, projectKey, sprintId, projectId)
      .then((list) => {
        if (!closedRef.current) setIssues(list);
      })
      .catch((e: unknown) => fail('issues', e));
    // Letzte Auswahl persistieren (FR-009).
    void api
      .saveJiraSelection({
        siteId,
        projectKey,
        ...(sprintId !== undefined ? { sprintId } : {}),
      })
      .catch(() => {});
  }, [siteId, projectKey, sprintSel, projectId, attempt, fail]);

  const retry = () => {
    // Aktuelle Auswahl merken: die Kaskade lädt neu und belegt sie wieder vor.
    remembered.current = {
      ...(siteId ? { siteId } : {}),
      ...(projectKey ? { projectKey } : {}),
      ...(typeof sprintSel === 'number' ? { sprintId: sprintSel } : {}),
    };
    setError(null);
    setAttempt((a) => a + 1);
  };

  const toggle = (key: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startImport = (confirmedReimports: string[]) => {
    if (!siteId) return;
    setImporting(true);
    setError(null);
    void api
      .jiraImport(projectId, { siteId, issueKeys: [...selected], confirmedReimports })
      .then((res) => {
        if (closedRef.current) return;
        setResults(res);
        setSelected(new Set());
        // imported-Kennzeichnung auffrischen (FR-010).
        if (projectKey && sprintSel !== null) {
          void api
            .jiraIssues(siteId, projectKey, sprintSel === 'backlog' ? undefined : sprintSel, projectId)
            .then((list) => !closedRef.current && setIssues(list))
            .catch(() => {});
        }
      })
      .catch((e: unknown) => fail('import', e))
      .finally(() => !closedRef.current && setImporting(false));
  };

  const submitImport = () => {
    const alreadyImported = (issues ?? []).filter((i) => selected.has(i.key) && i.imported).map((i) => i.key);
    if (alreadyImported.length > 0) setConfirmReimport(alreadyImported);
    else startImport([]);
  };

  const openConsole = (featureId: string) => {
    dispatch({ type: 'set_view', view: { kind: 'console', featureId } });
    onClose();
  };

  return (
    <Dialog title="Aus Jira importieren" onClose={onClose}>
      <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
        {status === null ? (
          <p className="py-4 text-sm text-zinc-500">Verbindungsstatus wird geprüft …</p>
        ) : !connected ? (
          <NotConnected state={status.state} onOpenSettings={onOpenSettings} />
        ) : results ? (
          <ImportResults results={results} onOpenConsole={openConsole} onBack={() => setResults(null)} />
        ) : (
          <>
            {error && (
              <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                <p>{error.message}</p>
                <div className="mt-1.5 flex gap-2">
                  {error.reauth ? (
                    <button onClick={onOpenSettings} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700">
                      Zu den Jira-Einstellungen
                    </button>
                  ) : (
                    <button onClick={retry} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700">
                      Erneut versuchen
                    </button>
                  )}
                </div>
              </div>
            )}

            <CascadeSelect
              label="Site"
              value={siteId}
              options={(sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.url})` }))}
              loading={connected && sites === null}
              onChange={(v) => setSiteId(v)}
            />
            {siteId && (
              <CascadeSelect
                label="Projekt"
                value={projectKey}
                options={(projects ?? []).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` }))}
                loading={projects === null}
                onChange={(v) => setProjectKey(v)}
              />
            )}
            {projectKey && sprints !== null && sprints.length > 0 && (
              <CascadeSelect
                label="Sprint (aktive + zukünftige, alle Boards)"
                value={sprintSel === null ? null : String(sprintSel)}
                options={[
                  ...sprints.map((s) => ({ value: String(s.id), label: sprintLabel(s) })),
                  { value: 'backlog', label: 'Gesamtes Projekt (Backlog-Sicht)' },
                ]}
                loading={false}
                onChange={(v) => setSprintSel(v === 'backlog' ? 'backlog' : Number(v))}
              />
            )}
            {projectKey && sprints === null && !error && (
              <p className="text-xs text-zinc-500">Sprints werden geladen …</p>
            )}
            {projectKey && sprints !== null && sprints.length === 0 && (
              <p className="text-xs text-zinc-500">
                Dieses Projekt hat keine aktiven oder zukünftigen Sprints — Tickets auf Projektebene (Backlog-Sicht).
              </p>
            )}

            {sprintSel !== null && (
              <IssueList issues={issues} selected={selected} onToggle={toggle} />
            )}

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
              <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
                Abbrechen
              </button>
              <button
                onClick={submitImport}
                disabled={selected.size === 0 || importing}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-40"
              >
                {importing ? 'Übernahme läuft …' : `Übernehmen (${selected.size})`}
              </button>
            </div>
          </>
        )}
      </div>

      {confirmReimport && (
        <ConfirmDialog
          title="Bereits übernommene Tickets erneut importieren?"
          message={`Diese Tickets wurden bereits als Feature übernommen:\n\n${confirmReimport.join(', ')}\n\nEine erneute Übernahme erzeugt jeweils ein weiteres, unabhängiges Feature.`}
          confirmLabel="Erneut übernehmen"
          onConfirm={() => startImport(confirmReimport)}
          onClose={() => setConfirmReimport(null)}
        />
      )}
    </Dialog>
  );
}

function NotConnected({ state, onOpenSettings }: { state: JiraConnectionStatus['state']; onOpenSettings: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
        {state === 'reauth_required'
          ? 'Die Jira-Autorisierung ist abgelaufen. Bitte in den Benutzereinstellungen erneut autorisieren.'
          : state === 'connecting'
            ? 'Die Jira-Verbindung wird gerade eingerichtet — bitte die Freigabe im Browser abschließen.'
            : 'Keine Jira-Verbindung. Bitte zuerst in den Benutzereinstellungen mit Jira verbinden.'}
      </div>
      <button
        onClick={onOpenSettings}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600"
      >
        Zu den Jira-Einstellungen
      </button>
    </div>
  );
}

function CascadeSelect({
  label,
  value,
  options,
  loading,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      {loading ? (
        <p className="text-xs text-zinc-500">Wird geladen …</p>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
        >
          <option value="" disabled>
            Bitte wählen …
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function sprintLabel(s: JiraSprint): string {
  const range = s.startDate ? ` · ab ${s.startDate.slice(0, 10)}` : '';
  return `${s.name} (${s.state === 'active' ? 'aktiv' : 'zukünftig'}${range})`;
}

function IssueList({
  issues,
  selected,
  onToggle,
}: {
  issues: JiraIssueSummary[] | null;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (issues === null) return <p className="text-xs text-zinc-500">Tickets werden geladen …</p>;
  if (issues.length === 0) {
    return (
      <p className="rounded border border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
        Keine Tickets in dieser Auswahl — anderer Sprint oder Backlog-Sicht könnte Tickets enthalten.
      </p>
    );
  }
  return (
    <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded border border-zinc-800 p-1">
      {issues.map((issue) => (
        <li key={issue.key}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900">
            <input
              type="checkbox"
              checked={selected.has(issue.key)}
              onChange={() => onToggle(issue.key)}
              className="accent-emerald-600"
            />
            <span className="shrink-0 font-mono text-xs text-sky-400">{issue.key}</span>
            <span className="truncate text-sm text-zinc-300" title={issue.title}>
              {issue.title}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {issue.imported && (
                <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400" title="Bereits als Feature übernommen">
                  bereits übernommen
                </span>
              )}
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{issue.type}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{issue.status}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function ImportResults({
  results,
  onOpenConsole,
  onBack,
}: {
  results: JiraImportResult[];
  onOpenConsole: (featureId: string) => void;
  onBack: () => void;
}) {
  const created = results.filter((r) => r.status === 'created').length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-300">
        Übernahme abgeschlossen: {created} von {results.length} Ticket{results.length === 1 ? '' : 's'} als Feature angelegt.
      </p>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {results.map((r) => (
          <li key={r.issueKey} className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1.5 text-sm">
            <span className="shrink-0 font-mono text-xs text-sky-400">{r.issueKey}</span>
            {r.status === 'created' ? (
              <>
                <span className="text-emerald-400">✓ Feature angelegt</span>
                {r.featureId && (
                  <button
                    onClick={() => onOpenConsole(r.featureId!)}
                    className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    Konsole öffnen
                  </button>
                )}
              </>
            ) : r.status === 'skipped_duplicate' ? (
              <span className="text-zinc-500">übersprungen — bereits übernommen (keine Bestätigung)</span>
            ) : (
              <span className="truncate text-red-400" title={r.error}>
                ✕ fehlgeschlagen: {r.error}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
        <button onClick={onBack} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
          Zurück zur Ticketliste
        </button>
      </div>
    </div>
  );
}
