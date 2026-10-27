export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_COOKIE = 'manawg_locale';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The first Accept-Language entry by descending q whose primary subtag is a supported locale. */
function fromAcceptLanguage(header: string | null | undefined): Locale | null {
	if (!header) return null;
	const ranked = header
		.split(',')
		.map((part, index) => {
			const [tag = '', ...params] = part.trim().split(';');
			const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='));
			const q = qParam ? Number(qParam.slice(2)) : 1;
			return { primary: tag.trim().toLowerCase().split('-')[0], q, index };
		})
		.filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	const match = ranked.find((entry) => isLocale(entry.primary));
	return match && isLocale(match.primary) ? match.primary : null;
}

export function resolveLocale(input: {
	cookie?: string | null | undefined;
	acceptLanguage?: string | null | undefined;
}): Locale {
	if (isLocale(input.cookie)) return input.cookie;
	return fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** The `document.cookie` assignment that stores the choice; `Secure` unless served over plain http. */
export function localeCookie(locale: Locale): string {
	const insecure = globalThis.location?.protocol === 'http:';
	return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax${insecure ? '' : '; Secure'}`;
}

/** Value of the `<html lang>` attribute; German stays the bare `de`. */
export function htmlLang(locale: Locale): string {
	return locale === 'en' ? 'en-GB' : 'de';
}
