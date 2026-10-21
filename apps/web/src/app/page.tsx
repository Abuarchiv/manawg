import type { Metadata } from 'next';
import { EntryClient } from './EntryClient';

export const metadata: Metadata = {
	title: 'ManaWG',
	description: 'Ausgaben, Einkauf, Putzen und Pinnwand für deine WG.',
	// Entry page is noindex; canonical points at the landing so the brand consolidates on manawg.com.
	alternates: { canonical: 'https://manawg.com/' },
};

export default function Entry() {
	return <EntryClient />;
}
