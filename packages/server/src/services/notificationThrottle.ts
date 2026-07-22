/**
 * Notification-Throttle (WP9, WhisperM8-Muster): identische Art derselben
 * Quelle wird 2 s unterdrückt — ein Wechsel der Art (Rückfrage → fertig)
 * kommt immer durch.
 */
export class NotificationThrottle {
  private last = new Map<string, { kind: string; at: number }>();

  constructor(
    private windowMs = 2000,
    private now: () => number = Date.now,
  ) {}

  /** true = senden, false = unterdrücken. */
  allow(sourceKey: string, kind: string): boolean {
    const t = this.now();
    const prev = this.last.get(sourceKey);
    this.last.set(sourceKey, { kind, at: t });
    if (!prev) return true;
    if (prev.kind !== kind) return true;
    return t - prev.at > this.windowMs;
  }
}
