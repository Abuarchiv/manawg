import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta');
	return { title: t('pages.statement') };
}

export default function Layout({ children }: { children: ReactNode }) {
	return children;
}
