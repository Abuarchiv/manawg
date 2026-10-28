'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { isInviteToken } from '@/core/utils/invite-token';
import { isAppInstalled, isIosLikeDevice } from '@/shared/lib/pwa-install';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Messages from a failed auth callback (an expired or reused link, or a link opened in another
 * browser than the one that requested it) or a malformed `?invite=`.
 * On iOS the installed app keeps its storage apart from Safari, so the sign-in notice is
 * shown there only.
 */
export function StartNotices({ search, signedIn }: { search: string; signedIn: boolean }) {
	const t = useTranslations('entry');
	const params = new URLSearchParams(search);
	const rawInvite = (params.get('invite') ?? '').trim();
	const badInvite = rawInvite !== '' && !isInviteToken(rawInvite);
	const [iosStandalone, setIosStandalone] = useState(false);
	useEffect(() => {
		setIosStandalone(isAppInstalled() && isIosLikeDevice(window.navigator));
	}, []);
	return (
		<>
			{!signedIn && iosStandalone && (
				<p className="text-sm text-muted-foreground">{t('start.iosStandalone')}</p>
			)}
			{params.get('error') === 'auth_callback' && <ErrorBox>{t('start.authCallback')}</ErrorBox>}
			{badInvite && <ErrorBox>{t('errors.badInvite')}</ErrorBox>}
		</>
	);
}
