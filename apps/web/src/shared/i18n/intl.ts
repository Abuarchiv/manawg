import type { Locale } from './locale';

const INTL_TAGS: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

export function intlTag(locale: Locale): string {
	return INTL_TAGS[locale];
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

export function numberFormat(
	locale: Locale,
	options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
	const key = `${locale}|${JSON.stringify(options ?? null)}`;
	let format = numberFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(intlTag(locale), options);
		numberFormats.set(key, format);
	}
	return format;
}

export function dateTimeFormat(
	locale: Locale,
	options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options ?? null)}`;
	let format = dateTimeFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(intlTag(locale), options);
		dateTimeFormats.set(key, format);
	}
	return format;
}
