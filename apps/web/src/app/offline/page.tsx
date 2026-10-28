import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OfflineClient } from './OfflineClient';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.offline');
	return { title: t('title'), robots: { index: false, follow: false } };
}

export default function Offline() {
	return <OfflineClient />;
}
