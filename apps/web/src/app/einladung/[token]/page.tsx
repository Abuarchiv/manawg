import { OG_BASE, TWITTER_BASE } from '@/shared/lib/og';
import type { Metadata } from 'next';
import { EinladungClient } from './EinladungClient';

export const dynamic = 'force-dynamic';

const pageTitle = 'Du bist in eine WG eingeladen';
// openGraph/twitter titles do not go through the root title template.
const title = `${pageTitle} — ManaWG`;
const description =
	'Tritt deiner WG auf ManaWG bei: Ausgaben, Putzplan, Einkauf und Pinnwand. Kostenlos, im Browser, in Deutschland gehostet.';

// Invite links are mostly shared in chats; the preview card names the invitation,
// never the WG or the token (the token is the secret of this URL).
export const metadata: Metadata = {
	title: pageTitle,
	description,
	robots: { index: false, follow: false },
	// Keep the token out of Referer headers.
	referrer: 'no-referrer',
	openGraph: { ...OG_BASE, title, description },
	twitter: { ...TWITTER_BASE, title, description },
};

export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	return <EinladungClient token={token} />;
}
