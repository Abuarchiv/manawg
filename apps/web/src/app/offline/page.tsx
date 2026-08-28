import { OfflineClient } from './OfflineClient';

export const metadata = { title: 'Offline — ManaWG', robots: { index: false, follow: false } };

// craftsman-ignore: TS002 — Next.js App Router requires default export for page components
export default function Offline() {
	return <OfflineClient />;
}
