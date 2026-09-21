import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { ConfigError, loadConfig, MIN_SECRET_BYTES } from '../../src/config.ts';

const MAIN = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
const GOOD_SECRET = 'x'.repeat(MIN_SECRET_BYTES);
const SHORT_SECRET = 'short';

test('a valid environment yields a frozen config with the documented defaults', () => {
  const config = loadConfig({ REQUISIT_TOKEN_SECRET: GOOD_SECRET });
  assert.equal(config.dbPath, './data/requisit.db');
  assert.equal(config.port, 3000);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.logLevel, 'info');
  assert.equal(config.activeKid, '1');
  assert.deepEqual(config.tokenKeys.get('1'), Buffer.from(GOOD_SECRET, 'utf8'));
  assert.ok(Object.isFrozen(config));
});

/**
 * `Object.freeze` does not freeze a `Map`: at the `dist/` boundary TypeScript is gone and
 * `ReadonlyMap` is only a type. D-018 says the config is frozen, so it must be frozen there
 * too.
 */
test('the key map cannot be mutated once the config is built', () => {
  const config = loadConfig({ REQUISIT_TOKEN_SECRET: GOOD_SECRET });
  const escaped = config.tokenKeys as unknown as Record<string, unknown>;
  assert.equal(typeof escaped['set'], 'undefined', 'a mutator survived onto the frozen view');
  assert.equal(typeof escaped['delete'], 'undefined');
  assert.equal(typeof escaped['clear'], 'undefined');
  assert.ok(Object.isFrozen(config.tokenKeys));
  assert.throws(() => {
    escaped['get'] = () => undefined;
  }, TypeError);
  // presence: the read side still works, including iteration.
  assert.deepEqual(config.tokenKeys.get('1'), Buffer.from(GOOD_SECRET, 'utf8'));
  assert.deepEqual([...config.tokenKeys.keys()], ['1']);
  assert.equal(config.tokenKeys.size, 1);
});

test('overrides are read and validated', () => {
  const config = loadConfig({
    REQUISIT_TOKEN_SECRET: GOOD_SECRET,
    REQUISIT_DB_PATH: '/tmp/x.db',
    PORT: '8080',
    NODE_ENV: 'test',
    REQUISIT_LOG_LEVEL: 'warn',
  });
  assert.equal(config.dbPath, '/tmp/x.db');
  assert.equal(config.port, 8080);
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.logLevel, 'warn');
});

test('a missing secret refuses to start', () => {
  assert.throws(() => loadConfig({}), ConfigError);
});

test('a short secret refuses to start and the message never carries the value', () => {
  try {
    loadConfig({ REQUISIT_TOKEN_SECRET: SHORT_SECRET });
    assert.fail('expected a ConfigError');
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /REQUISIT_TOKEN_SECRET/);
    assert.ok(!error.message.includes(SHORT_SECRET), 'the value must not appear in the message');
  }
});

test('a malformed PORT and NODE_ENV are refused by name, not by value', () => {
  for (const port of ['0', '-1', '65536', '1.5', 'eight', '1e3', '0x50', ' 80']) {
    assert.throws(() => loadConfig({ REQUISIT_TOKEN_SECRET: GOOD_SECRET, PORT: port }), ConfigError);
  }
  assert.throws(
    () => loadConfig({ REQUISIT_TOKEN_SECRET: GOOD_SECRET, NODE_ENV: 'staging' }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ REQUISIT_TOKEN_SECRET: GOOD_SECRET, REQUISIT_LOG_LEVEL: 'trace' }),
    ConfigError,
  );
});

test('the process exits 1 on a short secret and prints neither the value nor a stack', () => {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', MAIN],
    {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', REQUISIT_TOKEN_SECRET: SHORT_SECRET },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REQUISIT_TOKEN_SECRET/);
  // presence: the run really produced the refusal we are asserting the absence inside.
  assert.match(result.stderr, /configuration error/);
  assert.ok(!result.stderr.includes(SHORT_SECRET), 'stderr must not contain the secret');
  assert.ok(!result.stdout.includes(SHORT_SECRET), 'stdout must not contain the secret');
});
