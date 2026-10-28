'use client';

import { useEffect, useState } from 'react';
import { ErrorBox } from '@/components/app/ErrorBox';
import { LEGACY_CODE_MESSAGE } from '@/core/infra/join-flow';
import { isInviteToken } from '@/core/utils/invite-token';
import { isAppInstalled, isIosLikeDevice } from '@/shared/lib/pwa-install';

// Most failed callbacks are an expired or reused link, or a link opened in a
// different browser than the one that requested it (no PKCE verifier there).
const AUTH_CALLBACK_ERROR =
	'Der Link konnte nicht verwendet werden. Er ist abgelaufen oder bereits benutzt, oder du hast ihn in einem anderen Browser geöffnet. Hast du gerade deine E-Mail-Adresse bestätigt, kannst du dich jetzt anmelden. Sonst fordere einen neuen Link an.';

// iOS keeps the storage of a Home Screen web app apart from Safari, so a session signed in
// there never reaches the installed app. Android and desktop share the browser profile.
const IOS_STANDALONE_NOTICE =
	'Auf dem iPhone ist die installierte App von Safari getrennt. Melde dich hier einmal an, danach bleibst du angemeldet.';

/** Messages from a failed auth callback, an old `?code=` link or a malformed `?invite=`, shown above the flow. */
export function StartNotices({ search, signedIn }: { search: string; signedIn: boolean }) {
	const params = new URLSearchParams(search);
	const legacyCode = (params.get('code') ?? '').trim() !== '';
	const rawInvite = (params.get('invite') ?? '').trim();
	const badInvite = rawInvite !== '' && !isInviteToken(rawInvite);
	const [iosStandalone, setIosStandalone] = useState(false);
	useEffect(() => {
		setIosStandalone(isAppInstalled() && isIosLikeDevice(window.navigator));
	}, []);
	return (
		<>
			{!signedIn && iosStandalone && (
				<p className="text-sm text-muted-foreground">{IOS_STANDALONE_NOTICE}</p>
			)}
			{params.get('error') === 'auth_callback' && <ErrorBox>{AUTH_CALLBACK_ERROR}</ErrorBox>}
			{legacyCode && <ErrorBox>{LEGACY_CODE_MESSAGE}</ErrorBox>}
			{badInvite && (
				<ErrorBox>
					Dieser Einladungslink ist unvollständig oder ungültig. Frag die WG nach einem neuen Link.
				</ErrorBox>
			)}
		</>
	);
}
