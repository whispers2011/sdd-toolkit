import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Heartbeat } from '@sdd/shared';

/**
 * Lebenszeichen des Servers in `$SDD_DATA_DIR/heartbeat.json` — eine winzige JSON-Zeile
 * neben der Datenbank.
 *
 * Eigene Datei statt Datenbankzeile, weil die Lückenerkennung auch dann noch etwas finden
 * muss, wenn die SQLite-Datei beschädigt ist; der Ausfall vom 30.07.2026 traf einen Prozess,
 * dessen Verbindung mit ihm starb (D1).
 *
 * Ersetzt wird über Temp-Datei + `rename` — auf APFS/HFS+ atomar. Die Datei ist damit
 * entweder vollständig alt oder vollständig neu, nie halb geschrieben. Ein trotzdem
 * unlesbarer Inhalt gilt als nicht vorhanden; das ist derselbe Fall wie „Erststart" und
 * meldet nie einen Ausfall.
 *
 * Wie das Betriebsprotokoll wirft dieses Modul nie: ein fehlgeschlagener Takt wird beim
 * nächsten wiederholt, ein beendeter Server wäre der grössere Schaden (FR-011).
 */
export class HeartbeatStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'heartbeat.json');
  }

  /** Pfad der Lebenszeichen-Datei — für Abnahme und Tests. */
  get filePath(): string {
    return this.path;
  }

  /** Das zuletzt geschriebene Lebenszeichen; null = keines vorhanden oder unlesbar. */
  read(): Heartbeat | null {
    try {
      return parseHeartbeat(readFileSync(this.path, 'utf8'));
    } catch {
      // Fehlende Datei ist der Erststart, unlesbare der Abbruch mitten im Schreiben —
      // beide bedeuten „kein Lebenszeichen", keiner ist ein Fehler.
      return null;
    }
  }

  /**
   * Den Satz vollständig neu schreiben. `clean` ist dabei immer `false`: ein laufender
   * Server hat sich nicht verabschiedet, und ein `clean: true` einer beendeten
   * Zweitinstanz wird so vom nächsten Takt wieder aufgehoben (D5).
   */
  write(input: { ts: number; instanceId: string; startedAt: number }): void {
    this.replace({ ts: input.ts, instanceId: input.instanceId, clean: false, startedAt: input.startedAt });
  }

  /**
   * Geordneten Abgang vermerken: `clean: true`, alles andere bleibt stehen. Eine Lücke
   * nach diesem Vermerk ist kein Ausfall, egal wie lange sie dauert (FR-002, C1.2).
   */
  markClean(): void {
    const current = this.read();
    if (!current) return;
    this.replace({ ...current, clean: true });
  }

  private replace(heartbeat: Heartbeat): void {
    try {
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(heartbeat)}\n`, { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      // Siehe Klassenkommentar: folgenlos, der nächste Takt versucht es erneut.
    }
  }
}

/**
 * Nur ein vollständiger Satz zählt. Ein syntaktisch gültiges, aber unvollständiges
 * Objekt (etwa aus einer alten Version) gilt als nicht vorhanden — geraten wird nicht.
 */
function parseHeartbeat(raw: string): Heartbeat | null {
  const value = JSON.parse(raw) as Partial<Heartbeat> | null;
  if (!value || typeof value !== 'object') return null;
  const { ts, instanceId, clean, startedAt } = value;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  if (typeof instanceId !== 'string' || instanceId === '') return null;
  if (typeof clean !== 'boolean') return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return { ts, instanceId, clean, startedAt };
}
