import { systemClock, toIso, type Clock } from './clock.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names whose values never reach a log line (D-018). */
const SECRET_KEY_RE = /token|secret|authorization|password|cookie/i;

export const REDACTED = '[redacted]';

let threshold: LogLevel = 'info';
let clock: Clock = systemClock;

/** Tests and deterministic scripts pin the log clock (D-017). */
export function setLogClock(next: Clock): void {
  clock = next;
}

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function redact(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEY_RE.test(key) ? REDACTED : value;
  }
  return out;
}

/** The one log function. Everything that prints in the service goes through it. */
export function log(level: LogLevel, msg: string, fields?: Readonly<Record<string, unknown>>): void {
  if (ORDER[level] < ORDER[threshold]) {
    return;
  }
  const line = JSON.stringify({
    at: toIso(clock.now()),
    level,
    msg,
    ...(fields ? redact(fields) : {}),
  });
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/** Exported for tests and for a caller that wants the redaction without the write. */
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redact(fields);
}
