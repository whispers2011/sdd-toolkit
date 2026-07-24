import { useEffect, useRef, useState } from 'react';

/**
 * Globaler, schneller Tooltip-Layer. Native `title`-Tooltips erscheinen erst nach
 * ~1–1,5 s (browserseitig, nicht konfigurierbar) — Nutzer denken, es gäbe keinen.
 * Dieser Layer fängt vorhandene `title`- (und optional `data-tip`-)Attribute app-weit
 * per Event-Delegation ab, unterdrückt das native Tooltip beim Hover (title wird kurz
 * entfernt und beim Verlassen restauriert → bleibt für Screenreader/Focus erhalten)
 * und zeigt stattdessen nach kurzer Verzögerung ein gestyltes Tooltip.
 *
 * Einmal in der App gemountet; keine Änderung an den Aufrufstellen nötig.
 */
const SHOW_DELAY_MS = 1000;

interface TipState {
  text: string;
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  const activeTitle = useRef<string | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // Entferntes `title` wiederherstellen (Focus/Screenreader behalten die Semantik).
    const restore = () => {
      if (activeEl.current && activeTitle.current !== null) {
        activeEl.current.setAttribute('title', activeTitle.current);
      }
      activeEl.current = null;
      activeTitle.current = null;
    };
    const hide = () => {
      clearTimer();
      restore();
      setTip(null);
    };

    const show = (el: HTMLElement, text: string) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const placement: TipState['placement'] = r.top > 48 ? 'top' : 'bottom';
      const centerX = Math.min(Math.max(r.left + r.width / 2, 12), window.innerWidth - 12);
      setTip({
        text,
        left: centerX,
        top: placement === 'top' ? r.top - 6 : r.bottom + 6,
        placement,
      });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // Touch: kein Hover-Tooltip
      const start = e.target as HTMLElement | null;
      const target = start?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (!target || target === activeEl.current) return;
      const text = (target.getAttribute('title') || target.getAttribute('data-tip') || '').trim();
      if (!text) return;

      clearTimer();
      restore();
      activeEl.current = target;
      // Natives Tooltip unterdrücken, Originalwert merken.
      if (target.hasAttribute('title')) {
        activeTitle.current = target.getAttribute('title');
        target.removeAttribute('title');
      } else {
        activeTitle.current = null;
      }
      timer.current = window.setTimeout(() => show(target, text), SHOW_DELAY_MS);
    };

    const onOut = (e: PointerEvent) => {
      const rel = e.relatedTarget as Node | null;
      if (activeEl.current && rel && activeEl.current.contains(rel)) return; // noch im Element
      hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      clearTimer();
      restore();
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-xs rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs leading-snug text-zinc-100 shadow-lg"
      style={{
        left: tip.left,
        top: tip.top,
        transform: tip.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {tip.text}
    </div>
  );
}
