import { describe, expect, it } from 'vitest';
import { awaitingDetail, parseHookLine } from './hookBridge.js';

describe('awaitingDetail — konkreter Anlass der Rückfrage', () => {
  it('nimmt den echten Fragetext aus AskUserQuestion', () => {
    expect(
      awaitingDetail('AskUserQuestion', {
        questions: [{ question: 'Welche Datenbank?', header: 'DB', options: [] }],
      }),
    ).toBe('Welche Datenbank?');
  });

  it('verbindet mehrere Fragen', () => {
    expect(
      awaitingDetail('AskUserQuestion', {
        questions: [{ question: 'Welche DB?' }, { question: 'Welcher Cache?' }],
      }),
    ).toBe('Welche DB? · Welcher Cache?');
  });

  it('nimmt die erste inhaltliche Zeile des Plans als Titel', () => {
    expect(awaitingDetail('ExitPlanMode', { plan: '## Plan\n\n1. Repo migrieren\n2. Tests' })).toBe('Plan');
    expect(awaitingDetail('ExitPlanMode', { plan: '- Repo auf pnpm migrieren\n- Tests' })).toBe(
      'Repo auf pnpm migrieren',
    );
  });

  it('kürzt lange Texte', () => {
    const detail = awaitingDetail('AskUserQuestion', { questions: [{ question: 'x'.repeat(400) }] })!;
    expect(detail.length).toBeLessThanOrEqual(140);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('liefert nichts bei fehlendem/leerem Payload', () => {
    expect(awaitingDetail('AskUserQuestion', undefined)).toBeUndefined();
    expect(awaitingDetail('AskUserQuestion', { questions: [] })).toBeUndefined();
    expect(awaitingDetail('ExitPlanMode', { plan: '' })).toBeUndefined();
    expect(awaitingDetail('Bash', { command: 'ls' })).toBeUndefined();
  });
});

describe('parseHookLine — PreToolUse trägt das Detail mit', () => {
  it('hängt das Detail an das pre_tool_use-Signal', () => {
    const { signal } = parseHookLine(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'abc',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Weiter mit Variante B?' }] },
      }),
    );
    expect(signal).toEqual({
      name: 'pre_tool_use',
      toolName: 'AskUserQuestion',
      detail: 'Weiter mit Variante B?',
    });
  });

  it('bleibt ohne Detail unverändert', () => {
    const { signal } = parseHookLine(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }));
    expect(signal).toEqual({ name: 'pre_tool_use', toolName: 'Bash' });
  });
});
