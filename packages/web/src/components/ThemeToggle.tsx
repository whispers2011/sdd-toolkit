import { toggleTheme, useTheme } from '../theme.js';
import { MoonIcon, SunIcon } from './icons.js';

/**
 * Light-/Dark-Umschalter (Contract C3): sitzt oben rechts in der Kopfzeile.
 * Das Icon zeigt den AKTIVEN Modus (Mond = Dark, Sonne = Light); der Tooltip
 * nennt das Ziel. Ein Klick wechselt sofort und ohne Neuladen (FR-003).
 */
export function ThemeToggle() {
  const mode = useTheme();
  const target = mode === 'dark' ? 'Light' : 'Dark';
  const label = `Zu ${target}-Mode wechseln`;
  return (
    <button
      onClick={() => toggleTheme()}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      {mode === 'dark' ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
    </button>
  );
}
