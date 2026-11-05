import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/Toast';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';

/** Signed out, the page is the sign-in form; signed in, it creates or joins a flat. */
export async function generateMetadata(): Promise<Metadata> {
	const [t, user] = await Promise.all([
		getTranslations('meta'),
		// An unreachable auth server leaves the sign-in title instead of failing the page.
		getAuthenticatedUserFromCookies().catch(() => null),
	]);
	return {
		title: user ? t('join.title') : t('signIn.title'),
		description: t('join.description'),
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
