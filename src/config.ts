import { Buffer } from 'node:buffer';
import type { LogLevel } from './log.ts';

/**
 * Configuration comes from the environment only and is validated once, at startup, into a
 * frozen object (D-018). A `ConfigError` names the variable and the rule it broke — never
 * the value, because the value may be the signing secret.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type NodeEnv = 'development' | 'test' | 'production';

export interface Config {
  /** kid → key. v1 has exactly one kid, `'1'` = `REQUISIT_TOKEN_SECRET` (D-021). */
  readonly tokenKeys: ReadonlyMap<string, Buffer>;
  readonly activeKid: '1';
  readonly dbPath: string;
  readonly port: number;
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
}

export const MIN_SECRET_BYTES = 32;
export const ACTIVE_KID = '1';

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new ConfigError(`${name} is required`);
  }
  return value;
}

function oneOf<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const hit = allowed.find((candidate) => candidate === raw);
  if (hit === undefined) {
    throw new ConfigError(`${name} must be one of ${allowed.join(', ')}`);
  }
  return hit;
}

function port(env: NodeJS.ProcessEnv): number {
  const raw = env['PORT'];
  if (raw === undefined || raw === '') {
    return 3000;
  }
  // Decimal digits only: `Number` would happily accept ' 80', '0x50' and '8e1'.
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError('PORT must be an integer between 1 and 65535');
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const secret = required(env, 'REQUISIT_TOKEN_SECRET');
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new ConfigError(`REQUISIT_TOKEN_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  }

  const dbPathRaw = env['REQUISIT_DB_PATH'];
  const dbPath = dbPathRaw === undefined || dbPathRaw === '' ? './data/requisit.db' : dbPathRaw;

  const tokenKeys = new Map<string, Buffer>([[ACTIVE_KID, Buffer.from(secret, 'utf8')]]);

  return Object.freeze({
    tokenKeys,
    activeKid: ACTIVE_KID,
    dbPath,
    port: port(env),
    nodeEnv: oneOf<NodeEnv>(env, 'NODE_ENV', NODE_ENVS, 'development'),
    logLevel: oneOf<LogLevel>(env, 'REQUISIT_LOG_LEVEL', LOG_LEVELS, 'info'),
  });
}
