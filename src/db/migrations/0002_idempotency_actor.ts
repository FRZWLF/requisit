import type { Migration } from '../migrate.ts';

/**
 * The idempotency ledger gains the acting person (D-010 addendum, #3 review). `(org_id,
 * endpoint, key)` made the key namespace shared by every member of an organisation: a member
 * could replay another member's stored response — including an approve's `200` they had no
 * authority for — and, worse, could *pre-claim* a key with their own refusal so that the
 * person who did have the authority was handed a replayed `403` for the row's whole TTL.
 *
 * SQLite cannot alter a primary key, so the table is rebuilt. Existing rows keep their
 * answers under the empty actor (`''`, which is also what a person-less system actor uses);
 * they expire with the 24 h sweep. Forward-only: this file never changes again (D-020).
 */
export const m0002: Migration = {
  id: 2,
  name: 'idempotency_actor',
  sql: `
CREATE TABLE idempotency_keys_v2 (
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  actor_person_id TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  key             TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  status          INTEGER NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (org_id, actor_person_id, endpoint, key)
) STRICT;

INSERT INTO idempotency_keys_v2
  (org_id, actor_person_id, endpoint, key, fingerprint, status, body, created_at)
  SELECT org_id, '', endpoint, key, fingerprint, status, body, created_at
    FROM idempotency_keys;

DROP TABLE idempotency_keys;
ALTER TABLE idempotency_keys_v2 RENAME TO idempotency_keys;
CREATE INDEX idempotency_keys_by_org ON idempotency_keys (org_id, created_at);
`,
};
