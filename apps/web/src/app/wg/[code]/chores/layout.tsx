import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.pages');
	return { title: t('chores') };
}

export default function Layout({ children }: { children: ReactNode }) {
	return children;
}
