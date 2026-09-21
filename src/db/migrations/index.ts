import type { Migration } from '../migrate.ts';
import { m0001 } from './0001_initial.ts';
import { m0002 } from './0002_idempotency_actor.ts';

/**
 * An explicit registry, not a directory scan: it survives `tsc`'s emit into `dist/` and
 * Node's type stripping of `src/` without a path to resolve at runtime (D-020).
 */
export const MIGRATIONS: readonly Migration[] = [m0001, m0002];
