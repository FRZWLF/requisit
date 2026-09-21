/** The public surface splits 02–04 import. Nothing below reaches into a module directly. */

export { type Clock, systemClock, fixedClock, toIso, isoBefore } from './clock.ts';
export { newId, isId } from './ids.ts';
export {
  type Refusal,
  type RefusalCode,
  type Result,
  REFUSAL_CODES,
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
export { type Actor, type OrgScope, orgScope, hasRole, isMember, HUMAN_ROLES } from './db/scope.ts';
export { type Migration, MigrationError, migrate, checksumOf } from './db/migrate.ts';
export { MIGRATIONS } from './db/migrations/index.ts';
export {
  instanceCreateOrg,
  instanceFindOrg,
  instanceSweepIdempotencyKeys,
} from './db/instance.ts';

export { type PeopleRepo, peopleRepo } from './db/repos/people.ts';
export { type CostCentresRepo, costCentresRepo } from './db/repos/cost-centres.ts';
export { type CatalogueRepo, catalogueRepo } from './db/repos/catalogue.ts';
export { type RulesRepo, rulesRepo } from './db/repos/rules.ts';
export {
  type RequisitionsRepo,
  type DraftInput,
  type DraftLineInput,
  type ListFilter,
  type TransitionInput,
  MAX_LINES,
  MAX_DESCRIPTION_CHARS,
  requisitionsRepo,
} from './db/repos/requisitions.ts';
export {
  type IdempotencyKeysRepo,
  type IdempotencyInput,
  type IdempotencyRecord,
  idempotencyKeysRepo,
} from './db/repos/idempotency.ts';
export { type AuditRepo, type AuditInput, auditRepo } from './db/repos/audit.ts';
export {
  type OutboxRepo,
  type OutboxRow,
  DEFAULT_POLL_LIMIT,
  MAX_POLL_LIMIT,
  outboxRepo,
} from './db/repos/outbox.ts';

export {
  type TokenClaims,
  mintToken,
  verifyToken,
  TOKEN_VERSION,
  MAX_TOKEN_LENGTH,
  IAT_SKEW_SECONDS,
} from './auth/token.ts';
export { resolveScope } from './auth/scope.ts';

export {
  type ApproverSpec,
  matchRule,
  describeRule,
  resolveApprover,
} from './domain/rules.ts';
export {
  type Action,
  type ActorRelation,
  type DecideContext,
  type DecideRule,
  type Transition,
  ACTIONS,
  ACTOR_RELATIONS,
  BUYER_ROLE_ACTIONS,
  TRANSITIONS,
  allowedActions,
  decide,
  mayDecide,
  relationOf,
} from './domain/lifecycle.ts';

export {
  type OrderPayload,
  type OrderPayloadLine,
  ORDER_PAYLOAD_VERSION,
  orderPayload,
} from './domain/order.ts';

export {
  type AckInput,
  type AckResult,
  type OutboxFeed,
  type OutboxItemView,
  type PollInput,
  acknowledge,
  poll,
} from './app/outbox.ts';

export {
  type AwaitingView,
  type CreateInput,
  type DecisionInput,
  type LineView,
  type ListInput,
  type RequisitionDetail,
  type RequisitionSummary,
  type RuleRowView,
  type RuleSource,
  type RuleView,
  type ServiceContext,
  type UpdateInput,
  MAX_REASON_CHARS,
  approve,
  cancel,
  copyForward,
  createDraft,
  detail,
  list,
  recordApproval,
  reject,
  ruleTable,
  submit,
  updateDraft,
} from './app/requisitions.ts';

export {
  type App,
  type AppDeps,
  ROUTES,
  createApp,
  dispatch,
} from './http/app.ts';
export { createServer } from './http/server.ts';
export {
  type Handler,
  type HandlerOutcome,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type RequestContext,
  type Route,
} from './http/types.ts';
export { MAX_BODY_BYTES, parseBody, isJsonContentType } from './http/body.ts';
export { matchPattern, matchRoute, type RouteMatch } from './http/router.ts';
export {
  JSON_CONTENT_TYPE,
  PROBLEM_CONTENT_TYPE,
  STATUS_BY_CODE,
  internalErrorBody,
  problemBody,
  statusFor,
} from './http/problem.ts';
export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_RE,
  REPLAYED_HEADER,
  endpointOf,
  fingerprintOf,
  isIdempotencyKey,
} from './http/idempotency.ts';
