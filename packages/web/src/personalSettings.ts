import { useSyncExternalStore } from 'react';
import { DEFAULT_PERSONAL_SETTINGS, normalizePersonalSettings, type PersonalSettings } from '@sdd/shared';
import { api } from './api.js';

/**
 * Einstellungs-Client (Contract U3) — dasselbe Modulmuster wie `theme.ts`:
 * Modulzustand + Abonnentenmenge + `useSyncExternalStore`.
 *
 * Warum kein React-Context: die Ton-Ebene (`sound.ts`) wird aus dem
 * WS-Handler des Stores heraus aufgerufen, also OHNE React-Kontext. Sie muss
 * synchron an den aktuellen Stand kommen. Vor dem Boot gelten die
 * Standardwerte aus `@sdd/shared` — nie `null`, nie ein Ladezustand (U3.1).
 */
let current: PersonalSettings = DEFAULT_PERSONAL_SETTINGS;

const listeners = new Set<(p: PersonalSettings) => void>();

function emit(next: PersonalSettings): void {
  current = next;
  for (const cb of listeners) cb(next);
}

export function getPersonal(): PersonalSettings {
  return current;
}

export function onPersonalChange(cb: (p: PersonalSettings) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React-Hook: rendert bei Änderung neu. */
export function usePersonal(): PersonalSettings {
  return useSyncExternalStore(
    (cb) => onPersonalChange(() => cb()),
    () => current,
    () => current,
  );
}

/**
 * Übernahme aus dem Boot-Zustand (`GET /api/state`). Wird auch bei jedem
 * Wiederverbinden aufgerufen (U3.2) — ein zwischenzeitlich auf einem anderen
 * Gerät geänderter Stand zieht damit nach.
 */
export function primePersonal(p: PersonalSettings | undefined): void {
  emit(normalizePersonalSettings(p));
  migrateLegacySoundToggle();
}

/**
 * Optimistisch schreiben, Antwort als Wahrheit übernehmen, bei Fehler
 * zurücksetzen und sichtbar melden (U3.3). Optimistisch, weil die Oberfläche
 * bei jedem Klick auf einen der 20 Auslöser sonst spürbar nachhinken würde.
 */
export async function patchPersonal(patch: Partial<PersonalSettings>): Promise<void> {
  const vorher = current;
  emit(normalizePersonalSettings({ ...vorher, ...patch }));
  try {
    emit(normalizePersonalSettings(await api.savePersonal(patch)));
  } catch (e) {
    emit(vorher);
    reportError((e as Error).message);
    throw e;
  }
}

/**
 * Fehlermeldung sichtbar machen. Der Store hängt sich hier ein, damit die
 * Meldung im gewohnten Fehlerband landet, ohne dass dieses Modul den Store
 * importieren müsste (das erzeugte einen Zyklus store → personalSettings → store).
 */
let errorSink: ((message: string) => void) | null = null;

export function setPersonalErrorSink(sink: (message: string) => void): void {
  errorSink = sink;
}

function reportError(message: string): void {
  if (errorSink) errorSink(`Einstellungen konnten nicht gespeichert werden: ${message}`);
}

// ---------- Einmalige Übernahme des alten, gerätelokalen Schalters ----------

const LEGACY_SOUND_KEY = 'sdd-sound';

/** Steht der Ton-Bestand noch unverändert auf der Standardbelegung? */
function istStandardbelegung(p: PersonalSettings): boolean {
  const d = DEFAULT_PERSONAL_SETTINGS.sound;
  const s = p.sound;
  return (
    s.enabled === d.enabled &&
    s.volume === d.volume &&
    JSON.stringify(s.reactions) === JSON.stringify(d.reactions)
  );
}

let migrationVersucht = false;

/**
 * Übernahme des alten Schalters (FR-015, U3.4, research D9): Wer den
 * gerätelokalen Sound auf „aus" hatte, soll durch die Umstellung keine Töne
 * bekommen. Bedingung ist ein noch unveränderter serverseitiger Bestand —
 * sonst würde eine bewusste spätere Wahl überschrieben.
 *
 * Läuft genau einmal pro Seitenaufruf und räumt den Schlüssel danach ab;
 * `sdd-sound` wird ab dann nirgends mehr gelesen oder geschrieben (U3.5).
 */
function migrateLegacySoundToggle(): void {
  if (migrationVersucht) return;
  migrationVersucht = true;

  let alt: string | null = null;
  try {
    alt = localStorage.getItem(LEGACY_SOUND_KEY);
  } catch {
    return; // localStorage nicht verfügbar → nichts zu übernehmen
  }
  if (alt === null) return;

  const schluesselAbraeumen = () => {
    try {
      localStorage.removeItem(LEGACY_SOUND_KEY);
    } catch {
      /* best effort */
    }
  };

  // Nicht „aus" oder der Bestand ist bereits bewusst geändert: es gibt nichts zu
  // übernehmen, und der Schlüssel darf weg — sonst könnte er später erneut
  // greifen, wenn jemand die Standardbelegung wiederherstellt.
  if (alt !== 'off' || !istStandardbelegung(current)) {
    schluesselAbraeumen();
    return;
  }

  // Erst nach dem erfolgreichen Schreiben abräumen: scheitert der Weg zum
  // Server, bleibt die Übernahme für den nächsten Start erhalten.
  void patchPersonal({ sound: { ...current.sound, enabled: false } })
    .then(schluesselAbraeumen)
    .catch(() => {
      /* beim nächsten Start erneut versuchen */
    });
}
