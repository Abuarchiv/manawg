import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/shared/i18n/locale';

// Open Graph / Twitter defaults shared by pages that override the layout metadata.
// Next replaces the layout's openGraph/twitter objects wholesale per page, and the
// file-based opengraph-image only applies to its own segment, so we repeat them here.
const OG_LOCALES: Record<Locale, string> = { de: 'de_DE', en: 'en_GB', es: 'es_ES' };

/** `og:locale` follows the request locale, like the localized title and description. */
export function ogBase(locale: string) {
	return {
		type: 'website',
		locale: OG_LOCALES[isLocale(locale) ? locale : DEFAULT_LOCALE],
		siteName: 'ManaWG',
		images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'ManaWG' }],
	} satisfies NonNullable<Metadata['openGraph']>;
}

export const TWITTER_BASE = {
	card: 'summary_large_image',
	images: ['/opengraph-image'],
} satisfies NonNullable<Metadata['twitter']>;
