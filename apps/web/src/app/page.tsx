import { OG_BASE, TWITTER_BASE } from '@/shared/lib/og';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EntryClient } from './EntryClient';

// Entry page stays noindex (inherited from the layout) and carries no canonical:
// a cross-domain canonical on a noindex page is a contradictory signal to Google.
// The brand ranks through manawg.com, which this page links to in its footer.
export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.brand');
	const title = t('title');
	const description = t('description');
	return {
		title,
		description,
		openGraph: { ...OG_BASE, title, description, url: '/' },
		twitter: { ...TWITTER_BASE, title, description },
	};
}

export default function Entry() {
	return <EntryClient />;
}
