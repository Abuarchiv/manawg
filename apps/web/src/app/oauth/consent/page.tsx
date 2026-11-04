import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConsentClient } from './ConsentClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.agentConsent');
	return {
		title: t('title'),
		description: t('description'),
		robots: { index: false, follow: false },
		// The authorization id in the URL is part of an OAuth flow; keep it out of Referer headers.
		referrer: 'no-referrer',
	};
}

/** Where Supabase Auth sends the browser when an AI agent asks to connect (OAuth consent). */
export default async function AgentConsentPage({
	searchParams,
}: {
	searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
	const { authorization_id: raw } = await searchParams;
	const authorizationId = typeof raw === 'string' ? raw : '';
	return <ConsentClient authorizationId={authorizationId} />;
}
