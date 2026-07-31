import type { PressureVerdict, ResourceSnapshot } from './types.js';

/** Unter so viel freiem Platz erscheint ein Hinweis. */
export const DISK_NOTICE_BYTES = 10 * 1024 ** 3;

/** Unter so viel freiem Platz erscheint eine Warnung — hier wird es eng für parallele Läufe. */
export const DISK_WARN_BYTES = 2 * 1024 ** 3;

/** Ab dieser Auslastung des Auslagerungsspeichers erscheint ein Hinweis. */
export const SWAP_NOTICE_RATIO = 0.8;

/** Ab so vielen gleichzeitig arbeitenden Features wird ihre Zahl genannt (FR-019). */
export const PARALLEL_NOTICE = 2;

/** Zeichen für „nicht ermittelbar" — nie eine geratene Zahl (FR-022). */
const UNBEKANNT = '–';

/**
 * Bewertet den Ressourcendruck einer Momentaufnahme.
 *
 * Rein: keine Uhr, kein Dateizugriff, keine Betriebssystemabfrage. Dieselbe Funktion
 * bedient die HTTP-Antwort und die Tests; die Oberfläche entscheidet keine Schwellen
 * selbst, sie zeigt nur das Urteil (C3.5, D16).
 *
 * Nicht ermittelbare Kennzahlen gehen NICHT in die Bewertung ein — Unwissen ist keine
 * Warnung, und eine Warnung ohne Grundlage würde die echten entwerten (FR-022).
 */
export function evaluatePressure(snapshot: ResourceSnapshot): PressureVerdict {
  const { diskFreeBytes, swapUsedRatio, activeFeatures } = snapshot;

  const platteWarnt = diskFreeBytes !== null && diskFreeBytes < DISK_WARN_BYTES;
  const platteMahnt = diskFreeBytes !== null && diskFreeBytes < DISK_NOTICE_BYTES;
  const swapMahnt = swapUsedRatio !== null && swapUsedRatio >= SWAP_NOTICE_RATIO;

  const level = platteWarnt ? 'warn' : platteMahnt || swapMahnt ? 'notice' : 'ok';
  const parallel = activeFeatures >= PARALLEL_NOTICE;

  return {
    level,
    summary: kurzform(snapshot, parallel),
    // Der Hinweis erscheint, wenn es eng wird (dann immer) oder wenn Druck und
    // Parallelität zusammentreffen — genau die Lage, in der ein weiteres Feature
    // die Maschine kippt (US3-4, FR-020). Ein blosser Hinweis ohne Parallelität
    // bliebe folgenlos und verrauschte nur die Kopfleiste.
    notice: level === 'warn' || (level === 'notice' && parallel)
      ? hinweis(snapshot, { platteMahnt, swapMahnt, parallel })
      : null,
  };
}

/** Kurzform der Kopfleiste: `<freier Platz> · Swap <Prozent> · <n> parallel` (C3). */
function kurzform(snapshot: ResourceSnapshot, parallel: boolean): string {
  const teile = [
    snapshot.diskFreeBytes === null ? UNBEKANNT : formatBytes(snapshot.diskFreeBytes),
    `Swap ${snapshot.swapUsedRatio === null ? UNBEKANNT : formatRatio(snapshot.swapUsedRatio)}`,
  ];
  // Unter zwei Features ist die Zahl keine Information — sie stünde nur im Weg (FR-019).
  if (parallel) teile.push(`${snapshot.activeFeatures} parallel`);
  return teile.join(' · ');
}

/**
 * Ausformulierter Hinweis. Er nennt die konkreten Werte, nicht die Stufe: „notice"
 * sagt dem Nutzer nichts, „813 MB frei" sagt ihm, ob er noch ein Feature starten kann.
 *
 * Bleibt nichts Konkretes zu sagen, ist die Antwort `null` und nicht der leere Text:
 * ein leerer Hinweis wäre eine Warnung ohne Inhalt. Mit den hier gesetzten Schwellen
 * kommt das nicht vor (unter der Warn- liegt immer auch die Hinweisschwelle) — wohl
 * aber, sobald jemand `DISK_WARN_BYTES` über `DISK_NOTICE_BYTES` hebt.
 */
function hinweis(
  snapshot: ResourceSnapshot,
  lage: { platteMahnt: boolean; swapMahnt: boolean; parallel: boolean },
): string | null {
  const teile: string[] = [];
  if (lage.parallel) teile.push(`${snapshot.activeFeatures} Features parallel`);
  if (lage.swapMahnt && snapshot.swapUsedRatio !== null) teile.push(`Swap ${formatRatio(snapshot.swapUsedRatio)}`);
  if (lage.platteMahnt && snapshot.diskFreeBytes !== null) teile.push(`${formatBytes(snapshot.diskFreeBytes)} frei`);
  return teile.length > 0 ? teile.join(', ') : null;
}

/** Ab GB mit einer Nachkommastelle, darunter ganzzahlig in MB (C3). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}
