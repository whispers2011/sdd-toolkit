/**
 * Pure Domäne der Portblöcke: Kandidatenreihenfolge, Ableitung eines Dienstports
 * und Bildung der klickbaren Adresse.
 *
 * KEIN IO, keine Node-Importe. Die Vergabe selbst (Freiheitsprüfung, Buchführung,
 * Env-Datei) liegt im PortAllocator des Servers — hier steht nur die Arithmetik,
 * die Server und Oberfläche gemeinsam brauchen.
 *
 * $SDD_PORT_BASE ist der ANFANG eines zusammenhängenden Blocks fester Breite, der
 * dem Worktree exklusiv gehört; ein Dienstport ist `base + portOffset`. Damit ist
 * das Beispiel `8080+n/4000+n` abgedeckt, ohne zwei Zahlenreihen zu führen
 * (Assumption der Spec, research E2).
 */
import type { StackService } from './types.js';

export interface PortRangeConfig {
  /** Erster vergebbarer Port. */
  start: number;
  /** Letzter vergebbarer BLOCKANFANG (nicht der letzte Port). */
  end: number;
  /** Breite eines Blocks. */
  blockSize: number;
}

/** Vorgabewerte; der Server übersteuert sie aus seiner Konfiguration. */
export const PORT_DEFAULTS: PortRangeConfig = { start: 21000, end: 29980, blockSize: 20 };

/**
 * Kandidatenreihenfolge der Blockanfänge: aufsteigend ab `start` in Schritten der
 * Blockbreite, bis einschließlich `end`. Aufsteigend, damit die Vergabe
 * vorhersagbar ist und ein freigegebener Block als erster wieder drankommt.
 */
export function blockStarts(cfg: PortRangeConfig): number[] {
  if (cfg.blockSize <= 0 || cfg.end < cfg.start) return [];
  const out: number[] = [];
  for (let base = cfg.start; base <= cfg.end; base += cfg.blockSize) out.push(base);
  return out;
}

/** Alle Ports eines Blocks — die Menge, die vor der Zuweisung geprüft wird (FR-003). */
export function portsOfBlock(base: number, span: number): number[] {
  return Array.from({ length: Math.max(0, span) }, (_, i) => base + i);
}

/**
 * Port eines Dienstes. `null`, wenn kein Block bekannt ist — die Oberfläche zeigt
 * den Dienst dann ohne Port statt mit einer erfundenen Zahl.
 */
export function portFor(base: number | null, service: Pick<StackService, 'portOffset'>): number | null {
  return base === null ? null : base + service.portOffset;
}

/**
 * Adresse des Haupteingangs. `null`, wenn kein Block bekannt ist oder kein Dienst
 * als Haupteingang gekennzeichnet wurde — die Lane zeigt dann einen Satz statt
 * eines Links ins Leere (FR-031/FR-033).
 *
 * Sprechende Hostnamen sind ausdrücklich Out of Scope; die erste Stufe liefert
 * `http://localhost:<port>`.
 */
export function stackUrl(base: number | null, services: readonly StackService[]): string | null {
  if (base === null) return null;
  const primary = services.find((s) => s.primary);
  if (!primary) return null;
  return `http://localhost:${base + primary.portOffset}`;
}

/** Anzeigeform eines Blocks für die Worktree-Übersicht, z. B. „21040–21059". */
export function formatPortBlock(base: number | null, span: number): string {
  return base === null ? '' : `${base}–${base + span - 1}`;
}
