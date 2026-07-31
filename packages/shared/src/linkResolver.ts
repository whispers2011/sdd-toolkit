/**
 * Datei-Link-Erkennung in Terminal-Zeilen (WP10, Port der WhisperM8
 * TerminalLinkResolver-Idee): findet Pfade mit optionalem :zeile(:spalte)-Suffix.
 */

export interface PathLink {
  /** 0-basierte Spalten innerhalb der Zeile (inklusive Start, exklusive Ende). */
  start: number;
  end: number;
  file: string;
  line: number | null;
}

// Pfade: absolut (/…), relativ mit ./ ../, oder mind. ein Verzeichnissegment +
// Datei mit Extension. Optional :zeile oder :zeile:spalte.
const PATH_RE =
  /(?:^|[\s'"`(\[<])((?:\/|\.{1,2}\/)?[\w@~+-]+(?:\/[\w@.~+-]+)+\.[A-Za-z0-9_]+|\/[\w@.~+-]+\.[A-Za-z0-9_]+)(?::(\d+)(?::\d+)?)?/g;

export function findPathLinks(lineText: string): PathLink[] {
  const links: PathLink[] = [];
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(lineText)) !== null) {
    const file = m[1]!;
    const lineNo = m[2] ? parseInt(m[2], 10) : null;
    // Startposition des Pfads (Match kann mit Trennzeichen beginnen).
    const offset = m[0].indexOf(file);
    const start = m.index + offset;
    const suffixLen = m[0].length - offset;
    links.push({ start, end: start + suffixLen, file, line: lineNo });
  }
  return links;
}
