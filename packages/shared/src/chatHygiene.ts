/**
 * Kontext-Hygiene eines Wissens-Chats: ab wann kostet ein fortgesetzter Verlauf so viel,
 * dass sich ein frischer Chat lohnt — und wie liest sich die Zahl, die das begründet.
 *
 * Reines Urteil, kein IO und kein React: die Grenzwerte stehen an EINER Stelle
 * (`CHAT_HYGIENE_LIMITS`, FR-018 — inklusive der bestehenden Leerlaufzeit), die Bewertung
 * ist eine Funktion über gemerkte Turns. Der Server beschafft die Eingaben, das Panel zeigt an.
 *
 * Anlass: ein Verlauf vom 28.07.2026 las über sechs Turns je ~265'000 Tokens Kontext, um
 * 100–400 Tokens zu erzeugen — ein „danke, passt" kostete dort so viel wie eine echte Aufgabe.
 */

/** Grenzen der Bewertung — als Parameter übergebbar, damit Tests mit expliziten Werten arbeiten. */
export interface ChatHygieneLimits {
  /** Leerlaufzeit, nach der eine Chat-Session beendet wird (bestehende Mechanik). */
  readonly idleMs: number;
  /**
   * Leerlaufzeit der pausierten Unterhaltung, nach der „Chat fortsetzen" nicht mehr
   * angeboten wird: Wer nach so langer Pause zurückkommt, beginnt eine neue Aufgabe —
   * ein Resume läse den alten Verlauf ab da in jedem Turn erneut mit.
   */
  readonly resumeMaxIdleMs: number;
  /** Verlaufsgröße in Byte, ab der ein Neustart angeboten wird (FR-002). */
  readonly historyBytes: number;
  /** Gelesener Kontext je Turn, ab dem angeboten wird (FR-003). */
  readonly cacheReadTokensPerTurn: number;
  /** Verhältnis gelesener Kontext : Ausgabe, ab dem angeboten wird (FR-004). */
  readonly ratioTrigger: number;
  /** So viele aufeinanderfolgende Turns muss `ratioTrigger` gelten (FR-004). */
  readonly ratioTurns: number;
  /** Mindestverbrauch je Turn für den Verhältnis-Auslöser (FR-005). */
  readonly minCacheReadTokens: number;
  /** Ab hier wird die Kennzahl sichtbar als kritisch markiert (FR-015). */
  readonly ratioCritical: number;
}

/**
 * Die festgelegten Grenzen (FR-018). Abgeleitet aus dem gemessenen Fall vom 28.07.2026
 * (16,8 MB, ~265'000 gelesene Tokens je Turn, ~1000 : 1) — sie sollen deutlich vor dessen
 * Eskalation greifen. Nachjustieren ist eine Ein-Zeilen-Änderung: die Bewertung nimmt die
 * Grenzen als Parameter, kein Test hängt an den Zahlen hier.
 */
export const CHAT_HYGIENE_LIMITS = {
  idleMs: 5 * 60_000,
  resumeMaxIdleMs: 60 * 60_000,
  historyBytes: 8 * 1024 * 1024,
  cacheReadTokensPerTurn: 150_000,
  ratioTrigger: 300,
  ratioTurns: 3,
  minCacheReadTokens: 50_000,
  ratioCritical: 1_000,
} as const satisfies ChatHygieneLimits;

/**
 * Verbrauch eines einzelnen beendeten Turns. Jedes Feld einzeln `number | null`, weil die
 * Schätz-Rückfallebene keinen Cache-Read/Output-Split liefert; `measured: false` heißt, dass
 * für diesen Turn gar nichts messbar war. Nie `0` als Ersatz für „unbekannt" (FR-016).
 */
export interface ChatTurnUsage {
  cacheReadTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  tokens: number | null;
  measured: boolean;
}

/**
 * Verhältnis gelesener Kontext : erzeugte Ausgabe. Getaggte Union, damit ein Turn ohne
 * Ausgabe nicht als „Infinity" und ein unbekannter Turn nicht als „NaN" endet (US3 AC4).
 */
export type ChatContextRatio =
  | { kind: 'value'; ratio: number }
  | { kind: 'no_output' }
  | { kind: 'unknown' };

/** Anlass, aus dem ein Neustart angeboten wird. */
export type ChatRestartReason = 'idle' | 'history_size' | 'context_per_turn' | 'context_ratio';

/** Bewertung einer Unterhaltung zum Zeitpunkt der letzten Turn-Grenze. */
export interface ChatCostProfile {
  historyBytes: number | null;
  /** Zuletzt beendeter Turn (`null`, solange keiner gemessen wurde). */
  lastTurn: ChatTurnUsage | null;
  ratio: ChatContextRatio;
  reasons: ChatRestartReason[];
  /**
   * Ein kostengetriebenes Angebot ist offen. Der Leerlauf-Grund fließt in `reasons` und
   * `message` ein, hat aber seine eigene (bestehende) Karte und schaltet dieses Flag nicht —
   * genau eine Entscheidungskarte (FR-013).
   */
  offerOpen: boolean;
  /** Hinweistext mit Zahl (FR-006); `null`, wenn kein Anlass vorliegt. */
  message: string | null;
}

