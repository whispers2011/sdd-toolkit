import type { ITheme } from '@xterm/xterm';
import type { ThemeId } from './theme.js';

/**
 * Vollständige xterm-Paletten je Design (Contract C5/U2). Zuvor setzte
 * TerminalPane nur background/foreground/cursor und xterm fiel auf seine
 * Default-ANSI-Palette zurück — deren „black"/dim kollidierte mit dem dunklen
 * Hintergrund und machte Claudes Rückfragen unlesbar. Kernregel hier: KEINE
 * Vordergrund-, ANSI- oder Akzentfarbe darf mit `background` derselben Palette
 * zusammenfallen (FR-028, U2.3) — festgenagelt in themeContract.test.ts.
 *
 * Die Konsole hängt an einem eigenen Farbeintrag, nicht an den CSS-Variablen
 * (E5): xterm rendert auf Canvas und liest kein CSS.
 */
export interface ConsolePalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const dark: ConsolePalette = {
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

const light: ConsolePalette = {
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

/**
 * Hoher Kontrast: schwarzer Grund, reinweisse Schrift, kräftigere ANSI-Farben.
 * „black" bleibt bewusst ein deutlich sichtbares Grau — sonst verschwände
 * dim-Text vollständig auf dem schwarzen Grund.
 */
const highContrast: ConsolePalette = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#ffffff',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(255,255,255,0.35)',
  black: '#6e6e78',
  red: '#ff6b6b',
  green: '#3bff9e',
  yellow: '#ffc319',
  blue: '#45c4ff',
  magenta: '#e79bff',
  cyan: '#3ce7f5',
  white: '#e4e4e7',
  brightBlack: '#9a9aa4',
  brightRed: '#ff9d9d',
  brightGreen: '#8dffc4',
  brightYellow: '#ffe066',
  brightBlue: '#93dbff',
  brightMagenta: '#f2c4ff',
  brightCyan: '#8ff4fb',
  brightWhite: '#ffffff',
};

/**
 * `Record<ThemeId, …>` statt einer Funktion mit Fallback: ein fehlendes Design
 * ist damit ein Übersetzungsfehler, kein stiller Laufzeitrückfall (U2.1).
 */
export const CONSOLE_PALETTES: Record<ThemeId, ConsolePalette> = {
  dark,
  light,
  'high-contrast': highContrast,
};

export function terminalTheme(id: ThemeId): ITheme {
  return CONSOLE_PALETTES[id];
}
