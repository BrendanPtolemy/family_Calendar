// Failure counter for guessable secrets (parent PIN, pairing codes).
// `max` failures within `windowMs` lock the key; each further lockout doubles,
// capped at a day, so a 4-digit PIN can't be walked even slowly.

export class Limiter {
  private entries = new Map<string, { fails: number; windowStart: number; lockedUntil: number; lockouts: number }>();

  constructor(
    private max: number,
    private windowMs: number,
    private lockMs: number,
    private maxLockMs = 24 * 60 * 60 * 1000,
  ) {}

  /** Seconds until the key may try again, or 0. */
  retryAfter(key: string): number {
    const e = this.entries.get(key);
    return e && e.lockedUntil > Date.now() ? Math.ceil((e.lockedUntil - Date.now()) / 1000) : 0;
  }

  fail(key: string) {
    const now = Date.now();
    const e = this.entries.get(key) ?? { fails: 0, windowStart: now, lockedUntil: 0, lockouts: 0 };
    if (now - e.windowStart > this.windowMs) {
      e.fails = 0;
      e.windowStart = now;
    }
    e.fails++;
    if (e.fails >= this.max) {
      e.lockouts++;
      e.lockedUntil = now + Math.min(this.lockMs * 2 ** (e.lockouts - 1), this.maxLockMs);
      e.fails = 0;
      e.windowStart = now;
    }
    this.entries.set(key, e);
  }

  reset(key: string) {
    this.entries.delete(key);
  }
}

export function waitMessage(seconds: number): string {
  if (seconds < 90) return 'Too many tries. Wait a minute and try again.';
  const mins = Math.ceil(seconds / 60);
  if (mins < 90) return `Too many tries. Try again in ${mins} minutes.`;
  return `Too many tries. Try again in ${Math.ceil(mins / 60)} hours.`;
}
