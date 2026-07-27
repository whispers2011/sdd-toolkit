/**
 * Leichtgewichtige SVG-/Div-Chart-Primitives für das Läufe-Dashboard —
 * bewusst ohne Chart-Library (Tailwind-Stil, dark theme).
 */

export interface Segment {
  label: string;
  value: number;
  color: string;
}

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
export function HBarChart({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 truncate text-right text-zinc-400">{i.label}</span>
          <div className="h-4 flex-1 rounded-sm bg-zinc-900">
            <div
              className="flex h-4 items-center rounded-sm pl-1.5"
              style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%`, backgroundColor: i.color }}
            >
              <span className="whitespace-nowrap text-[10px] font-medium text-black/70">{fmtTokens(i.value)}</span>
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && <span className="text-xs text-zinc-600">Keine Daten.</span>}
    </div>
  );
}

/** Gestapelter 100%-Balken (z. B. Token-Komposition input/output/cache). */
export function StackedBar({ segments, height = 10 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <div className="h-2.5 rounded-sm bg-zinc-900" />;
  return (
    <div className="flex w-full overflow-hidden rounded-sm" style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${fmtTokens(s.value)} (${((s.value / total) * 100).toFixed(1)} %)`}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={14} />
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
                  stroke={s.color}
                  strokeWidth={14}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return el;
            })}
      </svg>
      <div className="flex flex-col gap-1 text-[11px]">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-zinc-400">{s.label}</span>
            <span className="text-zinc-300">{fmtTokens(s.value)}</span>
            <span className="text-zinc-600">
              {total > 0 ? `${((s.value / total) * 100).toFixed(0)} %` : '–'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
