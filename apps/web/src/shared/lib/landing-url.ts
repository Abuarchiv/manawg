/**
 * Origin of the marketing site (manawg.com). It owns the brand in search:
 * the landing is indexable, this app is noindex. Every link, canonical and
 * JSON-LD reference to the landing is built from this one constant so the
 * two origins cannot drift apart.
 */
export const LANDING_ORIGIN = 'https://manawg.com';

/** Absolute URL on the landing origin, e.g. `landingUrl('/putzplan')`. */
export function landingUrl(path = '/'): string {
	return `${LANDING_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** JSON-LD `@id`s defined by the landing (src/lib/schema-ids.ts there); referenced, never redefined here. */
export const LANDING_SCHEMA_IDS = {
	organisation: `${LANDING_ORIGIN}/#organisation`,
	webseite: `${LANDING_ORIGIN}/#webseite`,
} as const;
