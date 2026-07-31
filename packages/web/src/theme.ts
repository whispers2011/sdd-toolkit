import { useSyncExternalStore } from 'react';

/**
 * Theme-Modul (Contract C1): einzige Quelle der Wahrheit für den aktiven
 * Darstellungsmodus außerhalb von CSS. CSS reagiert rein über `data-theme` am
 * <html>; echte JS-Konsumenten (xterm-Terminal) abonnieren `onThemeChange`.
 *
 * Persistenz: gerätelokal in localStorage unter `sdd-theme` — reiht sich in die
 * übrigen `sdd-*`-Schlüssel des Toolkits ein. Der FOUC-Guard in index.html setzt
 * `data-theme` bereits vor dem ersten Paint; dieses Modul übernimmt diesen Wert
 * als Ausgangszustand.
 */
export type ThemeId = 'light' | 'dark' | 'high-contrast';

/** Auswahlliste für die Oberfläche — Reihenfolge = Anzeigereihenfolge (U6.7). */
export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dunkel' },
  { id: 'light', label: 'Hell' },
  { id: 'high-contrast', label: 'Dunkel, hoher Kontrast' },
];

/** Zyklus des Kopfzeilen-Umschalters (U1.4, research D10). */
const CYCLE: Record<ThemeId, ThemeId> = {
  dark: 'light',
  light: 'high-contrast',
  'high-contrast': 'dark',
};

const STORAGE_KEY = 'sdd-theme';

const listeners = new Set<(id: ThemeId) => void>();

export function isThemeId(v: unknown): v is ThemeId {
  return v === 'light' || v === 'dark' || v === 'high-contrast';
}

/**
 * `color-scheme` steuert die vom Browser gestellten Bedienelemente
 * (Scrollbalken, Formularfelder). Nur `light` ist hell — jedes andere Design
 * ist dunkel (U1.2).
 */
function colorScheme(id: ThemeId): 'light' | 'dark' {
  return id === 'light' ? 'light' : 'dark';
}

/** Auflösung: explizite Wahl (localStorage) → Systempräferenz → Dark-Fallback. */
export function resolveInitialTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* localStorage nicht verfügbar → Systempräferenz prüfen */
  }
  try {
    if (typeof matchMedia !== 'undefined') {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch {
    /* ignorieren → Fallback */
  }
  return 'dark';
}

/** Den vom FOUC-Guard gesetzten data-theme als Wahrheit übernehmen. */
function readDom(): ThemeId {
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
  return isThemeId(attr) ? attr : resolveInitialTheme();
}

let current: ThemeId = readDom();

function apply(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = colorScheme(id);
}

// DOM und Zustand angleichen (falls das Modul ohne vorherigen Guard lädt).
apply(current);

export function getTheme(): ThemeId {
  return current;
}

/** Setzt das Design: DOM zuerst, dann Persistenz, dann Abonnenten (Contract C1). */
export function setTheme(id: ThemeId): void {
  current = id;
  apply(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* Persistenz best effort */
  }
  for (const cb of listeners) cb(id);
}

/**
 * Schaltet durch alle Designs (dark → light → high-contrast → dark).
 *
 * Ersetzt das frühere binäre Umschalten: das hätte einen Nutzer im
 * Kontrast-Design bei jedem Klick unvorhersehbar herausgeworfen und die
 * getroffene Wahl stillschweigend verworfen (research D10).
 */
export function cycleTheme(): ThemeId {
  const next = CYCLE[current];
  setTheme(next);
  return next;
}

/** Abonniert Designwechsel (Nicht-CSS-Konsumenten). Gibt Unsubscribe zurück. */
export function onThemeChange(cb: (id: ThemeId) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Liegt eine explizite (persistierte) Nutzerwahl vor? */
function hasExplicitChoice(): boolean {
  try {
    return isThemeId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

// Laufzeit: einer Änderung der Systempräferenz nur folgen, wenn KEINE explizite
// Wahl vorliegt (FR-010: Nutzerwahl gewinnt). Ohne Persistenz → Quelle bleibt „system".
if (typeof matchMedia !== 'undefined') {
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = (e: MediaQueryListEvent) => {
      if (hasExplicitChoice()) return;
      const id: ThemeId = e.matches ? 'dark' : 'light';
      current = id;
      apply(id);
      for (const cb of listeners) cb(id);
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSystemChange);
    }
  } catch {
    /* Systemänderungen ignorieren, wenn matchMedia nicht verfügbar */
  }
}

/** React-Hook: rendert bei Designwechsel neu. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (cb) => onThemeChange(() => cb()),
    () => current,
    () => current,
  );
}
