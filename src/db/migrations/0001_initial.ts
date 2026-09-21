import type { Migration } from '../migrate.ts';

/**
 * The whole Arc 1 schema in one migration: every table the later splits need exists from the
 * first run, so there is one migration story (issue #2). `idempotency_keys` and
 * `order_outbox` are created here and filled with behaviour by splits 02 and 04.
 *
 * Shape rules that the tenancy test enforces mechanically (D-004): every business table has
 * `org_id TEXT NOT NULL REFERENCES orgs(id)` and at least one index whose first column is
 * `org_id`. All tables are `STRICT` (D-002); timestamps are UTC ISO-8601 `TEXT` (D-017).
 */
export const m0001: Migration = {
  id: 1,
  name: 'initial',
  sql: `
CREATE TABLE orgs (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL,
  requisition_seq INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE people (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, email)
) STRICT;
CREATE INDEX people_by_org ON people (org_id, created_at);

CREATE TABLE person_roles (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  person_id  TEXT NOT NULL REFERENCES people(id),
  role       TEXT NOT NULL CHECK (role IN ('buyer', 'approver', 'finance', 'admin')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (org_id, person_id, role)
) STRICT;
CREATE INDEX person_roles_by_org ON person_roles (org_id, person_id);

CREATE TABLE cost_centres (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  owner_person_id TEXT NOT NULL REFERENCES people(id),
  created_at      TEXT NOT NULL,
  UNIQUE (org_id, code)
) STRICT;
CREATE INDEX cost_centres_by_org ON cost_centres (org_id, owner_person_id);

CREATE TABLE catalogue_items (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  currency         TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT NOT NULL,
  UNIQUE (org_id, sku)
) STRICT;
CREATE INDEX catalogue_items_by_org ON catalogue_items (org_id, active, sku);

CREATE TABLE approval_rules (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  seq             INTEGER NOT NULL,
  max_total_minor INTEGER NULL CHECK (max_total_minor IS NULL OR max_total_minor >= 0),
  approver_kind   TEXT NOT NULL CHECK (approver_kind IN ('self', 'cost_centre_owner', 'finance')),
  rule_code       TEXT NOT NULL,
  UNIQUE (org_id, seq),
  UNIQUE (org_id, rule_code)
) STRICT;
CREATE INDEX approval_rules_by_org ON approval_rules (org_id, seq);

CREATE TABLE requisitions (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  number          TEXT NOT NULL,
  buyer_person_id TEXT NOT NULL REFERENCES people(id),
  cost_centre_id  TEXT NOT NULL REFERENCES cost_centres(id),
  state           TEXT NOT NULL CHECK (state IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'ordered')),
  version         INTEGER NOT NULL DEFAULT 1,
  currency        TEXT NOT NULL,
  rule_id         TEXT NULL REFERENCES approval_rules(id),
  rule_code       TEXT NULL,
  copied_from_id  TEXT NULL REFERENCES requisitions(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  submitted_at    TEXT NULL,
  decided_at      TEXT NULL,
  UNIQUE (org_id, number)
) STRICT;
CREATE INDEX requisitions_by_org_state ON requisitions (org_id, state, updated_at);
CREATE INDEX requisitions_by_org_buyer ON requisitions (org_id, buyer_person_id);

CREATE TABLE requisition_lines (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES orgs(id),
  requisition_id    TEXT NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  catalogue_item_id TEXT NULL REFERENCES catalogue_items(id),
  description       TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor  INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  currency          TEXT NOT NULL,
  UNIQUE (org_id, requisition_id, seq)
) STRICT;
CREATE INDEX requisition_lines_by_org ON requisition_lines (org_id, requisition_id, seq);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  requisition_id  TEXT NULL REFERENCES requisitions(id),
  actor_person_id TEXT NULL REFERENCES people(id),
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  action          TEXT NOT NULL,
  from_state      TEXT NULL,
  to_state        TEXT NULL,
  rule_id         TEXT NULL REFERENCES approval_rules(id),
  total_minor     INTEGER NULL,
  currency        TEXT NULL,
  reason          TEXT NULL,
  at              TEXT NOT NULL,
  request_id      TEXT NULL
) STRICT;
CREATE INDEX audit_log_by_org ON audit_log (org_id, requisition_id, id);


CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE idempotency_keys (
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  endpoint    TEXT NOT NULL,
  key         TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (org_id, endpoint, key)
) STRICT;
CREATE INDEX idempotency_keys_by_org ON idempotency_keys (org_id, created_at);

CREATE TABLE order_outbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         TEXT NOT NULL REFERENCES orgs(id),
  requisition_id TEXT NOT NULL REFERENCES requisitions(id),
  payload_json   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  delivered_at   TEXT NULL,
  ack_by         TEXT NULL
) STRICT;
CREATE INDEX order_outbox_by_org ON order_outbox (org_id, id);
`,
};
