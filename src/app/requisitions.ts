import type { DatabaseSync } from 'node:sqlite';
import { toIso, type Clock } from '../clock.ts';
import { log } from '../log.ts';
import { isRefusal, refuse, type Refusal, type Result } from '../refusal.ts';
import { hasRole, type OrgScope } from '../db/scope.ts';
import type { Tx } from '../db/tx.ts';
import { auditRepo } from '../db/repos/audit.ts';
import { costCentresRepo } from '../db/repos/cost-centres.ts';
import { rulesRepo } from '../db/repos/rules.ts';
import {
  requisitionsRepo,
  type DraftLineInput,
  type ListFilter,
} from '../db/repos/requisitions.ts';
import { lineTotal, sumMoney, type Money } from '../domain/money.ts';
import { matchRule, resolveApprover } from '../domain/rules.ts';
import {
  allowedActions,
  decide,
  mayDecide,
  relationOf,
  type Action,
  type ActorRelation,
  type DecideRule,
} from '../domain/lifecycle.ts';
import type {
  ApprovalRule,
  ApproverKind,
  AuditLine,
  CostCentre,
  RequisitionState,
  RequisitionWithLines,
} from '../domain/types.ts';

/**
 * The requisition use cases (D-008…D-010, D-024). Every mutating function takes the `Tx` the
 * caller opened — it never opens one itself — and returns a `Result`, so the HTTP layer maps
 * and the transaction boundary stays with whoever owns the request. This is the seam the
 * lifecycle/authority suite drives without HTTP, and the seam split 04 extends.
 */

export interface ServiceContext {
  readonly db: DatabaseSync;
  readonly scope: OrgScope;
  readonly clock: Clock;
  readonly requestId: string;
}

export type RuleSource = 'stored' | 'would_match';

export interface RuleView {
  readonly id: string;
  readonly ruleCode: string;
  readonly approverKind: ApproverKind;
  readonly maxTotalMinor: number | null;
  readonly source: RuleSource;
}

export interface AwaitingView {
  readonly kind: ApproverKind;
  readonly personId: string | null;
}

export interface LineView {
  readonly id: string;
  readonly seq: number;
  readonly catalogueItemId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly currency: string;
  readonly lineTotalMinor: number;
}

export interface RequisitionSummary {
  readonly id: string;
  readonly orgId: string;
  readonly number: string;
  readonly state: RequisitionState;
  readonly version: number;
  readonly currency: string;
  readonly buyerPersonId: string;
  readonly costCentreId: string;
  readonly ruleId: string | null;
  readonly ruleCode: string | null;
  readonly copiedFromId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly total: Money;
  readonly rule: RuleView | null;
  readonly awaiting: AwaitingView | null;
  readonly actions: readonly Action[];
}

export interface RequisitionDetail extends RequisitionSummary {
  readonly lines: readonly LineView[];
  readonly history: readonly AuditLine[];
}

export interface RuleRowView {
  readonly id: string;
  readonly seq: number;
  readonly maxTotalMinor: number | null;
  readonly approverKind: ApproverKind;
  readonly ruleCode: string;
}

export interface CreateInput {
  readonly costCentreId: string;
  readonly lines: readonly DraftLineInput[];
}

export interface UpdateInput {
  readonly costCentreId?: string;
  readonly lines?: readonly DraftLineInput[];
  readonly version?: number;
}

export interface DecisionInput {
  readonly version?: number;
  readonly reason?: string;
}

export interface ListInput {
  readonly state?: RequisitionState;
  readonly mine?: boolean;
  readonly awaitingMe?: boolean;
}

export const MAX_REASON_CHARS = 500;

interface Repos {
  readonly requisitions: ReturnType<typeof requisitionsRepo>;
  readonly rules: ReturnType<typeof rulesRepo>;
  readonly costCentres: ReturnType<typeof costCentresRepo>;
  readonly audit: ReturnType<typeof auditRepo>;
}

