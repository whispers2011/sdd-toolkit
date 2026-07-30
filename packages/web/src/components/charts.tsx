/**
 * Leichtgewichtige SVG-/Div-Chart-Primitives für das Läufe-Dashboard —
 * bewusst ohne Chart-Library (Tailwind-Stil).
 */

/**
 * Fläche + Ring einer Bedeutung, als **vollständig ausgeschriebene**
 * Tailwind-Klassen. Kein Hex und kein `style={{ backgroundColor }}`: nur so
 * folgen die Diagramme dem Moduswechsel, der über `var(--color-…)` läuft.
 * Ausgeschrieben, weil der Tailwind-Scanner Template-Strings nicht findet.
 */
export interface ChartTone {
  bg: string;
  stroke: string;
}

export interface Segment {
  label: string;
  value: number;
  tone: ChartTone;
}

/** Stufen nach der Messregel aus research.md D6 (Grafikfläche ≥ 3:1 in beiden Modi). */
export const CHART_TONES = {
  spec: { bg: 'bg-sky-400', stroke: 'stroke-sky-400' },
  coding: { bg: 'bg-emerald-400', stroke: 'stroke-emerald-400' },
  overhead: { bg: 'bg-amber-300', stroke: 'stroke-amber-300' },
  chat: { bg: 'bg-violet-400', stroke: 'stroke-violet-400' },
  input: { bg: 'bg-sky-400', stroke: 'stroke-sky-400' },
  output: { bg: 'bg-emerald-400', stroke: 'stroke-emerald-400' },
  cacheRead: { bg: 'bg-zinc-500', stroke: 'stroke-zinc-500' },
  cacheWrite: { bg: 'bg-amber-300', stroke: 'stroke-amber-300' },
  track: { bg: 'bg-zinc-800', stroke: 'stroke-zinc-800' },
} satisfies Record<string, ChartTone>;

const nf = new Intl.NumberFormat('de-CH');

/** Tokens kompakt: 1234 → 1.2k, 2500000 → 2.5M. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return nf.format(n);
}

/**
 * Von der CLI gemeldeter Betrag (Mikro-USD → USD). Wird ausschliesslich auf
 * gemeldete Beträge angewendet — es gibt im Toolkit keine Preistabelle und
 * damit auch keinen geschätzten Betrag (FR-022).
 */
export function fmtCost(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Horizontales Balkendiagramm: ein Balken pro Eintrag, skaliert aufs Maximum. */
export function HBarChart({ items }: { items: { label: string; value: number; tone: ChartTone }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-right text-zinc-400">{i.label}</span>
          <div className={`h-4 flex-1 rounded-sm ${CHART_TONES.track.bg}`}>
            <div
              className={`h-4 rounded-sm ${i.tone.bg}`}
              style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%` }}
            />
          </div>
          {/* Der Zahlenwert steht neben dem Balken, nicht darin: im Balken war er bei
              kurzen Balken abgeschnitten und musste sich gegen die Balkenfarbe
              behaupten (D10, FR-020). */}
          <span className="w-14 shrink-0 text-right text-xs text-zinc-300">{fmtTokens(i.value)}</span>
        </div>
      ))}
      {items.length === 0 && <span className="text-xs text-zinc-400">Keine Daten.</span>}
    </div>
  );
}

/** Gestapelter 100%-Balken (z. B. Token-Komposition input/output/cache). */
export function StackedBar({ segments, height = 10 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <div className={`h-2.5 rounded-sm ${CHART_TONES.track.bg}`} />;
  return (
    <div className="flex w-full overflow-hidden rounded-sm" style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            className={s.tone.bg}
            title={`${s.label}: ${fmtTokens(s.value)} (${((s.value / total) * 100).toFixed(1)} %)`}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

/** Donut-Diagramm mit Legende (Kategorie-Verteilung). */
export function Donut({ segments, size = 120 }: { segments: Segment[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={CHART_TONES.track.stroke} strokeWidth={14} />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const frac = s.value / total;
              const dash = frac * c;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  className={s.tone.stroke}
                  strokeWidth={14}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return el;
            })}
      </svg>
      <div className="flex flex-col gap-1 text-xs">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.tone.bg}`} />
            <span className="text-zinc-400">{s.label}</span>
            <span className="text-zinc-300">{fmtTokens(s.value)}</span>
            <span className="text-zinc-400">
              {total > 0 ? `${((s.value / total) * 100).toFixed(0)} %` : '–'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
