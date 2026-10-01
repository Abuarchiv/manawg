import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: 'WG erstellen oder beitreten — ManaWG',
	description:
		'Neue WG in 30 Sekunden erstellen oder mit 8-stelligem Code beitreten. Kostenlos und datensparsam.',
};

export default function NeuLayout({ children }: { children: ReactNode }) {
	return children;
}
