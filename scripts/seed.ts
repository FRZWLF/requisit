import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, ConfigError } from '../src/config.ts';
import { systemClock, type Clock } from '../src/clock.ts';
import { isRefusal, type Result } from '../src/refusal.ts';
import { openDatabase, closeDatabase } from '../src/db/open.ts';
import { migrate } from '../src/db/migrate.ts';
import { withTransaction, type Tx } from '../src/db/tx.ts';
import { orgScope, type OrgScope } from '../src/db/scope.ts';
import { instanceCreateOrg, instanceFindOrgByNameUnscoped } from '../src/db/instance.ts';
import { peopleRepo } from '../src/db/repos/people.ts';
import { costCentresRepo } from '../src/db/repos/cost-centres.ts';
import { catalogueRepo } from '../src/db/repos/catalogue.ts';
import { rulesRepo } from '../src/db/repos/rules.ts';
import { mintToken } from '../src/auth/token.ts';
import type { CostCentre, Org, Person, Role } from '../src/domain/types.ts';
import type { DatabaseSync } from 'node:sqlite';

/**
 * The development seed (`npm run seed`, D-018). It builds the demo the README quickstart
 * walks through: two organisations — one EUR, one JPY, so the exponent-0 case exists in the
 * demo rather than only in a unit test (D-003) — each with a cost centre and its owner, a
 * buyer, a finance approver, a merchant integration, a short catalogue and the three-row
 * rule table D-008 requires, terminal row included.
 *
 * Everything is written through the `OrgScope` repositories: there is no tenancy escape
 * hatch for a script either (D-004, D-022). The signing secret comes from the environment
 * through `loadConfig`; `npm run seed` passes Node's own `--env-file-if-exists=.env`, so
 * there is no dotenv parser here and the service itself still never reads a file.
 *
 * Tokens are printed to stdout **once** and never written to a file in the repository
 * (D-018) — losing one costs another `npm run seed`, which is the safe direction.
 *
 * Idempotent: a second run finds each organisation by name and re-resolves its people, cost
 * centre and rules instead of adding a second copy. It writes nothing on that path.
 *
 * Exit codes: 0 seeded · 1 bad configuration or usage.
 */

const TOKEN_TTL_SECONDS = 7 * 86_400;

export interface SeededPerson {
  readonly label: string;
  readonly person: Person;
  readonly token: string;
}

export interface SeededOrganisation {
  readonly org: Org;
  readonly costCentre: CostCentre;
  readonly created: boolean;
  readonly people: readonly SeededPerson[];
}

export interface SeedResult {
  readonly organisations: readonly SeededOrganisation[];
}

export interface CliResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

interface PersonSpec {
  readonly label: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly Role[];
}

interface ItemSpec {
  readonly sku: string;
  readonly name: string;
  readonly unitPriceMinor: number;
}

interface RuleSpec {
  readonly seq: number;
  readonly maxTotalMinor: number | null;
  readonly approverKind: 'self' | 'cost_centre_owner' | 'finance';
  readonly ruleCode: string;
}

interface OrgSpec {
  readonly name: string;
  readonly currency: string;
  readonly costCentre: { readonly code: string; readonly name: string };
  readonly people: readonly PersonSpec[];
  readonly items: readonly ItemSpec[];
  readonly rules: readonly RuleSpec[];
}

/**
 * The thresholds differ per organisation because the exponents do: 100.00 EUR and 10 000 JPY
 * are both "a small amount", and both are written here as integer minor units (D-003).
 */
