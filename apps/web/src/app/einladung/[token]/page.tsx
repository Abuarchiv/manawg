import type { Metadata } from 'next';
import { EinladungClient } from './EinladungClient';

export const dynamic = 'force-dynamic';

const title = 'Du bist in eine WG eingeladen — ManaWG';
const description =
	'Tritt deiner WG auf ManaWG bei: Ausgaben, Putzplan, Einkauf und Pinnwand. Kostenlos, im Browser, in Deutschland gehostet.';

// Invite links are mostly shared in chats; the preview card names the invitation,
// never the WG or the token (the token is the secret of this URL).
export const metadata: Metadata = {
	title,
	description,
	robots: { index: false, follow: false },
	// Keep the token out of Referer headers.
	referrer: 'no-referrer',
	openGraph: { title, description },
	twitter: { title, description },
};

export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	return <EinladungClient token={token} />;
}
