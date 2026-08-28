import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: 'WG erstellen oder beitreten — ManaWG',
	description:
		'Neue WG in 30 Sekunden erstellen oder mit 8-stelligem Code beitreten. Kostenlos, kein Account, kein Tracking.',
};

// craftsman-ignore: TS002 — Next.js App Router requires default export from layout.tsx
export default function NeuLayout({ children }: { children: ReactNode }) {
	return children;
}
