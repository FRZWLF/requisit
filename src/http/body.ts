import type { Buffer } from 'node:buffer';
import { refuse, type Result } from '../refusal.ts';

/**
 * The request body, bounded and typed before anything else looks at it (D-012, D-023).
 * A body is a JSON **object** or nothing: arrays and primitives are refused, and so are
 * prototype-polluting keys at any depth — the parse result is walked, not trusted.
 */

export const MAX_BODY_BYTES = 65_536;
const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasForbiddenKey(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKey(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      return true;
    }
    if (hasForbiddenKey(value[key], depth + 1)) {
      return true;
    }
  }
  return false;
}

export function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) {
    return false;
  }
  const media = header.split(';')[0]?.trim().toLowerCase() ?? '';
  return media === 'application/json';
}

/** An empty body on a POST is `{}`; anything else must announce itself as JSON. */
export function parseBody(
  raw: Buffer,
  contentType: string | undefined,
): Result<Record<string, unknown>> {
  if (raw.length > MAX_BODY_BYTES) {
    return refuse(
      'validation_failed',
      `the request body may be at most ${String(MAX_BODY_BYTES)} bytes`,
    );
  }
  if (raw.length === 0) {
    return {};
  }
  if (!isJsonContentType(contentType)) {
    return refuse('validation_failed', 'a request body must be application/json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return refuse('validation_failed', 'the request body is not valid JSON');
  }
  if (!isPlainObject(parsed)) {
    return refuse('validation_failed', 'the request body must be a JSON object');
  }
  if (hasForbiddenKey(parsed, 0)) {
    return refuse('validation_failed', 'the request body contains a forbidden key');
  }
  return parsed;
}
