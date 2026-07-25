import type { ChatMode } from './types.js';

/** Alle gültigen Chat-Modi (Reihenfolge = UI-Reihenfolge). */
export const CHAT_MODES: readonly ChatMode[] = ['ask', 'work'] as const;

/** Type-Guard: prüft, ob ein beliebiger Wert ein gültiger ChatMode ist. */
export function isChatMode(value: unknown): value is ChatMode {
  return value === 'ask' || value === 'work';
}

/**
 * Ein Moduswechsel ist konversationsverändernd: Da der Modus pro Unterhaltung fix ist
 * (verschiedene Ausführungsmodelle — lesend im Root vs. interaktiv in Worktree), erfordert
 * ein Wechsel eine neue Unterhaltung. Gibt `true` zurück, wenn `next` sich von `current`
 * unterscheidet und daher die bestehende Unterhaltung beendet werden muss.
 */
export function requiresNewConversation(current: ChatMode, next: ChatMode): boolean {
  return current !== next;
}

/** Ob im gegebenen Modus schreibende/eingreifende Aktionen erlaubt sind. */
export function isInterventional(mode: ChatMode): boolean {
  return mode === 'work';
}
