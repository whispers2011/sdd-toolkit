import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  compress,
  estimateTokens,
  type CompressionMode,
  type CompressionReport,
  type FeaturePhase,
  type OptimizationSettings,
} from '@sdd/shared';
import { artifactExists } from './artifacts.js';

export interface PhaseContextPlan {
  /** Reset-Kommando vor der Phase (`/compact`|`/clear`) oder null (`full`/erste Phase/Guard). */
  reset: 'compact' | 'fresh' | null;
  /** Ggf. verdichtete Wissens-Präambel für die Phase. */
  preamble: string;
  /** Guard ausgelöst → auf vollständigen Kontext zurückgefallen (FR-010). */
  fellBackToFull: boolean;
  /** Audit der Verdichtung (FR-009); nur wenn verdichtet wurde. */
  report?: CompressionReport;
  /**
   * `llm`-Modus gewählt, aber Präambel unter {@link LLM_MIN_TOKENS} — eine
   * LLM-Zusammenfassung könnte nie Netto-Tokens sparen, es bleibt beim
   * deterministischen Ergebnis (sichtbar statt still).
   */
  llmSkipped?: boolean;
}

/** Unterhalb dieser (geschätzten) Präambel-Größe kann LLM-Verdichtung nie Netto sparen. */
export const LLM_MIN_TOKENS = 1500;

/** Erste Phase: nie zurücksetzen (kein Vorkontext vorhanden). */
const FIRST_PHASE: FeaturePhase = 'specify';

/**
 * Reiner Planer für die Kontext-Übergabe einer Phase (Feature "minimize-token-consumption").
 * Entscheidet Reset (P2) und Verdichtung (P3) anhand der aufgelösten Optimierungs-Settings.
 * Deterministisch/lokal — kein Modellaufruf. Guard: fehlt das Basis-Artefakt (spec.md),
 * wird auf vollständigen Kontext zurückgefallen.
 */
export function prepareForPhase(input: {
  phase: FeaturePhase;
  worktreeRoot: string;
  featureName: string;
  opt: OptimizationSettings;
  rawPreamble: string;
}): PhaseContextPlan {
  const { phase, worktreeRoot, featureName, opt, rawPreamble } = input;

  // --- P2: Reset-Entscheidung + Guard ---
  let reset: 'compact' | 'fresh' | null = null;
  let fellBackToFull = false;
  if (opt.contextStrategy !== 'full' && phase !== FIRST_PHASE) {
    // Guard (FR-010): nur zurücksetzen, wenn das Basis-Artefakt auf Disk liegt,
    // damit die Phase nach dem Reset ihren Kontext von Disk rekonstruieren kann.
    const baseReady = artifactExists(worktreeRoot, featureName, FIRST_PHASE);
    if (baseReady) {
      reset = opt.contextStrategy; // 'compact' | 'fresh'
    } else {
      fellBackToFull = true;
    }
  }

  // --- P3: Verdichtung der toolkit-injizierten Präambel ---
  let preamble = rawPreamble;
  let report: CompressionReport | undefined;
  let llmSkipped = false;
  if (opt.compression !== 'off' && rawPreamble.trim().length > 0) {
    const result = compress(rawPreamble);
    // Deterministisches Ergebnis nur übernehmen, wenn es tatsächlich kleiner ist.
    if (result.report.tokensAfter < result.report.tokensBefore) {
      preamble = result.text;
      report = result.report;
    }
    // `llm` lohnt sich erst ab LLM_MIN_TOKENS (der Summarize-Aufruf kostet selbst
    // Tokens) — darunter explizit deterministisch bleiben und das ausweisen.
    if (opt.compression === 'llm' && estimateTokens(preamble) < LLM_MIN_TOKENS) {
      llmSkipped = true;
    }
  }

  return { reset, preamble, fellBackToFull, ...(report ? { report } : {}), ...(llmSkipped ? { llmSkipped } : {}) };
}

/**
 * Netto-Ersparnis-Guard für die optionale LLM-Verdichtung (FR-005, Edge Case
 * „LLM ohne Netto-Ersparnis"): nur behalten, wenn eingesparte Tokens die für die
 * Zusammenfassung ausgegebenen Tokens übersteigen.
 */
export function llmResultIsWorthKeeping(
  tokensBefore: number,
  tokensAfter: number,
  llmCostTokens: number,
): boolean {
  return tokensBefore - tokensAfter > llmCostTokens;
}

/**
 * Optionale LLM-Verdichtung mit Netto-Ersparnis-Guard. `summarize` kapselt den
 * headless-Aufruf (buildHeadlessArgv) und meldet die dabei verbrauchten Tokens;
 * fehlt sie oder rechnet sie sich nicht, bleibt es beim deterministischen Text.
 */
export async function applyLlmCompression(
  deterministicText: string,
  mode: CompressionMode,
  summarize?: (text: string) => Promise<{ text: string; costTokens: number }>,
): Promise<string> {
  if (mode !== 'llm' || !summarize) return deterministicText;
  const before = estimateTokens(deterministicText);
  try {
    const { text, costTokens } = await summarize(deterministicText);
    const after = estimateTokens(text);
    return llmResultIsWorthKeeping(before, after, costTokens) ? text : deterministicText;
  } catch {
    return deterministicText; // LLM-Fehler → sicherer Rückfall
  }
}

/** Direkter Datei-Check (Tests/Guard-Hilfe): existiert spec.md des Features? */
export function baseArtifactExists(worktreeRoot: string, featureName: string): boolean {
  return existsSync(join(worktreeRoot, 'specs', featureName, 'spec.md'));
}
