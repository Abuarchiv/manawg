import type { Metadata } from 'next';

// Open Graph / Twitter defaults shared by pages that override the layout metadata.
// Next replaces the layout's openGraph/twitter objects wholesale per page, and the
// file-based opengraph-image only applies to its own segment, so we repeat them here.
export const OG_BASE = {
	type: 'website',
	locale: 'de_DE',
	siteName: 'ManaWG',
	images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'ManaWG' }],
} satisfies NonNullable<Metadata['openGraph']>;

export const TWITTER_BASE = {
	card: 'summary_large_image',
	images: ['/opengraph-image'],
} satisfies NonNullable<Metadata['twitter']>;
