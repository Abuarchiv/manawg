import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.authReset');
	return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function PasswordResetPage({
	searchParams,
}: {
	searchParams: Promise<{ choose?: string }>;
}) {
	const [cookieStore, user, t, { choose }] = await Promise.all([
		cookies(),
		getAuthenticatedUserFromCookies(),
		getTranslations('entry'),
		searchParams,
	]);
	const recoveryRequested = Boolean(
		user && cookieStore.get('manawg_password_recovery')?.value === user.id,
	);

	return (
		<EntryFrame
			title={recoveryRequested && choose === '1' ? t('reset.choose') : t('reset.title')}
			description={recoveryRequested ? t('reset.recovery') : t('reset.request')}
			headingId="password-reset-heading"
			backHref="/login"
			backLabel={t('frame.backToSignIn')}
		>
			<PasswordResetForm recoveryRequested={recoveryRequested} />
		</EntryFrame>
	);
}
