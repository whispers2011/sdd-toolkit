import { describe, expect, it } from 'vitest';
import { LEVEL2_DEFAULTS, LEVEL3_DEFAULTS, resolveAutomation } from './types.js';

describe('Auto-Modus', () => {
  it('ist in beiden Presets standardmäßig an', () => {
    expect(LEVEL2_DEFAULTS.autoMode).toBe(true);
    expect(LEVEL3_DEFAULTS.autoMode).toBe(true);
  });

  it('erbt den globalen Wert, wenn kein Override gesetzt ist', () => {
    const resolved = resolveAutomation(LEVEL2_DEFAULTS, {}, {});
    expect(resolved.autoMode).toBe(true);
  });

  it('Feature-Override schlägt Projekt-Override schlägt global', () => {
    expect(resolveAutomation(LEVEL2_DEFAULTS, { autoMode: false }, {}).autoMode).toBe(false);
    expect(resolveAutomation(LEVEL2_DEFAULTS, { autoMode: false }, { autoMode: true }).autoMode).toBe(
      true,
    );
  });
});
