import { CENTS_PER_EURO } from '@/core/utils/money';
import { numberFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

/**
 * English input accepts both separators because iOS decimal keyboards show the device's.
 * A trailing "," or "." with at most two digits is the decimal mark; other separators group
 * thousands. A three-digit tail ("1,234" or "1.234") is grouping, valid only with ",".
 */
function parseEnglishAmount(value: string): number | null {
	const text = value
		.replace(/€|EUR/gi, '')
		.trim()
		.replace(
			/^([1-9]\d{0,2})((?:\s\d{3})+)(?=[.,]|$)/,
			(_, head: string, rest: string) => head + rest.replace(/\s/g, ''),
		);
	const decimal = /^(.*?)([.,])(\d{0,2})$/.exec(text);
	const whole = decimal ? (decimal[1] ?? '') : text;
	const fraction = decimal?.[3] ?? '';
	if (!whole && !fraction) return null;
	const grouping = decimal?.[2] === ',' ? '.' : ',';
	const grouped = new RegExp(`^[1-9]\\d{0,2}(?:[${grouping}]\\d{3})+$`).test(whole);
	if (!grouped && !/^\d*$/.test(whole)) return null;
	const amount = Number(`${whole.split(grouping).join('') || '0'}.${fraction || '0'}`);
	return Number.isFinite(amount) ? amount : null;
}

export function parseEuroAmount(value: string, locale: Locale = 'de'): number | null {
	if (locale === 'en') return parseEnglishAmount(value);
	// Pasted amounts carry "€" / "EUR" and space-grouped thousands: "12,50 €", "1 234,50".
	const trimmed = value
		.replace(/€|EUR/gi, '')
		.trim()
		.replace(
			/^([1-9]\d{0,2})((?:[\s  ]\d{3})+)(?=,|$)/,
			(_, head: string, rest: string) => head + rest.replace(/\s/g, '').replace(/[  ]/g, ''),
		);
	// German thousands dots ("1.234,56", "1.200") — only in the strict 3-digit-group form.
	const normalized = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{0,2})?$/.test(trimmed)
		? trimmed.replace(/\./g, '').replace(',', '.')
		: trimmed.replace(',', '.');
	if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
	const amount = Number(normalized);
	return Number.isFinite(amount) ? amount : null;
}

export function formatEuroInput(value: number, locale: Locale = 'de'): string {
	return locale === 'en' ? value.toFixed(2) : value.toFixed(2).replace('.', ',');
}

/** Euro amount to whole cents; rounds, so 0.1 + 0.2 euros is 30 cents. */
export function eurosToCents(euros: number): number {
	return Math.round(euros * CENTS_PER_EURO);
}

/** Cent amount as the euro text of an amount input ("12,50" in German, "12.50" in English). */
export function formatCentsInput(cents: number, locale: Locale = 'de'): string {
	return formatEuroInput(cents / CENTS_PER_EURO, locale);
}

/** Decimal text with at most two places: 1.5 is "1,5" in German and "1.5" in English, 2 is "2". */
export function formatDecimal(value: number, locale: Locale = 'de'): string {
	return numberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
