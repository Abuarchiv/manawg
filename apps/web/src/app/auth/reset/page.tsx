import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { safeNextPath } from '@/core/auth/next-path';
import { PASSWORD_RECOVERY_COOKIE } from '@/core/auth/password-pending';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.authReset');
	return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function PasswordResetPage({
	searchParams,
}: {
	searchParams: Promise<{ choose?: string; next?: string }>;
}) {
	const [cookieStore, user, t, { choose, next }] = await Promise.all([
		cookies(),
		getAuthenticatedUserFromCookies(),
		getTranslations('entry'),
		searchParams,
	]);
	const recoveryRequested = Boolean(
		user && cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value === user.id,
	);

	const chosen = choose === '1' ? safeNextPath(next ?? null) : '/';
	const continuePath = chosen === '/' ? '/login' : chosen;

	const choosing = recoveryRequested && choose === '1';

	return (
		<EntryFrame
			title={choosing ? t('reset.choose') : t('reset.title')}
			description={
				choosing
					? t('reset.chooseHint')
					: recoveryRequested
						? t('reset.recovery')
						: t('reset.request')
			}
			headingId="password-reset-heading"
			backHref="/login"
			backLabel={t('frame.backToSignIn')}
		>
			<PasswordResetForm recoveryRequested={recoveryRequested} continueTo={continuePath} />
		</EntryFrame>
	);
}
