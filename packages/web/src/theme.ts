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
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'sdd-theme';

const listeners = new Set<(mode: ThemeMode) => void>();

function isMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark';
}

/** Auflösung: explizite Wahl (localStorage) → Systempräferenz → Dark-Fallback. */
export function resolveInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isMode(stored)) return stored;
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
function readDom(): ThemeMode {
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
  return isMode(attr) ? attr : resolveInitialTheme();
}

let current: ThemeMode = readDom();

function apply(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

// DOM und Zustand angleichen (falls das Modul ohne vorherigen Guard lädt).
apply(current);

export function getTheme(): ThemeMode {
  return current;
}

/** Setzt den Modus: DOM zuerst, dann Persistenz, dann Abonnenten (Contract C1). */
export function setTheme(mode: ThemeMode): void {
  current = mode;
  apply(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* Persistenz best effort */
  }
  for (const cb of listeners) cb(mode);
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Abonniert Moduswechsel (Nicht-CSS-Konsumenten). Gibt Unsubscribe zurück. */
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Liegt eine explizite (persistierte) Nutzerwahl vor? */
function hasExplicitChoice(): boolean {
  try {
    return isMode(localStorage.getItem(STORAGE_KEY));
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
      const mode: ThemeMode = e.matches ? 'dark' : 'light';
      current = mode;
      apply(mode);
      for (const cb of listeners) cb(mode);
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSystemChange);
    }
  } catch {
    /* Systemänderungen ignorieren, wenn matchMedia nicht verfügbar */
  }
}

/** React-Hook: rendert bei Moduswechsel neu. */
export function useTheme(): ThemeMode {
  return useSyncExternalStore(
    (cb) => onThemeChange(() => cb()),
    () => current,
    () => current,
  );
}
