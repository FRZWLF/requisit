import type { Migration } from '../migrate.ts';

/**
 * A fifth role, `merchant` (D-006 addendum, D-011 addendum, #5). The order feed is read by
 * the merchant integration of one organisation, and D-005 knows exactly one kind of
 * credential: a personal token that resolves to a person and to the roles that person holds
 * *now* (D-006). So the merchant integration is a person row like any other, and what makes
 * its token a merchant token is a role — not a second token format, not an org-wide API key
 * that could not answer "who acknowledged this".
 *
 * `person_roles.role` carries a `CHECK` constraint and SQLite cannot alter one, so the table
 * is rebuilt exactly as `0002` rebuilt the idempotency ledger. Every existing row is carried
 * over unchanged; nothing held `merchant` before this migration, so there is no data
 * question. Forward-only: this file never changes again (D-020).
 */
export const m0003: Migration = {
  id: 3,
  name: 'merchant_role',
  sql: `
CREATE TABLE person_roles_v2 (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  person_id  TEXT NOT NULL REFERENCES people(id),
  role       TEXT NOT NULL CHECK (role IN ('buyer', 'approver', 'finance', 'admin', 'merchant')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (org_id, person_id, role)
) STRICT;

INSERT INTO person_roles_v2 (org_id, person_id, role, granted_at)
  SELECT org_id, person_id, role, granted_at FROM person_roles;

DROP TABLE person_roles;
ALTER TABLE person_roles_v2 RENAME TO person_roles;
CREATE INDEX person_roles_by_org ON person_roles (org_id, person_id);
`,
};
