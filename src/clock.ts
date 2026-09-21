/**
 * The one source of time (D-017). No `Date.now()` or `new Date()` exists anywhere else in
 * `src/` or `scripts/` — `test/db/sql-seam.test.ts` scans for it.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/** A clock frozen at an instant, for tests and for deterministic scripts. */
export function fixedClock(iso: string): Clock {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    throw new TypeError(`fixedClock: not an ISO-8601 instant: ${iso}`);
  }
  return {
    now(): Date {
      return new Date(at.getTime());
    },
  };
}

/** Every timestamp reaches the database through here: UTC ISO-8601, millisecond precision. */
export function toIso(date: Date): string {
  return date.toISOString();
}
