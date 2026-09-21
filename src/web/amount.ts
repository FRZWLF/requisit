import { refuse, type Result } from '../refusal.ts';
import { currencyExponent, isKnownCurrency, MAX_SAFE_MINOR } from '../domain/money.ts';

/**
 * The inverse of `formatMoney` for one form field (D-003). A person types `12.34`, the
 * service stores 1234 minor units — exactly, or not at all: a third decimal in a EUR field
 * and any decimal at all in a JPY field are refused rather than rounded. No rounding happens
 * here — D-003's single rounding function in `src/domain/money.ts` stays uncalled, as the
 * source scan in `test/domain/money.test.ts` requires.
 */
export function parseAmountMinor(text: string, currency: string): Result<number> {
  if (!isKnownCurrency(currency)) {
    return refuse('validation_failed', `unknown currency: ${currency}`);
  }
  const exponent = currencyExponent(currency);
  const trimmed = text.trim().replace(/\s/g, '');
  const match = /^([0-9]{1,15})(?:[.,]([0-9]{1,6}))?$/.exec(trimmed);
  if (match === null) {
    return refuse('validation_failed', `"${text}" is not an amount`);
  }
  const whole = match[1] as string;
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) {
    return refuse(
      'validation_failed',
      exponent === 0
        ? `${currency} has no decimal places`
        : `${currency} has ${String(exponent)} decimal places`,
    );
  }
  const padded = fraction.padEnd(exponent, '0');
  const minor = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(minor) || minor > MAX_SAFE_MINOR) {
    return refuse('validation_failed', 'that amount is too large');
  }
  return minor;
}

/** The major-unit string a form field is pre-filled with — the inverse of the parse above. */
export function amountField(amountMinor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === 0) {
    return String(amountMinor);
  }
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
