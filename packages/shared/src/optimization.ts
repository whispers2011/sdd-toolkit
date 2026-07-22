/**
 * Token-Optimierungs-Settings (Feature "minimize-token-consumption").
 * Reine Auflösungslogik: Ebenen global → Projekt → Feature, analog resolveAutomation.
 * `full`/`off` == unverändertes Alt-Verhalten (reversibel, FR-008).
 */
import type {
  CompressionMode,
  ContextStrategy,
  OptimizationSettings,
} from './types.js';

/** Aus == heutiges Verhalten: kein Reset, keine Verdichtung. */
export const OPTIMIZATION_OFF_DEFAULTS: OptimizationSettings = {
  contextStrategy: 'full',
  compression: 'off',
};

/** Empfohlener Default der ersten Ausbaustufe (sicher). */
export const OPTIMIZATION_DEFAULTS: OptimizationSettings = {
  contextStrategy: 'compact',
  compression: 'deterministic',
};

const CONTEXT_STRATEGIES: readonly ContextStrategy[] = ['full', 'compact', 'fresh'];
const COMPRESSION_MODES: readonly CompressionMode[] = ['off', 'deterministic', 'llm'];

function coerceStrategy(v: unknown, fallback: ContextStrategy): ContextStrategy {
  return CONTEXT_STRATEGIES.includes(v as ContextStrategy) ? (v as ContextStrategy) : fallback;
}

function coerceCompression(v: unknown, fallback: CompressionMode): CompressionMode {
  return COMPRESSION_MODES.includes(v as CompressionMode) ? (v as CompressionMode) : fallback;
}

/**
 * Effektive Settings ermitteln. Präzedenz: global < Projekt < Feature.
 * Unbekannte Enum-Werte fallen defensiv auf die jeweils niedrigere Ebene / OFF-Default zurück.
 */
export function resolveOptimization(
  global: OptimizationSettings,
  project: Partial<OptimizationSettings> = {},
  feature: Partial<OptimizationSettings> = {},
): OptimizationSettings {
  const g: OptimizationSettings = {
    contextStrategy: coerceStrategy(global.contextStrategy, OPTIMIZATION_OFF_DEFAULTS.contextStrategy),
    compression: coerceCompression(global.compression, OPTIMIZATION_OFF_DEFAULTS.compression),
  };
  const contextStrategy = coerceStrategy(
    feature.contextStrategy ?? project.contextStrategy ?? g.contextStrategy,
    g.contextStrategy,
  );
  const compression = coerceCompression(
    feature.compression ?? project.compression ?? g.compression,
    g.compression,
  );
  return { contextStrategy, compression };
}

/** Partial defensiv aus unbekanntem Input (z. B. JSON-Spalte) lesen. */
export function parseOptimizationPartial(raw: unknown): Partial<OptimizationSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<OptimizationSettings> = {};
  if (CONTEXT_STRATEGIES.includes(obj.contextStrategy as ContextStrategy)) {
    out.contextStrategy = obj.contextStrategy as ContextStrategy;
  }
  if (COMPRESSION_MODES.includes(obj.compression as CompressionMode)) {
    out.compression = obj.compression as CompressionMode;
  }
  return out;
}