/**
 * Stand der auslösenden Größen zum Zeitpunkt einer Ablehnung. Erneut angeboten wird erst,
 * wenn die Größe darüber hinaus um eine weitere Schwellenstufe gewachsen ist (FR-009).
 */
export interface ChatOfferWatermark {
  historyBytes: number | null;
  cacheReadTokens: number | null;
}

/** Eingaben der Bewertung — jüngster Turn zuletzt, höchstens `limits.ratioTurns` Einträge. */
export interface ChatHygieneInput {
  historyBytes: number | null;
  turns: ChatTurnUsage[];
  /** Die Unterhaltung ist wegen Leerlaufs pausiert (bestehende Mechanik, FR-013). */
  idle: boolean;
  watermark: ChatOfferWatermark | null;
}

/** Reihenfolge, in der Gründe genannt werden — Leerlauf zuerst, weil er die Karte trägt. */
const REASON_ORDER: readonly ChatRestartReason[] = [
  'idle',
  'history_size',
  'context_per_turn',
  'context_ratio',
];

/**
 * Verhältnis eines Turns. Fehlt eine der beiden Größen, ist das Verhältnis unbekannt —
 * es wird nicht mit `0` gerechnet (FR-016).
 */
export function contextRatio(usage: ChatTurnUsage | null): ChatContextRatio {
  if (!usage || usage.cacheReadTokens === null || usage.outputTokens === null) return { kind: 'unknown' };
  if (usage.outputTokens === 0) return { kind: 'no_output' };
  return { kind: 'value', ratio: usage.cacheReadTokens / usage.outputTokens };
}

/** Verhältnis als lesbare Kennzahl — mit festem Text für die beiden rechnerisch offenen Fälle. */
export function ratioLabel(ratio: ChatContextRatio): string {
  if (ratio.kind === 'no_output') return 'keine Ausgabe';
  if (ratio.kind === 'unknown') return 'unbekannt';
  return `${groupDigits(Math.round(ratio.ratio))} : 1`;
}

/** Verlaufsgröße als Text (z. B. `16,8 MB`); `null` → „unbekannt" (FR-016). */
export function formatHistorySize(bytes: number | null): string {
  if (bytes === null) return 'unbekannt';
  if (bytes >= 1024 * 1024) return `${decimal(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${groupDigits(Math.round(bytes / 1024))} KB`;
  return `${groupDigits(bytes)} B`;
}

/**
 * Bewertet eine Unterhaltung an ihrer Turn-Grenze: welche Schwelle ist überschritten, wie
 * liest sich das Verhältnis, ist ein Angebot fällig?
 *
 * `null`-Felder lösen nie einen Auslöser aus — eine fehlende Messung ist kein Befund.
 */
export function evaluateChatHygiene(
  input: ChatHygieneInput,
  limits: ChatHygieneLimits = CHAT_HYGIENE_LIMITS,
): ChatCostProfile {
  const lastTurn = input.turns.at(-1) ?? null;
  const ratio = contextRatio(lastTurn);
  const reasons: ChatRestartReason[] = [];

  // Ablehnung setzt einen Wasserstand: erneut angeboten wird erst eine Schwellenstufe
  // darüber (FR-009). Ohne Wasserstand ist die Basis 0, also die Schwelle selbst.
  const historyFloor = (input.watermark?.historyBytes ?? 0) + (input.watermark ? limits.historyBytes : 0);
  const contextFloor =
    (input.watermark?.cacheReadTokens ?? 0) + (input.watermark ? limits.cacheReadTokensPerTurn : 0);

  if (input.historyBytes !== null && input.historyBytes >= Math.max(limits.historyBytes, historyFloor)) {
    reasons.push('history_size');
  }

  const lastRead = lastTurn?.cacheReadTokens ?? null;
  if (lastRead !== null && lastRead >= Math.max(limits.cacheReadTokensPerTurn, contextFloor)) {
    reasons.push('context_per_turn');
  }

  // Verhältnis-Auslöser: erst nach `ratioTurns` aufeinanderfolgenden Turns und erst oberhalb
  // eines absoluten Mindestverbrauchs — ein kurzer Chat mit „ok" hat rechnerisch ein hohes
  // Verhältnis, kostet aber fast nichts (FR-005). Ein Turn ohne Ausgabe hat kein rechenbares
  // Verhältnis und zählt hier nicht mit; ihn fängt der Mengen-Auslöser (FR-003).
  const window = input.turns.slice(-limits.ratioTurns);
  const ratioHolds =
    window.length >= limits.ratioTurns &&
    window.every((turn) => {
      const read = turn.cacheReadTokens;
      if (read === null || read < limits.minCacheReadTokens) return false;
      const r = contextRatio(turn);
      return r.kind === 'value' && r.ratio >= limits.ratioTrigger;
    });
  if (ratioHolds && lastRead !== null && lastRead >= contextFloor) reasons.push('context_ratio');

  if (input.idle) reasons.push('idle');

  // Nur die kostengetriebenen Gründe öffnen den Hinweisstreifen; der Leerlauf hat seine
  // eigene Karte, und es darf nie beides gleichzeitig erscheinen (FR-013).
  const offerOpen = reasons.some((r) => r !== 'idle');
  const profile: ChatCostProfile = {
    historyBytes: input.historyBytes,
    lastTurn,
    ratio,
    reasons: sortReasons(reasons),
    offerOpen,
    message: null,
  };
  return { ...profile, message: restartOfferMessage(profile, limits) };
}

