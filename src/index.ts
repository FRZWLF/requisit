/** The public surface splits 02–04 import. Nothing below reaches into a module directly. */

export { type Clock, systemClock, fixedClock, toIso } from './clock.ts';
export { newId, isId } from './ids.ts';
export {
  type Refusal,
  type RefusalCode,
  type Result,
  refuse,
  isRefusal,
} from './refusal.ts';
export { type Config, type NodeEnv, ConfigError, loadConfig, ACTIVE_KID, MIN_SECRET_BYTES } from './config.ts';
export { type LogLevel, log, setLogLevel, setLogClock, redactFields, REDACTED } from './log.ts';

export {
  type Money,
  MAX_SAFE_MINOR,
  UnknownCurrencyError,
  currencyExponent,
  isKnownCurrency,
  money,
  lineTotal,
  sumMoney,
  formatMoney,
  roundHalfUp,
} from './domain/money.ts';
export * from './domain/types.ts';

export { openDatabase, closeDatabase } from './db/open.ts';
export { type Tx, withTransaction } from './db/tx.ts';
export { type Actor, type OrgScope, orgScope, hasRole } from './db/scope.ts';
export { type Migration, MigrationError, migrate, checksumOf } from './db/migrate.ts';
export { MIGRATIONS } from './db/migrations/index.ts';
export { instanceCreateOrg, instanceFindOrg } from './db/instance.ts';

export { type PeopleRepo, peopleRepo } from './db/repos/people.ts';
export { type CostCentresRepo, costCentresRepo } from './db/repos/cost-centres.ts';
export { type CatalogueRepo, catalogueRepo } from './db/repos/catalogue.ts';
export { type RulesRepo, rulesRepo } from './db/repos/rules.ts';
export {
  type RequisitionsRepo,
  type DraftInput,
  type DraftLineInput,
  requisitionsRepo,
} from './db/repos/requisitions.ts';
export { type AuditRepo, type AuditInput, auditRepo } from './db/repos/audit.ts';

export {
  type TokenClaims,
  mintToken,
  verifyToken,
  TOKEN_VERSION,
  MAX_TOKEN_LENGTH,
  IAT_SKEW_SECONDS,
} from './auth/token.ts';
export { resolveScope } from './auth/scope.ts';
