import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONSOLE_PALETTES, type ConsolePalette } from './terminalTheme.js';
import { THEMES, isThemeId, type ThemeId } from './theme.js';

/**
 * Verträge des Farbdesigns (FR-023 … FR-028, SC-007/SC-009).
 *
 * Geprüft werden web-eigene Artefakte — `index.css`, `terminalTheme.ts` und
 * `index.html` —, deshalb liegt dieser Test hier und nicht in `@sdd/shared`.
 *
 * Grundregel: NIE gegen eine Zahl prüfen (E4). Der Light-Block ist der
 * Referenz-Schlüsselsatz; jedes weitere Design wird gegen IHN verglichen. Eine
 * gemeinsame Erweiterung beider Blöcke bleibt damit grün, ein einseitig
 * vergessener Schlüssel wird rot — auch in zehn Jahren mit ganz anderen Skalen.
 */

const CSS = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Alle `--color-*`-Schlüssel eines `:root[data-theme='…']`-Blocks. */
function themeBlockKeys(theme: string): string[] {
  const marker = `:root[data-theme='${theme}']`;
  const start = CSS.indexOf(marker);
  expect(start, `Design-Block nicht gefunden: ${theme}`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  expect(close, `Design-Block nicht geschlossen: ${theme}`).toBeGreaterThan(open);
  // Kommentare zuerst entfernen: ein auskommentierter Schlüssel ist NICHT
  // gesetzt und darf die Parität nicht vortäuschen (Gegenprobe zu SC-007).
  const body = CSS.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...body.matchAll(/--color-[\w-]+(?=\s*:)/g)].map((m) => m[0]).sort();
}

/** Designs mit eigenem CSS-Block. `dark` ist die Tailwind-Basis und hat keinen. */
const CSS_THEMES: ThemeId[] = ['light', 'high-contrast'];

describe('Schlüsselsatz-Parität der Design-Blöcke (FR-023/FR-024, SC-007)', () => {
  const referenz = themeBlockKeys('light');

  it('der Referenz-Block ist nicht leer und deckt alle erwarteten Skalen ab', () => {
    expect(referenz.length).toBeGreaterThan(0);
    for (const skala of ['zinc', 'emerald', 'amber', 'red', 'sky']) {
      expect(referenz.some((k) => k.startsWith(`--color-${skala}-`)), skala).toBe(true);
    }
    // Die projekteigene Zwischenstufe darf nicht durchrutschen.
    expect(referenz).toContain('--color-zinc-925');
  });

  it.each(CSS_THEMES)('Design „%s" legt genau den Referenz-Schlüsselsatz fest', (theme) => {
    const keys = themeBlockKeys(theme);

    // Fehlender Schlüssel: die Meldung nennt Design UND Schlüsselnamen (FR-024).
    const fehlend = referenz.filter((k) => !keys.includes(k));
    expect(fehlend, `Design „${theme}" fehlen Farbvariablen: ${fehlend.join(', ')}`).toEqual([]);

    // Umgekehrt genauso: ein nur hier gesetzter Schlüssel fehlt den anderen.
    const zusaetzlich = keys.filter((k) => !referenz.includes(k));
    expect(
      zusaetzlich,
      `Design „${theme}" setzt Farbvariablen, die den übrigen Designs fehlen: ${zusaetzlich.join(', ')}`,
    ).toEqual([]);
  });

  it.each(CSS_THEMES)('Design „%s" legt ein color-scheme fest', (theme) => {
    const marker = `:root[data-theme='${theme}']`;
    const body = CSS.slice(CSS.indexOf(marker), CSS.indexOf('\n}', CSS.indexOf(marker)));
    expect(body).toMatch(/color-scheme:\s*(light|dark)/);
  });

  it('jede ThemeId ausser der Dark-Basis hat einen eigenen CSS-Block (FR-021)', () => {
    for (const { id } of THEMES) {
      if (id === 'dark') continue; // Tailwind-Basis, bewusst ohne Block
      expect(CSS, `Kein CSS-Block für Design „${id}"`).toContain(`:root[data-theme='${id}']`);
    }
  });
});

