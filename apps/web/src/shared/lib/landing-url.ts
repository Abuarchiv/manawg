import { DEFAULT_LOCALE, type Locale } from '@/shared/i18n/locale';

/**
 * Origin of the marketing site (manawg.com). It owns the brand in search:
 * the landing is indexable, this app is noindex. Every link, canonical and
 * JSON-LD reference to the landing is built from this one constant so the
 * two origins cannot drift apart.
 */
const LANDING_ORIGIN = 'https://manawg.com';

// Fixed on purpose: the landing references exactly this @id (schema-ids.ts there),
// so it must not follow NEXT_PUBLIC_APP_URL or a preview host.
export const APP_SCHEMA_ID = 'https://app.manawg.com/#app';

function originOf(value: string | undefined): string | null {
	try {
		return value?.trim() ? new URL(value.trim()).origin : null;
	} catch {
		return null;
	}
}

/** True when `appUrl` has the origin of the official app (APP_SCHEMA_ID). */
export function isOfficialInstance(appUrl: string | undefined): boolean {
	return originOf(appUrl) !== null && originOf(appUrl) === originOf(APP_SCHEMA_ID);
}

/**
 * Only the instance served from the app origin of the schema id presents itself to search engines
 * as the landing's app and uses the landing's legal pages, support address and mail sender. Read
 * straight from the NEXT_PUBLIC variable so the value is inlined into client code.
 */
export const IS_OFFICIAL_INSTANCE = isOfficialInstance(process.env.NEXT_PUBLIC_APP_URL);

/**
 * Origin with the operator's legal pages: `NEXT_PUBLIC_LEGAL_URL` of a self-hosted instance, the
 * landing for the official one. Without either there is nothing to link.
 */
const LEGAL_ORIGIN =
	process.env.NEXT_PUBLIC_LEGAL_URL?.trim().replace(/\/$/, '') ||
	(IS_OFFICIAL_INSTANCE ? LANDING_ORIGIN : null);

type LegalPath = '/impressum' | '/datenschutz' | '/agb';

// The official landing publishes English translations of its legal pages under /en.
const LANDING_LEGAL_EN: Record<LegalPath, string> = {
	'/impressum': '/en/legal-notice',
	'/datenschutz': '/en/privacy',
	'/agb': '/en/terms',
};

/** Imprint, privacy policy or terms of whoever operates the instance; null if none is configured. */
export function legalUrl(path: LegalPath, locale: Locale = DEFAULT_LOCALE): string | null {
	if (!LEGAL_ORIGIN) return null;
	const english = locale === 'en' && LEGAL_ORIGIN === LANDING_ORIGIN;
	return `${LEGAL_ORIGIN}${english ? LANDING_LEGAL_EN[path] : path}`;
}

/** Absolute URL on the landing origin, e.g. `landingUrl('/putzplan')`. */
export function landingUrl(path = '/'): string {
	return `${LANDING_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** JSON-LD `@id`s defined by the landing (src/lib/schema-ids.ts there); referenced, never redefined here. */
export const LANDING_SCHEMA_IDS = {
	organisation: `${LANDING_ORIGIN}/#organisation`,
	webseite: `${LANDING_ORIGIN}/#webseite`,
} as const;
