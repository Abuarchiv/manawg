import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OG_BASE, TWITTER_BASE } from '@/shared/lib/og';
import { EinladungClient } from './EinladungClient';

export const dynamic = 'force-dynamic';

// Invite links are mostly shared in chats; the preview card names the invitation,
// never the WG or the token (the token is the secret of this URL).
export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.invite');
	const description = t('description');
	// openGraph/twitter titles do not go through the root title template.
	const title = `${t('title')} — ManaWG`;
	return {
		title: t('title'),
		description,
		robots: { index: false, follow: false },
		// Keep the token out of Referer headers.
		referrer: 'no-referrer',
		openGraph: { ...OG_BASE, title, description },
		twitter: { ...TWITTER_BASE, title, description },
	};
}

export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	return <EinladungClient token={token} />;
}
