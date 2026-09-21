import type http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { closeDatabase } from './db/open.ts';
import { log } from './log.ts';

export const SHUTDOWN_GRACE_MS = 5_000;

/**
 * `server.close()` alone waits for every open connection, so one keep-alive client can hold
 * the database open indefinitely and the `stopped` line never prints. Idle sockets are closed
 * at once and the rest after a short grace period; the timer is unref'd so it never keeps the
 * process alive by itself (#3 review, D-018).
 */
export function shutdownHandler(
  server: http.Server,
  db: DatabaseSync,
  timer: NodeJS.Timeout,
  graceMs: number = SHUTDOWN_GRACE_MS,
): () => void {
  let stopping = false;
  return () => {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(timer);
    const forced = setTimeout(() => {
      server.closeAllConnections();
    }, graceMs);
    forced.unref();
    server.close(() => {
      clearTimeout(forced);
      closeDatabase(db);
      log('info', 'stopped');
    });
    // Belt and braces: Node ≥ 19's `close()` already drops idle keep-alive sockets by itself
    // (measured — removing this line leaves the idle-connection test green), so the line that
    // actually does the work here is the forced close above, for a request still in flight.
    server.closeIdleConnections();
  };
}
