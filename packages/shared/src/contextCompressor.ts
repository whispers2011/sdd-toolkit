/**
 * Deterministische Verdichtung toolkit-injizierter Inhalte
 * (Feature "minimize-token-consumption", P3). Rein, idempotent, ohne Modellaufruf.
 */
import { estimateTokens, stripAnsi } from './costMeter.js';

/** UTF-8-Bytelänge ohne Node-Buffer (shared bleibt umgebungs-neutral: Node + Browser). */
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type ElisionReason = 'dedup' | 'blank' | 'log-truncation' | 'boilerplate';

export interface CompressionReport {
  bytesBefore: number;
  bytesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  elided: { reason: ElisionReason; count: number }[];
}

export interface CompressOptions {
  /** Fenced Code-/Log-Blöcke ab dieser Zeilenzahl kürzen. Default 40. */
  maxLogLines?: number;
  /** Zusätzliche Boilerplate-Zeilen (exakter Trim-Match), die entfernt werden. */
  boilerplate?: string[];
}

const FENCE = '```';
const ELISION_RE = /^… \(\d+ Zeilen ausgelassen\)$/;

function truncateFences(lines: string[], maxLogLines: number, count: { n: number }): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trimStart().startsWith(FENCE)) {
      const fenceOpen = line;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trimStart().startsWith(FENCE)) {
        body.push(lines[j]!);
        j++;
      }
      const fenceClose = j < lines.length ? lines[j]! : null;
      // Bereits verdichteter Block (enthält Auslassungsmarker) → unverändert lassen (Idempotenz).
      const alreadyElided = body.some((b) => ELISION_RE.test(b.trim()));
      if (body.length > maxLogLines && !alreadyElided) {
        const head = body.slice(0, Math.ceil(maxLogLines / 2));
        const tail = body.slice(body.length - Math.floor(maxLogLines / 2));
        const dropped = body.length - head.length - tail.length;
        out.push(fenceOpen, ...head, `… (${dropped} Zeilen ausgelassen)`, ...tail);
        count.n += 1;
      } else {
        out.push(fenceOpen, ...body);
      }
      if (fenceClose !== null) out.push(fenceClose);
      i = j + 1;
    } else {
      out.push(line);
      i++;
    }
  }
  return out;
}

/**
 * Verdichtet `text` deterministisch: ANSI strippen, Boilerplate droppen,
 * aufeinanderfolgende Duplikatzeilen entfernen, mehrfache Leerzeilen kollabieren,
 * überlange Code-/Log-Blöcke kürzen. `compress(compress(x)).text === compress(x).text`.
 */
export function compress(text: string, opts: CompressOptions = {}): { text: string; report: CompressionReport } {
  const maxLogLines = opts.maxLogLines ?? 40;
  const boilerplate = new Set((opts.boilerplate ?? []).map((b) => b.trim()));
  const bytesBefore = utf8Bytes(text);
  const tokensBefore = estimateTokens(text);
  const counts: Record<ElisionReason, number> = { dedup: 0, blank: 0, 'log-truncation': 0, boilerplate: 0 };

  const stripped = stripAnsi(text);
  let lines = stripped.split('\n');

  // 1) Boilerplate droppen.
  if (boilerplate.size > 0) {
    lines = lines.filter((l) => {
      if (boilerplate.has(l.trim())) {
        counts.boilerplate += 1;
        return false;
      }
      return true;
    });
  }

  // 2) Log-/Code-Fences kürzen.
  const fenceCount = { n: 0 };
  lines = truncateFences(lines, maxLogLines, fenceCount);
  counts['log-truncation'] = fenceCount.n;

  // 3) Aufeinanderfolgende Duplikate + mehrfache Leerzeilen kollabieren.
  const collapsed: string[] = [];
  let prev: string | null = null;
  let blankRun = 0;
  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank) {
      blankRun += 1;
      if (blankRun > 1) {
        counts.blank += 1;
        continue;
      }
    } else {
      blankRun = 0;
      if (line === prev) {
        counts.dedup += 1;
        continue;
      }
    }
    collapsed.push(line);
    prev = line;
  }

  // Trailing-Whitespace normalisieren: genau ein abschließendes Newline (idempotent).
  const outText = collapsed.join('\n').replace(/\n+$/, '') + '\n';
  const report: CompressionReport = {
    bytesBefore,
    bytesAfter: utf8Bytes(outText),
    tokensBefore,
    tokensAfter: estimateTokens(outText),
    elided: (Object.entries(counts) as [ElisionReason, number][])
      .filter(([, n]) => n > 0)
      .map(([reason, count]) => ({ reason, count })),
  };
  return { text: outText, report };
}
