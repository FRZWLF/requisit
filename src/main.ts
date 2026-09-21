import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isoBefore, systemClock, type Clock } from './clock.ts';
import { loadConfig, ConfigError } from './config.ts';
import { closeDatabase, openDatabase } from './db/open.ts';
import { migrate } from './db/migrate.ts';
import { withTransaction } from './db/tx.ts';
import { instanceSweepIdempotencyKeys } from './db/instance.ts';
import { createApp } from './http/app.ts';
import { createServer } from './http/server.ts';
import { log, setLogLevel } from './log.ts';

/**
 * The process refuses to start on a bad configuration (D-018), brings the schema up to date
 * before anything serves, and binds `127.0.0.1` only (D-012). `SIGTERM` closes the server
 * first and the database second, so no request is cut off mid-transaction.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Housekeeping, never part of a request: it spans organisations and says so in its name
 * (D-010, D-022).
 */
export function sweepIdempotencyKeys(db: DatabaseSync, clock: Clock): number {
  const cutoff = isoBefore(clock, IDEMPOTENCY_TTL_MS);
  return withTransaction(db, (tx) => instanceSweepIdempotencyKeys(tx, cutoff));
}

export function main(env: NodeJS.ProcessEnv = process.env): void {
  const config = loadConfig(env);
  setLogLevel(config.logLevel);
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDatabase(config.dbPath);
  const { applied } = migrate(db);

  const swept = sweepIdempotencyKeys(db, systemClock);
  const timer = setInterval(() => {
    sweepIdempotencyKeys(db, systemClock);
  }, IDEMPOTENCY_TTL_MS);
  timer.unref();

  const app = createApp({ db, tokenKeys: config.tokenKeys, clock: systemClock });
  const server = createServer(app);
  server.listen(config.port, '127.0.0.1', () => {
    log('info', 'ready', {
      dbPath: config.dbPath,
      port: config.port,
      nodeEnv: config.nodeEnv,
      migrationsApplied: applied,
      idempotencyKeysSwept: swept,
    });
  });

  process.on('SIGTERM', () => {
    clearInterval(timer);
    server.close(() => {
      closeDatabase(db);
      log('info', 'stopped');
    });
  });
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    // The message names the variable and the rule it broke — never the value (D-018).
    process.stderr.write(`configuration error: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
