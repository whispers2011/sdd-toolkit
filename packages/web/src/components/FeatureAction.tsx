import { createContext, useCallback, useContext, useId, useRef, type ReactNode } from 'react';
import type { ActionVerdict } from '@sdd/shared';
import { useStore } from '../store.js';

/**
 * Darstellung der Aktions-Policy (FR-009/FR-028/SC-006).
 *
 * Die Komponenten enthalten KEINE eigene Bedingung — sie rendern ausschließlich
 * den Befund aus `evaluateAction`. Gesperrte Schaltflächen bleiben sichtbar und
 * fokussierbar (`aria-disabled` statt `disabled`), der Grund steht dauerhaft als
 * Satz bei der Gruppe — kein Tooltip, kein Hover (auf Touch gibt es keinen).
 */

/** id des Grund-Elements der umgebenden Gruppe; null = kein Grund sichtbar. */
const ReasonContext = createContext<string | null>(null);

/** Der erste vorliegende Sperrgrund einer Aktionsgruppe (ausgeblendete zählen nicht). */
export function blockedReason(...verdicts: (ActionVerdict | null | undefined)[]): string | null {
  for (const v of verdicts) {
    if (v && v.availability === 'blocked' && v.reason) return v.reason;
  }
  return null;
}

/**
 * Aktionsgruppe mit dauerhaft sichtbarem Grundsatz. Der Grund wird per
 * `aria-describedby` an die gesperrten Schaltflächen der Gruppe gebunden.
 */
export function ActionGroup({
  reason,
  className = '',
  actionsClassName = 'flex flex-wrap items-center gap-1',
  children,
}: {
  reason?: string | null;
  className?: string;
  actionsClassName?: string;
  children: ReactNode;
}) {
  const uid = useId();
  const reasonId = `reason-${uid}`;
  return (
    <ReasonContext.Provider value={reason ? reasonId : null}>
      <div className={className}>
        <div className={actionsClassName}>{children}</div>
        {reason && (
          <p id={reasonId} className="mt-1 text-xs text-zinc-500">
            {reason}
          </p>
        )}
      </div>
    </ReasonContext.Provider>
  );
}

/**
 * Eine Aktion. `hidden` rendert nichts, `blocked` rendert sichtbar und
 * fokussierbar, verwirft den Klick aber wirkungslos.
 */
export function ActionButton({
  verdict,
  onClick,
  className = '',
  children,
}: {
  verdict: ActionVerdict;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const reasonId = useContext(ReasonContext);
  if (verdict.availability === 'hidden') return null;
  const isBlocked = verdict.availability === 'blocked';
  return (
    <button
      type="button"
      aria-disabled={isBlocked || undefined}
      aria-describedby={isBlocked && reasonId ? reasonId : undefined}
      onClick={(e) => {
        if (isBlocked) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
      className={`${className}${isBlocked ? ' cursor-not-allowed opacity-50' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * Auslöser mit Doppelklick-Schutz (FR-010): ein zweiter Aufruf derselben Aktion
 * während eines laufenden Aufrufs wird STILL verworfen — keine Fehlermeldung,
 * keine zweite Anfrage. Fehler landen wie gewohnt im globalen Fehlerkanal.
 */
export function useAction(): (key: string, fn: () => Promise<unknown>) => void {
  const { dispatch } = useStore();
  const inFlight = useRef(new Set<string>());
  return useCallback(
    (key: string, fn: () => Promise<unknown>) => {
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      void fn()
        .catch((e: Error) => dispatch({ type: 'error', message: e.message }))
        .finally(() => inFlight.current.delete(key));
    },
    [dispatch],
  );
}
