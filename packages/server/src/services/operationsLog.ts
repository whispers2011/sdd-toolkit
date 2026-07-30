import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OperationsEntry } from '@sdd/shared';

/** Ab dieser Grösse wird beim Start gekürzt (FR-016, D7). */
export const ROTATE_AT_BYTES = 1024 * 1024;

/** So viele Zeilen bleiben nach dem Kürzen stehen — bei 2–4 Einträgen je Lauf sind das Monate. */
export const KEEP_LINES = 1000;

/**
 * Betriebsprotokoll `$SDD_DATA_DIR/operations.jsonl` (Contract C2): eine JSON-Zeile
 * je Start, Abgang und nachgetragenem Ausfall.
 *
 * Zwei Eigenschaften sind nicht verhandelbar:
 *
 * 1. **Synchron.** `process.on('exit')` verwirft asynchrone Arbeit — der Abgangseintrag
 *    wäre dann genau in dem Fall verloren, für den er geschrieben wird (C2.7).
 * 2. **Wirft nie.** Jeder Schreibvorgang liegt in `try/catch`. Der Zustand „Platte voll"
 *    oder „Verzeichnis schreibgeschützt" ist der, in dem das Feature gebraucht wird;
 *    ein Protokolleintrag darf den Server niemals beenden (C2.5, FR-017).
 */
export class OperationsLog {
  private readonly path: string;

  /**
   * Once-Flag für den Abgang (C2.2). Der geordnete Weg ist
   * `shutdown()` → `appendFarewell(shutdown)` → `process.exit(0)` → `'exit'`-Handler;
   * ohne dieses Flag stünden dort zwei Abgänge für eine Instanz.
   */
  private farewellWritten = false;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'operations.jsonl');
  }

  /** Pfad der Protokolldatei — für Abnahme und Tests. */
  get filePath(): string {
    return this.path;
  }

  /**
   * Einmal beim Start prüfen und ggf. auf die letzten {@link KEEP_LINES} Zeilen kürzen
   * (C2.6). Atomar über Temp-Datei + `rename`, damit ein Abbruch mitten im Kürzen
   * nicht die Historie halbiert. Kein Prüfen je Eintrag: das würde den Abgangspfad
   * mit einem `stat` belasten, ohne etwas zu gewinnen (D7).
   */
  rotateIfNeeded(): void {
    try {
      if (!existsSync(this.path)) return;
      if (statSync(this.path).size <= ROTATE_AT_BYTES) return;
      const lines = readFileSync(this.path, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '');
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${lines.slice(-KEEP_LINES).join('\n')}\n`, { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      // Kürzen ist Hygiene, kein Betriebszweck. Schlägt es fehl, wächst die Datei
      // weiter — das ist allemal besser als ein Startabbruch.
    }
  }

  /** Eintrag anhängen. Wirft nie. */
  append(entry: OperationsEntry): void {
    try {
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 });
    } catch {
      // Siehe Klassenkommentar: ein verlorener Protokolleintrag ist ein Schaden,
      // ein beendeter Server wäre der grössere.
    }
  }

  /** Abgangseintrag anhängen — nur der erste je Instanz wird geschrieben (C2.2). */
  appendFarewell(entry: OperationsEntry): void {
    if (this.farewellWritten) return;
    this.farewellWritten = true;
    this.append(entry);
  }

  /**
   * Die letzten `n` lesbaren Einträge, älteste zuerst. Beschädigte Zeilen — etwa eine
   * halb geschriebene letzte Zeile nach `kill -9` — werden still übersprungen; genau
   * dieser Fall ist der Anlass des Features und darf den Start nicht stören.
   */
  tail(n: number): OperationsEntry[] {
    if (n <= 0) return [];
    try {
      if (!existsSync(this.path)) return [];
      const entries: OperationsEntry[] = [];
      for (const line of readFileSync(this.path, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        try {
          entries.push(JSON.parse(line) as OperationsEntry);
        } catch {
          // unlesbare Zeile überspringen
        }
      }
      return entries.slice(-n);
    } catch {
      return [];
    }
  }
}