/**
 * Ein Satz, der alle zutreffenden Gründe mit Zahl nennt (FR-006). Liegen Leerlauf und Kosten
 * zusammen vor, nennt derselbe Text beide — es gibt nur eine Entscheidungskarte (FR-013).
 */
export function restartOfferMessage(
  profile: ChatCostProfile,
  limits: ChatHygieneLimits = CHAT_HYGIENE_LIMITS,
): string | null {
  if (profile.reasons.length === 0) return null;
  const parts = sortReasons(profile.reasons).map((reason) => reasonPhrase(reason, profile, limits));
  const joined =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]!}`;
  const tail = profile.reasons.some((r) => r !== 'idle')
    ? 'jeder weitere Turn zahlt den Verlauf mit'
    : 'die Session wurde beendet, der Verlauf ist erhalten';
  return `${capitalize(joined)} — ${tail}.`;
}

function reasonPhrase(reason: ChatRestartReason, profile: ChatCostProfile, limits: ChatHygieneLimits): string {
  switch (reason) {
    case 'idle':
      return `seit ${Math.round(limits.idleMs / 60_000)} min keine Aktivität`;
    case 'history_size':
      return `der Verlauf ist ${formatHistorySize(profile.historyBytes)} groß`;
    case 'context_per_turn':
      return `der letzte Turn las ${groupDigits(profile.lastTurn?.cacheReadTokens ?? 0)} Tokens Kontext`;
    case 'context_ratio':
      return `die letzten ${limits.ratioTurns} Turns lasen ${ratioLabel(profile.ratio)} Kontext je Ausgabe`;
  }
}

/**
 * Pausenzustand einer Unterhaltung: Die Session lebt nicht mehr, der Verlauf schon. Ob
 * „Chat fortsetzen" überhaupt noch angeboten wird, hängt allein an der Dauer der Pause —
 * nach `resumeMaxIdleMs` beginnt das Öffnen des Chats eine frische Unterhaltung.
 *
 * Gemessen ab dem Ende der Session, nicht ab der letzten Eingabe: Der Leerlauf-Reaper
 * beendet sie `idleMs` nach der letzten Zuwendung — die tatsächliche Ruhe ist also um
 * diese Spanne länger als `idleMs` hier.
 */
export interface ChatPauseState {
  /** Die Unterhaltung hatte eine echte Session, die nicht mehr läuft (Verlauf erhalten). */
  paused: boolean;
  /** Beginn der Pause (Ende der letzten Session); `null`, wenn nicht ermittelbar. */
  since: number | null;
  /** Dauer der Pause; `null` bei unbekanntem Beginn — nie `0` als Ersatz (FR-016). */
  idleMs: number | null;
  /**
   * Fortsetzen wird angeboten. Bei unbekanntem Beginn ja: eine fehlende Messung ist kein
   * Befund und darf keinen Verlauf verwerfen.
   */
  resumable: boolean;
}

/** Nicht pausiert — eine laufende (oder nie gestartete) Unterhaltung. */
export const CHAT_NOT_PAUSED: ChatPauseState = {
  paused: false,
  since: null,
  idleMs: null,
  resumable: false,
};

/** Bewertet eine Pause: wie lange sie dauert und ob sie noch fortsetzbar ist. */
export function evaluateChatPause(
  input: { paused: boolean; since: number | null; now?: number },
  limits: ChatHygieneLimits = CHAT_HYGIENE_LIMITS,
): ChatPauseState {
  if (!input.paused) return CHAT_NOT_PAUSED;
  const idleMs = input.since === null ? null : Math.max(0, (input.now ?? Date.now()) - input.since);
  return {
    paused: true,
    since: input.since,
    idleMs,
    resumable: idleMs === null || idleMs < limits.resumeMaxIdleMs,
  };
}

/** Zeitspanne als kurzer Text: `weniger als 1 min`, `12 min`, `1 h`, `1 h 20 min`. */
export function formatIdleSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'weniger als 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const sortReasons = (reasons: ChatRestartReason[]): ChatRestartReason[] =>
  REASON_ORDER.filter((r) => reasons.includes(r));

/** Tausendertrennung in Schweizer Schreibweise: 265000 → `265'000`. */
const groupDigits = (n: number): string => Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");

/** Eine Dezimalstelle mit Komma: 16.8 → `16,8`. */
const decimal = (n: number): string => n.toFixed(1).replace('.', ',');

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
