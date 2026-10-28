import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/Toast';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.join');
	return {
		title: t('title'),
		description: t('description'),
		robots: { index: false, follow: false },
	};
}

export default function LoginLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ToastContainer />
		</>
	);
}
