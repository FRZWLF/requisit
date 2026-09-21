import { refuse, type Result } from '../refusal.ts';

/**
 * Money is an integer count of minor units plus an ISO 4217 code (D-003). Totals are
 * computed, never stored; exponents come from a checked-in table, never assumed to be 2.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** Minor units stay exact up to 2^53-1 — the ceiling every arithmetic helper below checks. */
export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export class UnknownCurrencyError extends Error {
  constructor(code: string) {
    super(`unknown currency code: ${code}`);
    this.name = 'UnknownCurrencyError';
  }
}

const EXPONENTS: Readonly<Record<string, number>> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
};

export function currencyExponent(code: string): number {
  const exponent = EXPONENTS[code];
  if (exponent === undefined) {
    throw new UnknownCurrencyError(code);
  }
  return exponent;
}

export function isKnownCurrency(code: string): boolean {
  return Object.hasOwn(EXPONENTS, code);
}

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor, currency };
}

/**
 * `unitPriceMinor * quantity`, exact. Refuses rather than overflowing: `NaN`, `Infinity`,
 * a fraction, a negative price, a quantity below 1 or a product past the ceiling.
 */
export function lineTotal(
  unitPriceMinor: number,
  quantity: number,
  currency: string,
): Result<Money> {
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    return refuse('validation_failed', 'unitPriceMinor must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return refuse('validation_failed', 'quantity must be an integer of at least 1');
  }
  if (!isKnownCurrency(currency)) {
    return refuse('validation_failed', `unknown currency: ${currency}`);
  }
  // Division before multiplication: the product is never formed if it would exceed the ceiling.
  if (unitPriceMinor > Math.floor(MAX_SAFE_MINOR / quantity)) {
    return refuse('validation_failed', 'line total exceeds the safe integer ceiling');
  }
  return { amountMinor: unitPriceMinor * quantity, currency };
}

/** Sums amounts that must all carry `currency`. An empty list is zero in that currency. */
export function sumMoney(currency: string, items: readonly Money[]): Result<Money> {
  if (!isKnownCurrency(currency)) {
    return refuse('validation_failed', `unknown currency: ${currency}`);
  }
  let total = 0;
  for (const item of items) {
    if (item.currency !== currency) {
      return refuse(
        'validation_failed',
        `currency mismatch: expected ${currency}, got ${item.currency}`,
      );
    }
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) {
      return refuse('validation_failed', 'amountMinor must be a non-negative safe integer');
    }
    if (item.amountMinor > MAX_SAFE_MINOR - total) {
      return refuse('validation_failed', 'sum exceeds the safe integer ceiling');
    }
    total += item.amountMinor;
  }
  return { amountMinor: total, currency };
}

export function formatMoney(m: Money, locale = 'en'): string {
  const exponent = currencyExponent(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(m.amountMinor / 10 ** exponent);
}

/**
 * The single rounding function (D-003). v1 needs no rounding at all — a source scan in
 * `test/domain/money.test.ts` pins that nothing in `src/` outside this file calls it.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError('roundHalfUp: numerator must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(denominator) || denominator < 1) {
    throw new RangeError('roundHalfUp: denominator must be a positive safe integer');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
