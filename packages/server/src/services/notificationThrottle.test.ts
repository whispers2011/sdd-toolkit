import { describe, expect, it } from 'vitest';
import { NotificationThrottle } from './notificationThrottle.js';

describe('NotificationThrottle', () => {
  it('unterdrückt identische Art innerhalb des Fensters', () => {
    let t = 0;
    const th = new NotificationThrottle(2000, () => t);
    expect(th.allow('s1', 'turn_completed')).toBe(true);
    t = 500;
    expect(th.allow('s1', 'turn_completed')).toBe(false);
    t = 2600;
    expect(th.allow('s1', 'turn_completed')).toBe(true);
  });

  it('Wechsel der Art kommt immer durch', () => {
    let t = 0;
    const th = new NotificationThrottle(2000, () => t);
    th.allow('s1', 'input_requested');
    t = 100;
    expect(th.allow('s1', 'turn_completed')).toBe(true);
  });

  it('Quellen sind unabhängig', () => {
    const th = new NotificationThrottle(2000, () => 0);
    expect(th.allow('s1', 'x')).toBe(true);
    expect(th.allow('s2', 'x')).toBe(true);
  });
});
