import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface PackageJson {
  readonly type?: string;
  readonly engines?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as PackageJson;

/** D-001 is a policy, so it needs a check that fails when someone adds a package. */
test('the service has zero runtime dependencies', () => {
  const dependencies = pkg.dependencies ?? {};
  assert.deepEqual(
    Object.keys(dependencies),
    [],
    'D-001: the only allowed "dependencies" entry is none',
  );
});

test('devDependencies stay within the three D-001 names', () => {
  const allowed = new Set(['typescript', 'eslint', '@types/node']);
  const actual = Object.keys(pkg.devDependencies ?? {});
  assert.ok(actual.length > 0, 'presence: there are devDependencies to check');
  for (const name of actual) {
    assert.ok(allowed.has(name), `unexpected devDependency: ${name}`);
  }
});

test('the package is ESM and pins Node 24 or newer', () => {
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines?.['node'], '>=24');
});

test('the board scripts exist', () => {
  for (const script of ['typecheck', 'test', 'lint', 'build', 'start', 'mint-token']) {
    assert.ok(pkg.scripts?.[script], `missing npm script: ${script}`);
  }
});