export const ORGANISATIONS: readonly OrgSpec[] = [
  {
    name: 'Acme GmbH',
    currency: 'EUR',
    costCentre: { code: 'CC-OPS', name: 'Operations' },
    people: [
      { label: 'buyer', name: 'Bea Buyer', email: 'bea@acme.test', roles: ['buyer'] },
      { label: 'approver', name: 'Otto Owner', email: 'otto@acme.test', roles: ['approver'] },
      { label: 'finance', name: 'Fiona Finance', email: 'fiona@acme.test', roles: ['finance'] },
      { label: 'merchant', name: 'Acme Order Feed', email: 'orders@acme.test', roles: ['merchant'] },
    ],
    items: [
      { sku: 'LAP-13', name: 'Laptop 13"', unitPriceMinor: 129_900 },
      { sku: 'MON-27', name: 'Monitor 27"', unitPriceMinor: 29_900 },
      { sku: 'KEY-01', name: 'Keyboard', unitPriceMinor: 8_900 },
      { sku: 'CHR-01', name: 'Desk chair', unitPriceMinor: 44_900 },
    ],
    rules: [
      { seq: 10, maxTotalMinor: 10_000, approverKind: 'self', ruleCode: 'R1-self-to-100' },
      {
        seq: 20,
        maxTotalMinor: 500_000,
        approverKind: 'cost_centre_owner',
        ruleCode: 'R2-owner-to-5000',
      },
      { seq: 30, maxTotalMinor: null, approverKind: 'finance', ruleCode: 'R3-finance' },
    ],
  },
  {
    name: 'Kabuki KK',
    currency: 'JPY',
    costCentre: { code: 'CC-LAB', name: 'Laboratory' },
    people: [
      { label: 'buyer', name: 'Kenji Buyer', email: 'kenji@kabuki.test', roles: ['buyer'] },
      { label: 'approver', name: 'Haru Owner', email: 'haru@kabuki.test', roles: ['approver'] },
      { label: 'finance', name: 'Mari Finance', email: 'mari@kabuki.test', roles: ['finance'] },
      {
        label: 'merchant',
        name: 'Kabuki Order Feed',
        email: 'orders@kabuki.test',
        roles: ['merchant'],
      },
    ],
    items: [
      { sku: 'PIP-100', name: 'Pipette set', unitPriceMinor: 24_000 },
      { sku: 'GLV-500', name: 'Gloves, 500', unitPriceMinor: 3_500 },
      { sku: 'CEN-01', name: 'Centrifuge', unitPriceMinor: 890_000 },
    ],
    rules: [
      { seq: 10, maxTotalMinor: 10_000, approverKind: 'self', ruleCode: 'R1-self-to-10000' },
      {
        seq: 20,
        maxTotalMinor: 500_000,
        approverKind: 'cost_centre_owner',
        ruleCode: 'R2-owner-to-500000',
      },
      { seq: 30, maxTotalMinor: null, approverKind: 'finance', ruleCode: 'R3-finance' },
    ],
  },
];

class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

function must<T>(value: Result<T>, what: string): T {
  if (isRefusal(value)) {
    throw new SeedError(`${what}: ${value.code} ${value.detail ?? ''}`.trimEnd());
  }
  return value as T;
}

/** A scope with no acting person: the seed writes as the instance, not as a member. */
function bootstrapScope(orgId: string): OrgScope {
  return orgScope(orgId, { personId: null, kind: 'system', roles: new Set() });
}

function addPeople(
  db: DatabaseSync,
  tx: Tx,
  scope: OrgScope,
  clock: Clock,
  specs: readonly PersonSpec[],
): Map<string, Person> {
  const staff = peopleRepo(db, scope, clock);
  const byLabel = new Map<string, Person>();
  for (const spec of specs) {
    const person = must(staff.insert(tx, { name: spec.name, email: spec.email }), spec.label);
    for (const role of spec.roles) {
      must(staff.grantRole(tx, person.id, role), `${spec.label} role ${role}`);
    }
    byLabel.set(spec.label, person);
  }
  return byLabel;
}

function buildOrganisation(db: DatabaseSync, clock: Clock, spec: OrgSpec): Org {
  return withTransaction(db, (tx) => {
    const org = must(
      instanceCreateOrg(tx, { name: spec.name, currency: spec.currency }, clock),
      spec.name,
    );
    const scope = bootstrapScope(org.id);
    const byLabel = addPeople(db, tx, scope, clock, spec.people);

    const owner = byLabel.get('approver');
    if (owner === undefined) {
      throw new SeedError(`${spec.name}: no approver to own the cost centre`);
    }
    must(
      costCentresRepo(db, scope, clock).insert(tx, {
        code: spec.costCentre.code,
        name: spec.costCentre.name,
        ownerPersonId: owner.id,
      }),
      `${spec.name} cost centre`,
    );

    const catalogue = catalogueRepo(db, scope, clock);
    for (const item of spec.items) {
      must(
        catalogue.insert(tx, {
          sku: item.sku,
          name: item.name,
          unitPriceMinor: item.unitPriceMinor,
          currency: spec.currency,
        }),
        `${spec.name} item ${item.sku}`,
      );
    }

    const rules = rulesRepo(db, scope);
    for (const rule of spec.rules) {
      must(rules.insert(tx, rule), `${spec.name} rule ${rule.ruleCode}`);
    }
    return org;
  });
}

