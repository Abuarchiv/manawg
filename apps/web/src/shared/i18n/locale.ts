const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
/** For devices set to a language we do not offer: English is the usual second language. */
const FALLBACK_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'manawg_locale';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first Accept-Language entry by descending q whose primary subtag is a supported locale;
 * English when the device only names languages we do not offer.
 */
function fromAcceptLanguage(header: string | null | undefined): Locale | null {
	if (!header) return null;
	const entries = header.split(',').map((part, index) => {
		const [tag = '', ...params] = part.trim().split(';');
		const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='));
		const q = qParam ? Number(qParam.slice(2)) : 1;
		return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', q, index };
	});
	const ranked = entries
		.filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	const match = ranked.find((entry) => isLocale(entry.primary));
	if (match && isLocale(match.primary)) return match.primary;
	const namesLanguage = ranked.some((entry) => /^[a-z]{2,3}$/.test(entry.primary));
	const refusesFallback = entries.some((e) => e.primary === FALLBACK_LOCALE && e.q === 0);
	return namesLanguage && !refusesFallback ? FALLBACK_LOCALE : null;
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

/** Forgets the choice, so the device language decides again. */
export function clearLocaleCookie(): string {
	return `${LOCALE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** The locale the device asks for, the same way the server reads Accept-Language. */
export function deviceLocale(): Locale {
	const languages = globalThis.navigator?.languages?.length
		? globalThis.navigator.languages
		: [globalThis.navigator?.language ?? ''];
	return resolveLocale({ acceptLanguage: languages.join(',') });
}

/** Value of the `<html lang>` attribute; German stays the bare `de`. */
export function htmlLang(locale: Locale): string {
	return locale === 'en' ? 'en-GB' : 'de';
}