/**
 * One repository set per `ServiceContext` — a context is one request, so the ~20 `db.prepare`
 * calls a factory makes happen once per request instead of once per `repos()` call (a single
 * `submit` used to build them five to eight times). The cache is keyed on the context object
 * itself, so a second request with a different scope can never reach the first one's
 * statements, and nothing is retained once the request object is gone (#3 review, M-002).
 */
const REPO_CACHE = new WeakMap<ServiceContext, Repos>();

function repos(ctx: ServiceContext): Repos {
  const cached = REPO_CACHE.get(ctx);
  if (cached !== undefined) {
    return cached;
  }
  const built: Repos = {
    requisitions: requisitionsRepo(ctx.db, ctx.scope, ctx.clock),
    rules: rulesRepo(ctx.db, ctx.scope),
    costCentres: costCentresRepo(ctx.db, ctx.scope, ctx.clock),
    audit: auditRepo(ctx.db, ctx.scope, ctx.clock),
  };
  REPO_CACHE.set(ctx, built);
  return built;
}

/**
 * A refused audit line means an invariant broke: the requisition and the actor were both
 * loaded through this very scope a few statements ago. Returning the refusal would commit a
 * state change without its line — exactly the D-007 failure — so it throws, the transaction
 * rolls back and the caller answers 500.
 */
function mustAudit(written: Result<AuditLine>): AuditLine {
  if (isRefusal(written)) {
    throw new Error(`audit line refused: ${written.code} ${written.detail ?? ''}`.trimEnd());
  }
  return written;
}

/**
 * The total of rows this service just wrote. `prepareLines` validates every line *and their
 * sum* before the first INSERT, so a refusal here means the database holds a line set the
 * repository would have refused — an invariant, not a client error. Returning it would commit
 * a state change with no audit line and store a `400` under the caller's idempotency key, so
 * it throws, the transaction rolls back and the caller gets a 500 (#3 review, D-007, D-010).
 */
function mustTotal(total: Result<Money>): Money {
  if (isRefusal(total)) {
    throw new Error(`total refused after a write: ${total.code} ${total.detail ?? ''}`.trimEnd());
  }
  return total;
}

function totalOf(requisition: RequisitionWithLines): Result<Money> {
  const parts: Money[] = [];
  for (const line of requisition.lines) {
    const amount = lineTotal(line.unitPriceMinor, line.quantity, line.currency);
    if (isRefusal(amount)) {
      return amount;
    }
    parts.push(amount);
  }
  return sumMoney(requisition.currency, parts);
}

function ruleFacts(rule: ApprovalRule | null): DecideRule | null {
  return rule === null ? null : { ruleCode: rule.ruleCode, approverKind: rule.approverKind };
}

interface Loaded {
  readonly requisition: RequisitionWithLines;
  readonly total: Money;
  readonly rule: ApprovalRule | null;
  readonly ruleSource: RuleSource | null;
  readonly costCentre: CostCentre | null;
  readonly relation: ActorRelation;
}

/**
 * One load path for reads and writes alike. A submitted requisition's rule is re-read by the
 * stored `rule_id` and never re-matched; a draft is shown the rule that *would* match.
 * A stored id with no row leaves `rule: null` — fail closed, nobody becomes the approver.
 */
function load(ctx: ServiceContext, id: string): Result<Loaded> {
  const repo = repos(ctx);
  const requisition = repo.requisitions.byId(id);
  if (isRefusal(requisition)) {
    return requisition;
  }
  const total = totalOf(requisition);
  if (isRefusal(total)) {
    return total;
  }

  let rule: ApprovalRule | null = null;
  let ruleSource: RuleSource | null = null;
  if (requisition.ruleId !== null) {
    const stored = repo.rules.byId(requisition.ruleId);
    if (!isRefusal(stored)) {
      rule = stored;
      ruleSource = 'stored';
    }
  } else {
    const matched = matchRule(repo.rules.listBySeq(), total.amountMinor);
    if (!isRefusal(matched)) {
      rule = matched;
      ruleSource = 'would_match';
    }
  }

  const centre = repo.costCentres.byId(requisition.costCentreId);
  const costCentre = isRefusal(centre) ? null : centre;
  return {
    requisition,
    total,
    rule,
    ruleSource,
    costCentre,
    relation: relationOf(ctx.scope, requisition, rule, costCentre),
  };
}

