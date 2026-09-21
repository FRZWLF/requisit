import { loadConfig, ConfigError } from '../src/config.ts';
import { systemClock, type Clock } from '../src/clock.ts';
import { isId } from '../src/ids.ts';
import { openDatabase, closeDatabase } from '../src/db/open.ts';
import { migrate } from '../src/db/migrate.ts';
import { mintToken, verifyToken } from '../src/auth/token.ts';
import { resolveScope } from '../src/auth/scope.ts';
import { isRefusal } from '../src/refusal.ts';

/**
 * The only token issuer (issue #2: a mint endpoint is explicitly out of scope). The secret
 * comes from the environment through `loadConfig` — in development `npm run mint-token`
 * passes Node's own `--env-file-if-exists=.env`, so there is no dotenv parser here.
 *
 * Exit codes: 0 a token on stdout · 1 bad configuration or usage · 2 the person is not a
 * member of that organisation.
 */
const DEFAULT_TTL_SECONDS = 86_400;
/**
 * A cap, not a policy: with revocation still open (G-013) a mistyped `--ttl` mints a
 * credential that cannot be taken back short of rotating the organisation's secret.
 */
export const MAX_TTL_SECONDS = 90 * 86_400;

export interface CliResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function parseArgs(argv: readonly string[]): Record<string, string> | string {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined || !flag.startsWith('--')) {
      return `unexpected argument: ${String(flag)}`;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return `missing value for ${flag}`;
    }
    args[flag.slice(2)] = value;
    i += 1;
  }
  return args;
}

export function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  clock: Clock = systemClock,
): CliResult {
  const usage = 'usage: npm run mint-token -- --org <uuid> --person <uuid> [--ttl <seconds>]';
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    return { code: 1, out: '', err: `${parsed}\n${usage}` };
  }
  const orgId = parsed['org'];
  const personId = parsed['person'];
  if (!isId(orgId) || !isId(personId)) {
    return { code: 1, out: '', err: `--org and --person must be uuids\n${usage}` };
  }
  const ttlRaw = parsed['ttl'];
  const ttlSeconds = ttlRaw === undefined ? DEFAULT_TTL_SECONDS : Number(ttlRaw);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    return { code: 1, out: '', err: `--ttl must be a positive integer\n${usage}` };
  }
  if (ttlSeconds > MAX_TTL_SECONDS) {
    return {
      code: 1,
      out: '',
      err: `--ttl must be at most ${MAX_TTL_SECONDS} seconds (90 days)\n${usage}`,
    };
  }

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return { code: 1, out: '', err: `configuration error: ${error.message}` };
    }
    throw error;
  }

  const secret = config.tokenKeys.get(config.activeKid);
  if (secret === undefined) {
    return { code: 1, out: '', err: `no key for kid ${config.activeKid}` };
  }

  const db = openDatabase(config.dbPath);
  try {
    migrate(db);
    const token = mintToken(
      { kid: config.activeKid, secret },
      { sub: personId, org: orgId, ttlSeconds },
      clock,
    );
    // Minting is also the membership check: the token must resolve to a scope right now.
    const claims = verifyToken(config.tokenKeys, token, clock);
    if (isRefusal(claims)) {
      return { code: 1, out: '', err: `refused: ${claims.code}` };
    }
    const scope = resolveScope(db, claims);
    if (isRefusal(scope)) {
      return { code: 2, out: '', err: 'refused: that person is not a member of that organisation' };
    }
    return { code: 0, out: `${token}\n`, err: '' };
  } finally {
    closeDatabase(db);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('mint-token.ts')) {
  const result = main(process.argv.slice(2), process.env);
  if (result.out !== '') {
    process.stdout.write(result.out);
  }
  if (result.err !== '') {
    process.stderr.write(`${result.err}\n`);
  }
  process.exit(result.code);
}
