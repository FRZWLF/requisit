import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRefusal } from '../../src/refusal.ts';
import {
  MAX_SAFE_MINOR,
  UnknownCurrencyError,
  currencyExponent,
  formatMoney,
  lineTotal,
  roundHalfUp,
  sumMoney,
} from '../../src/domain/money.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(`${full}/`));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('the exponent table is checked in, never assumed to be 2', () => {
  assert.equal(currencyExponent('EUR'), 2);
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('GBP'), 2);
  assert.equal(currencyExponent('CHF'), 2);
  assert.equal(currencyExponent('JPY'), 0);
  assert.throws(() => currencyExponent('XXX'), UnknownCurrencyError);
  assert.throws(() => currencyExponent('eur'), UnknownCurrencyError);
});

test('lineTotal multiplies exactly', () => {
  assert.deepEqual(lineTotal(1999, 3, 'EUR'), { amountMinor: 5997, currency: 'EUR' });
  assert.deepEqual(lineTotal(0, 5, 'EUR'), { amountMinor: 0, currency: 'EUR' });
  assert.deepEqual(lineTotal(1234, 1, 'JPY'), { amountMinor: 1234, currency: 'JPY' });
});

test('lineTotal refuses everything that is not an exact non-negative count', () => {
  const bad: [number, number][] = [
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [1e308, 1],
    [100, 0],
    [100, -3],
    [100, 1.5],
    [100, Number.NaN],
    [100, Number.POSITIVE_INFINITY],
  ];
  for (const [price, quantity] of bad) {
    const result = lineTotal(price, quantity, 'EUR');
    assert.ok(isRefusal(result), `expected a refusal for (${price}, ${quantity})`);
    assert.equal(isRefusal(result) ? result.code : '', 'validation_failed');
  }
  assert.ok(isRefusal(lineTotal(100, 1, 'XXX')));
});

test('the 2^53-1 ceiling from D-003 is pinned and enforced', () => {
  assert.equal(MAX_SAFE_MINOR, 2 ** 53 - 1);
  assert.deepEqual(lineTotal(MAX_SAFE_MINOR, 1, 'EUR'), {
    amountMinor: MAX_SAFE_MINOR,
    currency: 'EUR',
  });
  assert.ok(isRefusal(lineTotal(MAX_SAFE_MINOR, 2, 'EUR')));
  assert.ok(isRefusal(lineTotal(Math.floor(MAX_SAFE_MINOR / 2) + 1, 2, 'EUR')));
});

test('sumMoney adds one currency and refuses a mix', () => {
  assert.deepEqual(sumMoney('EUR', []), { amountMinor: 0, currency: 'EUR' });
  assert.deepEqual(
    sumMoney('EUR', [
      { amountMinor: 100, currency: 'EUR' },
      { amountMinor: 250, currency: 'EUR' },
    ]),
    { amountMinor: 350, currency: 'EUR' },
  );
  const mixed = sumMoney('EUR', [
    { amountMinor: 100, currency: 'EUR' },
    { amountMinor: 500, currency: 'JPY' },
  ]);
  assert.ok(isRefusal(mixed));
  assert.equal(isRefusal(mixed) ? mixed.code : '', 'validation_failed');
});

test('sumMoney refuses rather than losing precision at the ceiling', () => {
  const overflow = sumMoney('EUR', [
    { amountMinor: MAX_SAFE_MINOR, currency: 'EUR' },
    { amountMinor: 1, currency: 'EUR' },
  ]);
  assert.ok(isRefusal(overflow));
  assert.deepEqual(sumMoney('EUR', [{ amountMinor: MAX_SAFE_MINOR, currency: 'EUR' }]), {
    amountMinor: MAX_SAFE_MINOR,
    currency: 'EUR',
  });
});

test('formatMoney uses the exponent, so JPY has no fraction digits', () => {
  const jpy = formatMoney({ amountMinor: 1234, currency: 'JPY' }, 'ja-JP');
  assert.ok(!jpy.includes('.'), `JPY must not be formatted with decimals: ${jpy}`);
  assert.match(jpy, /1,?234/);
  const eur = formatMoney({ amountMinor: 1234, currency: 'EUR' }, 'de-DE');
  assert.match(eur, /12,34/);
});

test('roundHalfUp rounds .5 away from zero and rejects a bad ratio', () => {
  assert.equal(roundHalfUp(5, 10), 1);
  assert.equal(roundHalfUp(4, 10), 0);
  assert.equal(roundHalfUp(15, 10), 2);
  assert.equal(roundHalfUp(0, 3), 0);
  assert.equal(roundHalfUp(7, 1), 7);
  assert.throws(() => roundHalfUp(-1, 10), RangeError);
  assert.throws(() => roundHalfUp(1, 0), RangeError);
  assert.throws(() => roundHalfUp(1.5, 2), RangeError);
});

test('v1 needs no rounding: nothing in src/ outside money.ts calls roundHalfUp', () => {
  const callers = sourceFiles(SRC).filter(
    (file) => !file.endsWith('domain/money.ts') && !file.endsWith('index.ts'),
  );
  assert.ok(callers.length > 10, 'presence: there are source files to scan');
  // presence: the same scan finds the reference that does exist.
  assert.match(readFileSync(`${SRC}index.ts`, 'utf8'), /roundHalfUp/);
  for (const file of callers) {
    assert.ok(
      !readFileSync(file, 'utf8').includes('roundHalfUp'),
      `D-003: roundHalfUp is referenced outside money.ts, in ${file}`,
    );
  }
});