function toLineViews(requisition: RequisitionWithLines): Result<LineView[]> {
  const views: LineView[] = [];
  for (const line of requisition.lines) {
    const amount = lineTotal(line.unitPriceMinor, line.quantity, line.currency);
    if (isRefusal(amount)) {
      return amount;
    }
    views.push({
      id: line.id,
      seq: line.seq,
      catalogueItemId: line.catalogueItemId,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      currency: line.currency,
      lineTotalMinor: amount.amountMinor,
    });
  }
  return views;
}

function summaryOf(ctx: ServiceContext, loaded: Loaded): RequisitionSummary {
  const { requisition, rule, costCentre } = loaded;
  const ruleView: RuleView | null =
    rule === null || loaded.ruleSource === null
      ? null
      : {
          id: rule.id,
          ruleCode: rule.ruleCode,
          approverKind: rule.approverKind,
          maxTotalMinor: rule.maxTotalMinor,
          source: loaded.ruleSource,
        };
  const awaiting: AwaitingView | null =
    requisition.state === 'submitted' && rule !== null && costCentre !== null
      ? (() => {
          const spec = resolveApprover(rule, requisition, costCentre);
          return { kind: spec.kind, personId: spec.personId };
        })()
      : null;
  return {
    id: requisition.id,
    orgId: requisition.orgId,
    number: requisition.number,
    state: requisition.state,
    version: requisition.version,
    currency: requisition.currency,
    buyerPersonId: requisition.buyerPersonId,
    costCentreId: requisition.costCentreId,
    ruleId: requisition.ruleId,
    ruleCode: requisition.ruleCode,
    copiedFromId: requisition.copiedFromId,
    createdAt: requisition.createdAt,
    updatedAt: requisition.updatedAt,
    submittedAt: requisition.submittedAt,
    decidedAt: requisition.decidedAt,
    total: loaded.total,
    rule: ruleView,
    awaiting,
    actions: allowedActions(requisition.state, loaded.relation, {
      hasBuyerRole: hasRole(ctx.scope, 'buyer'),
    }),
  };
}

function detailOf(ctx: ServiceContext, loaded: Loaded): Result<RequisitionDetail> {
  const lines = toLineViews(loaded.requisition);
  if (isRefusal(lines)) {
    return lines;
  }
  return {
    ...summaryOf(ctx, loaded),
    lines,
    history: repos(ctx).audit.listForRequisition(loaded.requisition.id),
  };
}

function reload(ctx: ServiceContext, id: string): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  return detailOf(ctx, loaded);
}

function buyerRoleGuard(ctx: ServiceContext, action: Action): Refusal | null {
  if (hasRole(ctx.scope, 'buyer')) {
    return null;
  }
  return refuse('not_authorised', `the buyer role is required to ${action} a requisition`);
}

function versionGuard(
  expected: number | undefined,
  actual: number,
  requisitionId: string,
): Refusal | null {
  if (expected === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(expected) || expected < 1) {
    return refuse('validation_failed', 'version must be a positive safe integer', {
      requisitionId,
    });
  }
  if (expected !== actual) {
    return refuse(
      'conflict',
      `expected version ${String(expected)}, found ${String(actual)}`,
      { requisitionId },
    );
  }
  return null;
}

function actorPersonId(ctx: ServiceContext): Result<string> {
  const personId = ctx.scope.actor.personId;
  if (personId === null) {
    return refuse('not_authorised', 'this token identifies no person');
  }
  return personId;
}

