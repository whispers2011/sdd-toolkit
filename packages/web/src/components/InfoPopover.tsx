import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoIcon } from './icons.js';

/**
 * Abrufbare Erklärung hinter einem unauffälligen ⓘ — die EINE Mechanik, hinter die
 * in der Workflow-Ansicht jeder Erklär-Fließtext wandert.
 *
 * Abgrenzung zum globalen `TooltipLayer`: der bleibt für kurze Hover-Hinweise
 * zuständig (Statuspunkt, „optional"-Marke, Chip-Titel). Hier geht es um Inhalte,
 * die gelesen werden wollen — deshalb Klick statt Hover (Hover ist auf Touch nicht
 * bedienbar), eigener Scrollbereich und Fokusrückgabe (FR-028).
 *
 * Das Panel hängt per Portal an `document.body` und positioniert sich `fixed`: der
 * Fluss der Ansicht liegt in einem `overflow-auto`-Container, der ein inline
 * gerendertes Panel abschneiden würde.
 */
export function InfoPopover({
  label,
  children,
  className,
}: {
  /** Kurzer Titel im Panelkopf — benennt, was erklärt wird. Auch `aria-label` des Auslösers. */
  label: string;
  /** Panelinhalt. Beliebige Knoten, damit Felder strukturiert bleiben können. */
  children: ReactNode;
  /** Optische Größe/Ton des Auslösers, Vorgabe: unauffällig. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** `restoreFocus` nur bei Tastatur-/Auslöser-getriebenem Schließen — ein Klick
   *  daneben soll den Fokus dort lassen, wohin der Nutzer geklickt hat. */
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) btnRef.current?.focus();
  }, []);

  // Platzierung: unter dem Auslöser; kippt nach oben, wenn unten kein Platz ist,
  // und wird in beiden Achsen am Viewport geklemmt. Erst nach dem Messen sichtbar.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const r = btn.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const GAP = 6;
      const M = 8;

      let top = r.bottom + GAP;
      if (top + ph > window.innerHeight - M && r.top - GAP - ph > M) top = r.top - GAP - ph;
      top = Math.max(M, Math.min(top, window.innerHeight - ph - M));

      let left = r.left;
      left = Math.min(left, window.innerWidth - pw - M);
      left = Math.max(M, left);

      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const isInside = (t: EventTarget | null) =>
      t instanceof Node && (panelRef.current?.contains(t) || btnRef.current?.contains(t));

    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) close(false);
    };
    // Scrollen IM Panel darf nicht schließen — sonst ist langer Text unlesbar.
    const onScroll = (e: Event) => {
      if (!isInside(e.target)) close(false);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isInside(e.target)) close(false);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [open, close]);

  return (
    <>
      {/* Ein echter <button>: damit öffnen Klick, Enter UND Space ohne eigenen
          Tastatur-Code, und Touch funktioniert ohne Hover. */}
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close(true) : setOpen(true))}
        className={`inline-flex shrink-0 items-center rounded text-zinc-600 hover:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-sky-600 ${
          open ? 'text-sky-400' : ''
        } ${className ?? ''}`}
      >
        <InfoIcon />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              maxWidth: '22rem',
              maxHeight: '60vh',
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-50 overflow-y-auto overscroll-contain rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-300 shadow-xl"
          >
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
