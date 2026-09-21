import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type { Clock } from '../clock.ts';
import { refuse, type Result } from '../refusal.ts';

/**
 * Personal tokens, v1 (D-005, D-021).
 *
 * Wire format `v1.<base64url(payload)>.<base64url(hmac)>`; the MAC is computed over the
 * exact string `v1.<payloadB64>`, so the version is inside the signature and cannot be
 * swapped. `iat`/`exp` are integer Unix seconds — no attacker-controlled string ever
 * reaches a date parser. Roles are deliberately **not** in the token: authority is read
 * from the database at the moment of use (D-006, `resolveScope`).
 *
 * Every failure path returns `refuse('unauthenticated', …)`. Nothing here throws.
 */
export interface TokenClaims {
  readonly sub: string;
  readonly org: string;
  readonly iat: number;
  readonly exp: number;
  readonly kid: string;
}

export const TOKEN_VERSION = 'v1';
/** A token longer than this is not parsed at all — a cheap bound on hostile input. */
export const MAX_TOKEN_LENGTH = 4096;
/** How far a token's `iat` may sit in the future before it is rejected (clock skew). */
export const IAT_SKEW_SECONDS = 60;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function sign(key: Buffer, signingInput: string): Buffer {
  return crypto.createHmac('sha256', key).update(signingInput, 'utf8').digest();
}

function unixSeconds(clock: Clock): number {
  return Math.floor(clock.now().getTime() / 1000);
}

export function mintToken(
  key: { kid: string; secret: Buffer },
  claims: { sub: string; org: string; ttlSeconds: number },
  clock: Clock,
): string {
  if (!Number.isSafeInteger(claims.ttlSeconds) || claims.ttlSeconds < 1) {
    throw new RangeError('mintToken: ttlSeconds must be a positive integer');
  }
  const iat = unixSeconds(clock);
  const payload: TokenClaims = {
    sub: claims.sub,
    org: claims.org,
    iat,
    exp: iat + claims.ttlSeconds,
    kid: key.kid,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signingInput = `${TOKEN_VERSION}.${payloadB64}`;
  return `${signingInput}.${b64url(sign(key.secret, signingInput))}`;
}

function parseClaims(json: unknown): TokenClaims | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return null;
  }
  const record = json as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 5) {
    return null;
  }
  const { sub, org, iat, exp, kid } = record;
  if (typeof sub !== 'string' || sub === '') {
    return null;
  }
  if (typeof org !== 'string' || org === '') {
    return null;
  }
  if (typeof kid !== 'string' || kid === '') {
    return null;
  }
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) {
    return null;
  }
  return { sub, org, iat: iat as number, exp: exp as number, kid };
}

export function verifyToken(
  keys: ReadonlyMap<string, Buffer>,
  token: unknown,
  clock: Clock,
): Result<TokenClaims> {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return refuse('unauthenticated', 'malformed token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return refuse('unauthenticated', 'malformed token');
  }
  const [version, payloadB64, signatureB64] = parts as [string, string, string];
  if (version !== TOKEN_VERSION) {
    return refuse('unauthenticated', 'unsupported token version');
  }
  if (!BASE64URL_RE.test(payloadB64) || !BASE64URL_RE.test(signatureB64)) {
    return refuse('unauthenticated', 'malformed token');
  }

  let claims: TokenClaims | null;
  try {
    claims = parseClaims(JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')));
  } catch {
    return refuse('unauthenticated', 'malformed token');
  }
  if (claims === null) {
    return refuse('unauthenticated', 'malformed token');
  }

  // The payload is read before the MAC only to find the key. An unknown kid still pays for
  // one HMAC, so "which kids exist" is not readable from the response time.
  const key = keys.get(claims.kid);
  const signingInput = `${version}.${payloadB64}`;
  const expected = sign(key ?? Buffer.alloc(32), signingInput);
  const presented = Buffer.from(signatureB64, 'base64url');
  // The encoding must be canonical as well as correct: base64url ignores the unused bits of
  // the final character, so four distinct strings decode to the same 32 bytes. A token is
  // one string, and a denylist of token hashes (G-013) must not be bypassable by respelling
  // the signature.
  const matches =
    presented.length === expected.length &&
    crypto.timingSafeEqual(presented, expected) &&
    signatureB64 === expected.toString('base64url');
  if (key === undefined || !matches) {
    return refuse('unauthenticated', 'bad signature');
  }

  const now = unixSeconds(clock);
  if (claims.exp <= now) {
    return refuse('unauthenticated', 'token expired');
  }
  if (claims.iat > now + IAT_SKEW_SECONDS) {
    return refuse('unauthenticated', 'token issued in the future');
  }
  return claims;
}