interface AuditFacts {
  readonly action: string;
  readonly fromState: RequisitionState | null;
  readonly toState: RequisitionState | null;
  readonly ruleId: string | null;
  readonly total: Money;
  readonly reason: string | null;
  readonly bySystem?: boolean;
}

function writeLine(ctx: ServiceContext, tx: Tx, requisitionId: string, facts: AuditFacts): void {
  const bySystem = facts.bySystem === true;
  mustAudit(
    repos(ctx).audit.writeAudit(tx, {
      requisitionId,
      actorPersonId: bySystem ? null : ctx.scope.actor.personId,
      actorKind: bySystem ? 'system' : ctx.scope.actor.kind,
      action: facts.action,
      fromState: facts.fromState,
      toState: facts.toState,
      ruleId: facts.ruleId,
      totalMinor: facts.total.amountMinor,
      currency: facts.total.currency,
      reason: facts.reason,
      requestId: ctx.requestId,
    }),
  );
}

/**
 * The single function that writes `approved` — the automatic self-rule approval and the
 * manual one both come through here, so split 04 adds the outbox row in exactly one place
 * (D-011). The version guard has already been compared by the caller inside this `Tx`.
 */
export function recordApproval(
  ctx: ServiceContext,
  tx: Tx,
  requisition: RequisitionWithLines,
  rule: ApprovalRule,
  total: Money,
  options: { readonly bySystem: boolean },
): RequisitionWithLines {
  const repo = repos(ctx);
  const now = toIso(ctx.clock.now());
  const after = repo.requisitions.transition(tx, {
    id: requisition.id,
    expectedVersion: requisition.version,
    toState: 'approved',
    ruleId: rule.id,
    ruleCode: rule.ruleCode,
    submittedAt: requisition.submittedAt,
    decidedAt: now,
  });
  writeLine(ctx, tx, requisition.id, {
    action: 'approve',
    fromState: requisition.state,
    toState: 'approved',
    ruleId: rule.id,
    total,
    reason: null,
    bySystem: options.bySystem,
  });
  return after;
}

export function createDraft(
  ctx: ServiceContext,
  tx: Tx,
  input: CreateInput,
): Result<RequisitionDetail> {
  const denied = buyerRoleGuard(ctx, 'edit');
  if (denied !== null) {
    return denied;
  }
  const buyer = actorPersonId(ctx);
  if (isRefusal(buyer)) {
    return buyer;
  }
  const written = repos(ctx).requisitions.insertDraft(tx, {
    buyerPersonId: buyer,
    costCentreId: input.costCentreId,
    lines: input.lines,
  });
  if (isRefusal(written)) {
    return written;
  }
  const total = mustTotal(totalOf(written));
  writeLine(ctx, tx, written.id, {
    action: 'draft.created',
    fromState: null,
    toState: 'draft',
    ruleId: null,
    total,
    reason: null,
  });
  return reload(ctx, written.id);
}

export function updateDraft(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  input: UpdateInput,
): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  const moved = decide(loaded.requisition.state, 'edit', loaded.relation, {
    requisitionId: id,
    rule: null,
    isBuyer: ctx.scope.actor.personId === loaded.requisition.buyerPersonId,
  });
  if (isRefusal(moved)) {
    return moved;
  }
  // D-023's order: validation, then the state check, then authority — so a member without
  // the buyer role learns `wrong_state` on a row nobody may edit, not `not_authorised`
  // (#3 review). Both refuse; only the wording differs.
  const denied = buyerRoleGuard(ctx, 'edit');
  if (denied !== null) {
    return denied;
  }
  const stale = versionGuard(input.version, loaded.requisition.version, id);
  if (stale !== null) {
    return stale;
  }

  const replaceInput: { costCentreId?: string; lines?: readonly DraftLineInput[] } = {};
  if (input.costCentreId !== undefined) {
    replaceInput.costCentreId = input.costCentreId;
  }
  if (input.lines !== undefined) {
    replaceInput.lines = input.lines;
  }
  const written = repos(ctx).requisitions.replaceDraft(tx, id, replaceInput);
  if (isRefusal(written)) {
    return written;
  }
  const total = mustTotal(totalOf(written));
  writeLine(ctx, tx, id, {
    action: 'draft.updated',
    fromState: loaded.requisition.state,
    toState: moved,
    ruleId: null,
    total,
    reason: null,
  });
  return reload(ctx, id);
}

