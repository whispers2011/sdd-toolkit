import type { ITheme } from '@xterm/xterm';
import type { ThemeMode } from './theme.js';

/**
 * Vollständige xterm-Paletten je Modus (Contract C5). Zuvor setzte TerminalPane
 * nur background/foreground/cursor und xterm fiel auf seine Default-ANSI-Palette
 * zurück — deren „black"/dim kollidierte mit dem dunklen Hintergrund und machte
 * Claudes Rückfragen unlesbar (FR-005). Kernregel hier: KEINE ANSI-Farbe
 * (insb. black/brightBlack im Dark-, white/brightWhite im Light-Modus) darf mit
 * `background` kollidieren.
 */

const dark: ITheme = {
  background: '#09090b',
  foreground: '#d4d4d8',
  cursor: '#a1a1aa',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(113,113,122,0.4)',
  // ANSI: „black" bewusst als sichtbares Grau (nicht ≈ Hintergrund).
  black: '#52525b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f4f4f5',
};

const light: ITheme = {
  background: '#fafafa',
  foreground: '#27272a',
  cursor: '#3f3f46',
  cursorAccent: '#fafafa',
  selectionBackground: 'rgba(100,116,139,0.3)',
  // ANSI: dunkel genug für hellen Grund. „white"/„brightWhite" bewusst als
  // Grau/Dunkel (nicht ≈ Hintergrund), damit nichts hell-auf-hell verschwindet.
  black: '#27272a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#a16207',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#52525b',
  brightBlack: '#3f3f46',
  brightRed: '#b91c1c',
  brightGreen: '#15803d',
  brightYellow: '#854d0e',
  brightBlue: '#1d4ed8',
  brightMagenta: '#7e22ce',
  brightCyan: '#0e7490',
  brightWhite: '#18181b',
};

export function terminalTheme(mode: ThemeMode): ITheme {
  return mode === 'light' ? light : dark;
}
