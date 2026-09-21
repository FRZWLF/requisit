import { systemClock, toIso, type Clock } from './clock.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names whose values never reach a log line (D-018). */
const SECRET_KEY_RE = /token|secret|authorization|auth_?header|bearer|credential|password|cookie/i;

/** A value that *looks* like a personal token, whatever the field is called (D-021). */
const SECRET_VALUE_RE = /^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** How deep the redaction walks before it gives up and prints nothing of the subtree. */
const MAX_DEPTH = 6;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Redaction walks the whole tree, not just the top level: a secret one level down is still
 * a secret, and request context (split #3) arrives as a nested object. A value that looks
 * like a token is redacted whatever its field is called.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return SECRET_VALUE_RE.test(value) ? REDACTED : value;
  }
  if (depth >= MAX_DEPTH) {
    return isPlainObject(value) || Array.isArray(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    return redact(value, depth + 1);
  }
  return value;
}

function redact(fields: Readonly<Record<string, unknown>>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactValue(value, depth);
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
