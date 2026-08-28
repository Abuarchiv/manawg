import { describe, expect, it } from 'vitest';
import { CENTS_PER_EURO, formatEuroCents } from './money';

/**
 * Intl separates amount and currency symbol with U+00A0, not a plain space.
 * Spelled out here because the two are indistinguishable in a diff, and a test
 * written with a plain space fails with the baffling message
 * `expected '12,34 €' to be '12,34 €'`.
 *
 * Asserting on the exact character rather than normalizing whitespace is
 * deliberate: the non-breaking space is what keeps "12,34" and "€" on one line
 * in the expense list, so a regression to a plain space is a real defect.
 */
const NBSP = ' ';
const eur = (amount: string) => `${amount}${NBSP}€`;

describe('formatEuroCents', () => {
	it('renders whole and fractional euro amounts in de-DE notation', () => {
		expect(formatEuroCents(0)).toBe(eur('0,00'));
		expect(formatEuroCents(50)).toBe(eur('0,50'));
		expect(formatEuroCents(1234)).toBe(eur('12,34'));
		expect(formatEuroCents(100 * CENTS_PER_EURO)).toBe(eur('100,00'));
	});

	it('groups thousands with a dot', () => {
		expect(formatEuroCents(123_456)).toBe(eur('1.234,56'));
	});

	it('renders negative amounts with a leading minus', () => {
		expect(formatEuroCents(-1)).toBe(eur('-0,01'));
		expect(formatEuroCents(-1234)).toBe(eur('-12,34'));
	});

	/**
	 * Splitting 10 cents across 3 people leaves sub-cent remainders, and the
	 * rounding direction decides whether one of them comes out slightly
	 * negative. Rendered naively that reads as "-0,00 €", which looks like a
	 * bug to the user and is what the normalization exists to prevent.
	 */
	it('renders sub-cent negatives as zero rather than a signed zero', () => {
		expect(formatEuroCents(-0.4)).toBe(eur('0,00'));
		expect(formatEuroCents(-0.001)).toBe(eur('0,00'));
		expect(formatEuroCents(-0)).toBe(eur('0,00'));
	});

	it('rounds sub-cent positives to zero without a sign', () => {
		expect(formatEuroCents(0.4)).toBe(eur('0,00'));
	});

	/**
	 * A NaN reaching the formatter means an upstream calculation broke. Showing
	 * "NaN €" in a shared expense list is worse than showing zero, so the
	 * function absorbs it — the amount is still wrong, but the page renders.
	 */
	it('falls back to zero for non-finite input', () => {
		expect(formatEuroCents(Number.NaN)).toBe(eur('0,00'));
		expect(formatEuroCents(Number.POSITIVE_INFINITY)).toBe(eur('0,00'));
		expect(formatEuroCents(Number.NEGATIVE_INFINITY)).toBe(eur('0,00'));
	});

	it('prefixes positive amounts with + only when signed is requested', () => {
		expect(formatEuroCents(1234, 'EUR', { signed: true })).toBe(`+${eur('12,34')}`);
		expect(formatEuroCents(1234)).toBe(eur('12,34'));
	});

	it('never prefixes zero or negative amounts with +', () => {
		expect(formatEuroCents(0, 'EUR', { signed: true })).toBe(eur('0,00'));
		expect(formatEuroCents(-1234, 'EUR', { signed: true })).toBe(eur('-12,34'));
		// A sub-cent negative normalizes to zero, so it must not gain a + either.
		expect(formatEuroCents(-0.4, 'EUR', { signed: true })).toBe(eur('0,00'));
	});

	it('honors a non-default currency', () => {
		expect(formatEuroCents(1234, 'CHF')).toBe(`12,34${NBSP}CHF`);
	});
});