// ---------- Konsolen-Paletten (FR-025/FR-028, U2) ----------

const PALETTE_KEYS: (keyof ConsolePalette)[] = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

describe('Konsolen-Paletten (FR-025/FR-028, U2)', () => {
  it('jede ThemeId hat eine Palette — keine fällt auf ein fremdes Schema zurück (U2.1)', () => {
    for (const { id } of THEMES) {
      expect(CONSOLE_PALETTES[id], `Keine Konsolen-Palette für Design „${id}"`).toBeDefined();
    }
    expect(Object.keys(CONSOLE_PALETTES).sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it.each(THEMES.map((t) => t.id))('Palette „%s" legt alle 21 Schlüssel fest (U2.2)', (id) => {
    const p = CONSOLE_PALETTES[id];
    const fehlend = PALETTE_KEYS.filter((k) => !p[k]);
    expect(fehlend, `Palette „${id}" fehlen Farben: ${fehlend.join(', ')}`).toEqual([]);
    expect(Object.keys(p).sort()).toEqual([...PALETTE_KEYS].sort());
  });

  it.each(THEMES.map((t) => t.id))(
    'in Palette „%s" gleicht keine Vordergrund-, ANSI- oder Akzentfarbe dem Hintergrund (FR-028)',
    (id) => {
      const p = CONSOLE_PALETTES[id];
      const hintergrund = p.background.toLowerCase();
      // `cursorAccent` ist die Schrift IM Cursor und soll bewusst dem Grund gleichen.
      const kollisionen = PALETTE_KEYS.filter(
        (k) => k !== 'background' && k !== 'cursorAccent' && p[k].toLowerCase() === hintergrund,
      );
      expect(
        kollisionen,
        `Palette „${id}": ${kollisionen.join(', ')} ist nicht vom Hintergrund unterscheidbar`,
      ).toEqual([]);
    },
  );
});

// ---------- FOUC-Guard (FR-026, SC-009) ----------

describe('FOUC-Guard läuft mit ThemeId gleich (FR-026, SC-009)', () => {
  /** Die vom Guard per Gleichheitsvergleich akzeptierten Zeichenketten. */
  function guardAccepted(): string[] {
    const start = HTML.indexOf("localStorage.getItem('sdd-theme')");
    expect(start, 'FOUC-Guard nicht gefunden').toBeGreaterThanOrEqual(0);
    const block = HTML.slice(start, HTML.indexOf('</script>', start));
    return [...block.matchAll(/s === '([^']+)'/g)].map((m) => m[1]!).sort();
  }

  it('akzeptiert genau die drei ThemeId-Werte und keinen weiteren', () => {
    const akzeptiert = guardAccepted();
    expect(akzeptiert).toEqual(THEMES.map((t) => t.id).sort());
    for (const wert of akzeptiert) expect(isThemeId(wert), wert).toBe(true);
  });

  it('setzt data-theme und colorScheme vor dem ersten Paint und fällt auf dark zurück', () => {
    const block = HTML.slice(HTML.indexOf('<script>'), HTML.indexOf('</script>'));
    expect(block).toContain('dataset.theme');
    expect(block).toContain('colorScheme');
    expect(block).toContain("'dark'"); // Rückfall bei Fehler/unbekanntem Wert
    // Der Guard steht im <head>, also vor dem Body und dem Modul-Skript.
    expect(HTML.indexOf('<script>')).toBeLessThan(HTML.indexOf('<body>'));
  });

  it('behandelt nur `light` als helles color-scheme (U1.2)', () => {
    const block = HTML.slice(HTML.indexOf('<script>'), HTML.indexOf('</script>'));
    expect(block).toMatch(/colorScheme\s*=\s*m === 'light' \? 'light' : 'dark'/);
  });
});
