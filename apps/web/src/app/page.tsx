import { OG_BASE, TWITTER_BASE } from '@/shared/lib/og';
import type { Metadata } from 'next';
import { EntryClient } from './EntryClient';

const title = 'ManaWG, die WG-App: Ausgaben, Einkauf, Putzplan für eure WG';
const description =
	'Mit ManaWG teilt ihr Ausgaben, organisiert Einkäufe und verteilt Aufgaben im Putzplan. Die App ist kostenlos und läuft im Browser.';

// Entry page stays noindex (inherited from the layout) and carries no canonical:
// a cross-domain canonical on a noindex page is a contradictory signal to Google.
// The brand ranks through manawg.com, which this page links to in its footer.
export const metadata: Metadata = {
	title,
	description,
	openGraph: { ...OG_BASE, title, description, url: '/' },
	twitter: { ...TWITTER_BASE, title, description },
};

export default function Entry() {
	return <EntryClient />;
}
