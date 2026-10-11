'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { getInitialJoinCode } from '@/core/infra/join-flow';
import { isAppInstalled, isIosLikeDevice } from '@/shared/lib/pwa-install';
import { useEffect, useState } from 'react';

// Most failed callbacks are an expired or reused link, or a link opened in a
// different browser than the one that requested it (no PKCE verifier there).
const AUTH_CALLBACK_ERROR =
	'Der Link konnte nicht verwendet werden. Er ist abgelaufen oder bereits benutzt, oder du hast ihn in einem anderen Browser geöffnet. Hast du gerade deine E-Mail-Adresse bestätigt, kannst du dich jetzt anmelden. Sonst fordere einen neuen Link an.';

// iOS keeps the storage of a Home Screen web app apart from Safari, so a session signed in
// there never reaches the installed app. Android and desktop share the browser profile.
const IOS_STANDALONE_NOTICE =
	'Auf dem iPhone ist die installierte App von Safari getrennt. Melde dich hier einmal an, danach bleibst du angemeldet.';

/** Messages from a failed auth callback or a malformed invitation `?code=`, shown above the flow. */
export function StartNotices({ search, signedIn }: { search: string; signedIn: boolean }) {
	const params = new URLSearchParams(search);
	const rawCode = (params.get('code') ?? '').trim();
	const badInvite = rawCode !== '' && getInitialJoinCode(search) === '';
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
			{badInvite && (
				<ErrorBox>
					Dieser Einladungslink ist unvollständig oder ungültig. Frag die WG nach einem neuen Link.
				</ErrorBox>
			)}
		</>
	);
}
