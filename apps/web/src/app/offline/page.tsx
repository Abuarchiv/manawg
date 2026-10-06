import { fixtureClientProps } from '@/fixtures/client-mode';
import { OfflineClient } from './OfflineClient';

export const metadata = { title: 'Offline — ManaWG', robots: { index: false, follow: false } };

export default function Offline() {
	return <OfflineClient {...fixtureClientProps()} />;
}