export function submit(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  input: DecisionInput,
): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  const moved = decide(loaded.requisition.state, 'submit', loaded.relation, {
    requisitionId: id,
    rule: null,
    isBuyer: ctx.scope.actor.personId === loaded.requisition.buyerPersonId,
  });
  if (isRefusal(moved)) {
    return moved;
  }
  // D-023's order: validation, then the state check, then authority — so a member without
  // the buyer role learns `wrong_state` on a row nobody may submit, not `not_authorised`
  // (#3 review). Both refuse; only the wording differs.
  const denied = buyerRoleGuard(ctx, 'submit');
  if (denied !== null) {
    return denied;
  }
  const stale = versionGuard(input.version, loaded.requisition.version, id);
  if (stale !== null) {
    return stale;
  }
  const repo = repos(ctx);
  // Matched here, once, and stored on the row: a later edit of the rule table must not
  // change who may decide a requisition that is already in flight (D-008 addendum).
  const rule = matchRule(repo.rules.listBySeq(), loaded.total.amountMinor);
  if (isRefusal(rule)) {
    return refuse(rule.code, rule.detail, { requisitionId: id });
  }

  const now = toIso(ctx.clock.now());
  const submitted = repo.requisitions.transition(tx, {
    id,
    expectedVersion: loaded.requisition.version,
    toState: moved,
    ruleId: rule.id,
    ruleCode: rule.ruleCode,
    submittedAt: now,
    decidedAt: null,
  });
  writeLine(ctx, tx, id, {
    action: 'submit',
    fromState: loaded.requisition.state,
    toState: moved,
    ruleId: rule.id,
    total: loaded.total,
    reason: null,
  });

  if (rule.approverKind === 'self') {
    // The one automatic decision: same transaction, its own audit line, a `system` actor.
    const auto = decide(submitted.state, 'approve', 'system', { requisitionId: id });
    if (isRefusal(auto)) {
      return auto;
    }
    recordApproval(ctx, tx, submitted, rule, loaded.total, { bySystem: true });
  }
  return reload(ctx, id);
}

function decideManually(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  action: 'approve' | 'reject',
  input: DecisionInput,
): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  // Validation runs before the state check, the state check before authority (D-023).
  if (input.version === undefined) {
    return refuse('validation_failed', `${action} requires the requisition's version`, {
      requisitionId: id,
    });
  }
  let reason: string | null = null;
  if (action === 'reject') {
    const trimmed = (input.reason ?? '').trim();
    if (trimmed === '' || trimmed.length > MAX_REASON_CHARS) {
      return refuse(
        'validation_failed',
        `reject requires a reason of 1 to ${String(MAX_REASON_CHARS)} characters`,
        { requisitionId: id },
      );
    }
    reason = trimmed;
  }

  const moved = decide(loaded.requisition.state, action, loaded.relation, {
    requisitionId: id,
    rule: ruleFacts(loaded.rule),
    isBuyer: ctx.scope.actor.personId === loaded.requisition.buyerPersonId,
  });
  if (isRefusal(moved)) {
    return moved;
  }
  const stale = versionGuard(input.version, loaded.requisition.version, id);
  if (stale !== null) {
    return stale;
  }
  const rule = loaded.rule;
  if (rule === null) {
    // Fail closed: without the stored rule nobody is the resolved approver. `decide` has
    // already refused above; this is the compiler's copy of the same fact.
    return refuse('not_authorised', `no stored rule governs ${action} on this requisition`, {
      requisitionId: id,
    });
  }

  if (action === 'approve') {
    recordApproval(ctx, tx, loaded.requisition, rule, loaded.total, { bySystem: false });
    return reload(ctx, id);
  }

  repos(ctx).requisitions.transition(tx, {
    id,
    expectedVersion: loaded.requisition.version,
    toState: moved,
    ruleId: rule.id,
    ruleCode: rule.ruleCode,
    submittedAt: loaded.requisition.submittedAt,
    decidedAt: toIso(ctx.clock.now()),
  });
  writeLine(ctx, tx, id, {
    action: 'reject',
    fromState: loaded.requisition.state,
    toState: moved,
    ruleId: rule.id,
    total: loaded.total,
    reason,
  });
  return reload(ctx, id);
}

