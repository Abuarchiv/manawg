import type { Metadata } from 'next';
import { EntryClient } from './EntryClient';

export const metadata: Metadata = {
	title: 'ManaWG',
	// The entry route only forwards into the app; there is nothing here to
	// index, and manawg.com already carries the public marketing page.
	robots: { index: false, follow: false },
};

// craftsman-ignore: TS002 — Next.js App Router requires default export for pages
export default function Entry() {
	return <EntryClient />;
}
