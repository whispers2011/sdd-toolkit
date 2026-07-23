import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regressions-Tripwire (FR-005/FR-007/FR-010): stellt sicher, dass echte
 * Kommando-Auslösepunkte über sendPrompt (auto-submit) laufen, die bewussten
 * Einfüge-/Bestätigungs-Pfade (Init, Bild-Pfad) dagegen nur `write` nutzen
 * (kein CR, kein Auto-Submit). Ohne vollständigen App-Aufbau via Quelltext.
 */

const SRC = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/** Handler-Rumpf einer Route: vom Marker bis zur nächsten `app.<method>(`-Registrierung. */
function routeBody(marker: string): string {
  const start = SRC.indexOf(marker);
  expect(start, `Route-Marker nicht gefunden: ${marker}`).toBeGreaterThanOrEqual(0);
  const rest = SRC.slice(start + marker.length);
  const next = rest.search(/\n {2}app\.(get|post|patch|delete|put)\b/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('server routes — Auto-Submit vs. reine Einfügung', () => {
  it('freier Prompt (/prompt) wird über sendPrompt abgeschickt', () => {
    const body = routeBody("'/api/features/:id/prompt'");
    expect(body).toContain('sendPrompt(session.id, req.body.text)');
  });

  it('init-speckit füllt nur vor (write), submittet nicht', () => {
    const body = routeBody("'/api/projects/:id/init-speckit'");
    expect(body).toContain('deps.ptys.write(');
    expect(body).not.toContain('sendPrompt');
  });

  it('paste-image fügt nur den Pfad ein (write, Bracketed Paste ohne CR), submittet nicht', () => {
    const body = routeBody("'/api/features/:id/paste-image'");
    expect(body).toContain('deps.ptys.write(');
    expect(body).not.toContain('sendPrompt');
  });
});