export function approve(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  input: DecisionInput,
): Result<RequisitionDetail> {
  return decideManually(ctx, tx, id, 'approve', input);
}

export function reject(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  input: DecisionInput,
): Result<RequisitionDetail> {
  return decideManually(ctx, tx, id, 'reject', input);
}

export function cancel(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
  input: DecisionInput,
): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length > MAX_REASON_CHARS) {
    return refuse(
      'validation_failed',
      `a cancellation reason may be at most ${String(MAX_REASON_CHARS)} characters`,
      { requisitionId: id },
    );
  }
  const moved = decide(loaded.requisition.state, 'cancel', loaded.relation, {
    requisitionId: id,
    rule: null,
    isBuyer: ctx.scope.actor.personId === loaded.requisition.buyerPersonId,
  });
  if (isRefusal(moved)) {
    return moved;
  }
  // D-023's order: validation, then the state check, then authority — so a member without
  // the buyer role learns `wrong_state` on a row nobody may cancel, not `not_authorised`
  // (#3 review). Both refuse; only the wording differs.
  const denied = buyerRoleGuard(ctx, 'cancel');
  if (denied !== null) {
    return denied;
  }
  const stale = versionGuard(input.version, loaded.requisition.version, id);
  if (stale !== null) {
    return stale;
  }
  repos(ctx).requisitions.transition(tx, {
    id,
    expectedVersion: loaded.requisition.version,
    toState: moved,
    ruleId: loaded.requisition.ruleId,
    ruleCode: loaded.requisition.ruleCode,
    submittedAt: loaded.requisition.submittedAt,
    // `decided_at` is when an approver decided. Cancelling a **draft** decides nothing and
    // nobody ever approved it, so the column stays as it was; cancelling a `submitted` row
    // ends a decision that was pending, and stamps it (#3 review, D-009).
    decidedAt:
      loaded.requisition.state === 'submitted'
        ? toIso(ctx.clock.now())
        : loaded.requisition.decidedAt,
  });
  writeLine(ctx, tx, id, {
    action: 'cancel',
    fromState: loaded.requisition.state,
    toState: moved,
    ruleId: loaded.requisition.ruleId,
    total: loaded.total,
    reason: reason === '' ? null : reason,
  });
  return reload(ctx, id);
}

export function copyForward(
  ctx: ServiceContext,
  tx: Tx,
  id: string,
): Result<RequisitionDetail> {
  const loaded = load(ctx, id);
  if (isRefusal(loaded)) {
    return loaded;
  }
  const moved = decide(loaded.requisition.state, 'copy', loaded.relation, {
    requisitionId: id,
    rule: null,
    isBuyer: ctx.scope.actor.personId === loaded.requisition.buyerPersonId,
  });
  if (isRefusal(moved)) {
    return moved;
  }
  // D-023's order: validation, then the state check, then authority — so a member without
  // the buyer role learns `wrong_state` on a row nobody may copy, not `not_authorised`
  // (#3 review). Both refuse; only the wording differs.
  const denied = buyerRoleGuard(ctx, 'copy');
  if (denied !== null) {
    return denied;
  }
  const copy = repos(ctx).requisitions.copyForward(tx, id);
  if (isRefusal(copy)) {
    return copy;
  }
  const total = mustTotal(totalOf(copy));
  // The line lands on the **new** draft; the rejected source keeps its own history intact.
  writeLine(ctx, tx, copy.id, {
    action: 'draft.copied',
    fromState: loaded.requisition.state,
    toState: moved,
    ruleId: null,
    total,
    reason: null,
  });
  return reload(ctx, copy.id);
}

