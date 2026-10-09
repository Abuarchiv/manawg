import { ErrorBox } from '@/components/app/ErrorBox';
import { getInitialJoinCode } from '@/core/infra/join-flow';

// Most failed callbacks are an expired or reused link, or a link opened in a
// different browser than the one that requested it (no PKCE verifier there).
const AUTH_CALLBACK_ERROR =
	'Der Link konnte nicht verwendet werden. Er ist abgelaufen oder bereits benutzt, oder du hast ihn in einem anderen Browser geöffnet. Hast du gerade deine E-Mail-Adresse bestätigt, kannst du dich jetzt anmelden. Sonst fordere einen neuen Link an.';

/** Messages from a failed auth callback or a malformed invitation `?code=`, shown above the flow. */
export function StartNotices({ search }: { search: string }) {
	const params = new URLSearchParams(search);
	const rawCode = (params.get('code') ?? '').trim();
	const badInvite = rawCode !== '' && getInitialJoinCode(search) === '';
	return (
		<>
			{params.get('error') === 'auth_callback' && <ErrorBox>{AUTH_CALLBACK_ERROR}</ErrorBox>}
			{badInvite && (
				<ErrorBox>
					Dieser Einladungslink ist unvollständig oder ungültig. Frag die WG nach einem neuen Link.
				</ErrorBox>
			)}
		</>
	);
}
