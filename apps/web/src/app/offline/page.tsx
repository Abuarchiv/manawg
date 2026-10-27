import { OfflineClient } from './OfflineClient';

export const metadata = { title: 'Offline', robots: { index: false, follow: false } };

export default function Offline() {
	return <OfflineClient />;
}
