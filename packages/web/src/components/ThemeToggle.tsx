import { THEMES, cycleTheme, useTheme, type ThemeId } from '../theme.js';
import { ContrastIcon, MoonIcon, SunIcon } from './icons.js';

const ICONS: Record<ThemeId, typeof MoonIcon> = {
  dark: MoonIcon,
  light: SunIcon,
  'high-contrast': ContrastIcon,
};

/** Reihenfolge des Zyklus (U1.4) — muss zu `cycleTheme()` passen. */
const NEXT: Record<ThemeId, ThemeId> = {
  dark: 'light',
  light: 'high-contrast',
  'high-contrast': 'dark',
};

function labelOf(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

/**
 * Design-Umschalter (Contract C3/U1.4): sitzt oben rechts in der Kopfzeile.
 * Das Icon zeigt das AKTIVE Design; Tooltip und aria-label nennen das nächste.
 * Ein Klick wechselt sofort und ohne Neuladen (FR-022).
 */
export function ThemeToggle() {
  const id = useTheme();
  const Icon = ICONS[id];
  const label = `Zu „${labelOf(NEXT[id])}" wechseln`;
  return (
    <button
      onClick={() => cycleTheme()}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