export function detail(ctx: ServiceContext, id: string): Result<RequisitionDetail> {
  return reload(ctx, id);
}

/**
 * `awaiting_me` is computed over the submitted rows rather than read from a column, because
 * a `finance` rule resolves to a role, not a person (D-024). M-002 measures what that costs.
 */
export function list(ctx: ServiceContext, input: ListInput): Result<{ items: RequisitionSummary[] }> {
  if (input.awaitingMe === true && input.state !== undefined && input.state !== 'submitted') {
    return { items: [] };
  }
  // A filter that cannot be honoured is refused, never widened: `mine` for a scope that is
  // not a person used to silently hand back the whole organisation (#3 review, D-024).
  if (input.mine === true && ctx.scope.actor.personId === null) {
    return refuse('not_authorised', 'this token identifies no person, so it owns no requisitions');
  }
  const filter: ListFilter = {
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.awaitingMe === true && input.state === undefined ? { state: 'submitted' as const } : {}),
    ...(input.mine === true && ctx.scope.actor.personId !== null
      ? { buyerPersonId: ctx.scope.actor.personId }
      : {}),
  };
  const repo = repos(ctx);
  const ruleTable = repo.rules.listBySeq();
  const byRuleId = new Map(ruleTable.map((rule) => [rule.id, rule]));
  const items: RequisitionSummary[] = [];
  for (const requisition of repo.requisitions.listWithLines(filter)) {
    const total = totalOf(requisition);
    if (isRefusal(total)) {
      // No write path can produce such a row any more (`prepareLines` sums before it inserts),
      // but one bad row must never be able to answer `400` for the whole organisation's shared
      // queue: it is skipped and named in the log instead (#3 review, D-024).
      log('warn', 'requisition skipped: its lines cannot be totalled', {
        requisitionId: requisition.id,
        orgId: requisition.orgId,
        requestId: ctx.requestId,
        code: total.code,
      });
      continue;
    }
    let rule: ApprovalRule | null = null;
    let ruleSource: RuleSource | null = null;
    if (requisition.ruleId !== null) {
      rule = byRuleId.get(requisition.ruleId) ?? null;
      ruleSource = rule === null ? null : 'stored';
    } else {
      const matched = matchRule(ruleTable, total.amountMinor);
      if (!isRefusal(matched)) {
        rule = matched;
        ruleSource = 'would_match';
      }
    }
    const centre = repo.costCentres.byId(requisition.costCentreId);
    const costCentre = isRefusal(centre) ? null : centre;
    const loaded: Loaded = {
      requisition,
      total,
      rule,
      ruleSource,
      costCentre,
      relation: relationOf(ctx.scope, requisition, rule, costCentre),
    };
    if (input.awaitingMe === true) {
      const decidable =
        rule !== null && costCentre !== null && mayDecide(ctx.scope, requisition, rule, costCentre);
      if (!decidable) {
        continue;
      }
    }
    items.push(summaryOf(ctx, loaded));
  }
  return { items };
}

export function ruleTable(ctx: ServiceContext): { items: RuleRowView[] } {
  return {
    items: repos(ctx).rules.listBySeq().map((rule) => ({
      id: rule.id,
      seq: rule.seq,
      maxTotalMinor: rule.maxTotalMinor,
      approverKind: rule.approverKind,
      ruleCode: rule.ruleCode,
    })),
  };
}