function peopleOf(
  db: DatabaseSync,
  org: Org,
  clock: Clock,
  spec: OrgSpec,
  mint: (org: Org, personId: string) => string,
): SeededPerson[] {
  const known = new Map(
    peopleRepo(db, bootstrapScope(org.id), clock).list().map((person) => [person.email, person]),
  );
  return spec.people.map((wanted) => {
    const person = known.get(wanted.email);
    if (person === undefined) {
      throw new SeedError(`${spec.name}: ${wanted.email} is missing — was the database edited?`);
    }
    return { label: wanted.label, person, token: mint(org, person.id) };
  });
}

export function seed(
  db: DatabaseSync,
  mint: (org: Org, personId: string) => string,
  clock: Clock = systemClock,
): SeedResult {
  const organisations: SeededOrganisation[] = [];
  for (const spec of ORGANISATIONS) {
    // The idempotency check: a second run finds what the first one made and writes nothing.
    const existing = instanceFindOrgByNameUnscoped(db, spec.name);
    const created = isRefusal(existing);
    const org = created ? buildOrganisation(db, clock, spec) : existing;
    const centre = costCentresRepo(db, bootstrapScope(org.id), clock)
      .list()
      .find((row) => row.code === spec.costCentre.code);
    if (centre === undefined) {
      throw new SeedError(`${spec.name}: cost centre ${spec.costCentre.code} is missing`);
    }
    organisations.push({
      org,
      costCentre: centre,
      created,
      people: peopleOf(db, org, clock, spec, mint),
    });
  }
  return { organisations };
}

function render(result: SeedResult, port: number): string {
  const base = `http://127.0.0.1:${String(port)}`;
  const lines: string[] = ['Requisit demo data', ''];
  for (const entry of result.organisations) {
    lines.push(
      `${entry.org.name} · ${entry.org.currency} · ${entry.created ? 'seeded' : 'already present'}`,
    );
    lines.push(`  organisation  ${entry.org.id}`);
    lines.push(`  cost centre   ${entry.costCentre.code}  ${entry.costCentre.id}`);
    for (const who of entry.people) {
      lines.push(`  ${who.label.padEnd(13)} ${who.person.name}`);
      lines.push(`  ${' '.repeat(13)} ${who.token}`);
    }
    lines.push('');
  }
  lines.push('These tokens are printed once and are not written to any file (D-018).');
  lines.push('Start the service with `npm start`, then:');
  lines.push(`  ${base}/api/v1/rules            the rule table`);
  lines.push(`  ${base}/api/v1/requisitions     the organisation's requisitions`);
  lines.push(`  ${base}/api/v1/outbox?after=0   the order feed, with the merchant token`);
  lines.push('');
  lines.push('The README quickstart walks the whole flow with these tokens.');
  return `${lines.join('\n')}\n`;
}

export function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  clock: Clock = systemClock,
): CliResult {
  const usage = 'usage: npm run seed';
  if (argv.length > 0) {
    return { code: 1, out: '', err: `unexpected argument: ${String(argv[0])}\n${usage}` };
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

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDatabase(config.dbPath);
  try {
    migrate(db);
    const result = seed(
      db,
      (org, personId) =>
        mintToken(
          { kid: config.activeKid, secret },
          { sub: personId, org: org.id, ttlSeconds: TOKEN_TTL_SECONDS },
          clock,
        ),
      clock,
    );
    return { code: 0, out: render(result, config.port), err: '' };
  } catch (error) {
    if (error instanceof SeedError) {
      return { code: 1, out: '', err: `seed failed: ${error.message}` };
    }
    throw error;
  } finally {
    closeDatabase(db);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('seed.ts')) {
  const result = main(process.argv.slice(2), process.env);
  if (result.out !== '') {
    process.stdout.write(result.out);
  }
  if (result.err !== '') {
    process.stderr.write(`${result.err}\n`);
  }
  process.exit(result.code);
}
