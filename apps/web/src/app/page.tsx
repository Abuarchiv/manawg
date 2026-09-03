import type { Metadata } from 'next';
import { EntryClient } from './EntryClient';

export const metadata: Metadata = {
	title: 'ManaWG',
	description: 'Ausgaben, Einkauf, Putzen und Pinnwand für deine WG.',
};

// craftsman-ignore: TS002 — Next.js App Router requires default export for pages
export default function Entry() {
	return <EntryClient />;
}
