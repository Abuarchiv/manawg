import type { Metadata } from 'next';
import { EinladungClient } from './EinladungClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Einladung — ManaWG',
	description: 'Tritt einer WG auf ManaWG mit deiner Einladung bei.',
	robots: { index: false, follow: false },
	// The token is the secret of this URL; keep it out of Referer headers.
	referrer: 'no-referrer',
};

export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	return <EinladungClient token={token} />;
}
