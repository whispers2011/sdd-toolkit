import { describe, expect, it } from 'vitest';
import {
  OPTIMIZATION_DEFAULTS,
  OPTIMIZATION_OFF_DEFAULTS,
  parseOptimizationPartial,
  resolveOptimization,
} from './optimization.js';

describe('resolveOptimization', () => {
  it('Präzedenz global < Projekt < Feature', () => {
    const r = resolveOptimization(
      OPTIMIZATION_OFF_DEFAULTS,
      { contextStrategy: 'compact' },
      { contextStrategy: 'fresh' },
    );
    expect(r.contextStrategy).toBe('fresh');
    expect(r.compression).toBe('off'); // aus global geerbt
  });

  it('leeres Feature-Partial erbt Projekt-/Global-Wert', () => {
    const r = resolveOptimization(OPTIMIZATION_OFF_DEFAULTS, { compression: 'deterministic' }, {});
    expect(r.compression).toBe('deterministic');
    expect(r.contextStrategy).toBe('full');
  });

  it('unbekannter Enum-Wert fällt defensiv auf niedrigere Ebene zurück', () => {
    const r = resolveOptimization(
      OPTIMIZATION_DEFAULTS,
      { contextStrategy: 'bogus' as never },
      {},
    );
    expect(r.contextStrategy).toBe(OPTIMIZATION_DEFAULTS.contextStrategy);
  });

  it('OFF-Defaults == unverändertes Verhalten', () => {
    expect(OPTIMIZATION_OFF_DEFAULTS).toEqual({ contextStrategy: 'full', compression: 'off' });
  });

  it('parseOptimizationPartial akzeptiert nur gültige Enum-Werte', () => {
    expect(parseOptimizationPartial({ contextStrategy: 'fresh', compression: 'x' })).toEqual({
      contextStrategy: 'fresh',
    });
    expect(parseOptimizationPartial(null)).toEqual({});
    expect(parseOptimizationPartial('nope')).toEqual({});
  });
});
