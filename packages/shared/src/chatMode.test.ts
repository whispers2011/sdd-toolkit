import { describe, it, expect } from 'vitest';
import { CHAT_MODES, isChatMode, requiresNewConversation, isInterventional } from './chatMode.js';

describe('chatMode', () => {
  it('CHAT_MODES enthält genau ask und work', () => {
    expect(CHAT_MODES).toEqual(['ask', 'work']);
  });

  it('isChatMode akzeptiert gültige und lehnt ungültige Werte ab', () => {
    expect(isChatMode('ask')).toBe(true);
    expect(isChatMode('work')).toBe(true);
    expect(isChatMode('read')).toBe(false);
    expect(isChatMode('')).toBe(false);
    expect(isChatMode(undefined)).toBe(false);
    expect(isChatMode(null)).toBe(false);
    expect(isChatMode(42)).toBe(false);
  });

  it('requiresNewConversation nur bei tatsächlichem Wechsel', () => {
    expect(requiresNewConversation('ask', 'work')).toBe(true);
    expect(requiresNewConversation('work', 'ask')).toBe(true);
    expect(requiresNewConversation('ask', 'ask')).toBe(false);
    expect(requiresNewConversation('work', 'work')).toBe(false);
  });

  it('isInterventional trennt lesend von eingreifend', () => {
    expect(isInterventional('work')).toBe(true);
    expect(isInterventional('ask')).toBe(false);
  });
});
