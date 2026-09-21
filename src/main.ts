import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, ConfigError } from './config.ts';
import { openDatabase } from './db/open.ts';
import { migrate } from './db/migrate.ts';
import { log, setLogLevel } from './log.ts';

/**
 * The process refuses to start on a bad configuration (D-018) and brings the schema up to
 * date before anything serves. There is no HTTP server yet — split 02 adds it (D-012).
 */
export function main(env: NodeJS.ProcessEnv = process.env): void {
  const config = loadConfig(env);
  setLogLevel(config.logLevel);
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDatabase(config.dbPath);
  const { applied } = migrate(db);
  log('info', 'ready', {
    dbPath: config.dbPath,
    port: config.port,
    nodeEnv: config.nodeEnv,
    migrationsApplied: applied,
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
