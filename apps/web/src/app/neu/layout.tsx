import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: 'WG erstellen oder beitreten — ManaWG',
	description: 'WG erstellen oder mit dem 8-stelligen Code beitreten.',
};

export default function NeuLayout({ children }: { children: ReactNode }) {
	return children;
}
