import type { Metadata } from 'next';
import { EntryClient } from './EntryClient';

export const metadata: Metadata = {
	title: 'ManaWG',
	description: 'Ausgaben, Einkauf, Putzen und Pinnwand für deine WG.',
	// Marke auf manawg.com bündeln: Startseite der App ist noindex, Canonical zeigt auf die Landing.
	alternates: { canonical: 'https://manawg.com/' },
};

export default function Entry() {
	return <EntryClient />;
}
