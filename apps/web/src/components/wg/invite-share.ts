import { mutationErrorMessage } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { type NavigatorWithShare, copyText } from '@/core/utils/clipboard';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';

export interface CreatedInvite {
	id: string;
	url: string;
	expiresAt: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled';

const CREATE_ERRORS: Record<string, string> = {
	invite_limit_reached:
		'Es gibt schon 20 aktive Einladungen. Widerrufe eine, bevor du eine neue erstellst.',
	rate_limited: 'Zu viele Einladungen auf einmal. Versuch es gleich noch mal.',
};

/** Asks the server for a fresh 7-day invitation link of the WG. */
export async function createInvite(
	code: string,
	memberId: string,
): Promise<{ ok: true; invite: CreatedInvite } | { ok: false; message: string }> {
	const res = await apiFetch<CreatedInvite>(`/api/wg/${encodeURIComponent(code)}/invites`, {
		method: 'POST',
		memberId,
	});
	if (res.ok) return { ok: true, invite: res.data };
	return {
		ok: false,
		message:
			CREATE_ERRORS[res.error] ??
			mutationErrorMessage(
				'Die Einladung konnte nicht erstellt werden',
				res.error,
				{},
				'Die Einladung konnte nicht erstellt werden. Versuch es noch mal.',
			),
	};
}

export function inviteShareText(wgName: string, url: string): string {
	return `Komm in unsere WG „${wgName}“ auf ManaWG: ${url}\n(Der Link gilt ${INVITE_VALID_DAYS} Tage.)`;
}

/** Native share sheet when there is one, the clipboard otherwise. */
export async function shareInvite(wgName: string, url: string): Promise<ShareOutcome> {
	const text = inviteShareText(wgName, url);
	const shareData = { title: 'ManaWG', text, url };
	try {
		const nav = (typeof navigator !== 'undefined' ? navigator : null) as
			| (Navigator & NavigatorWithShare)
			| null;
		if (nav?.share && (!nav.canShare || nav.canShare(shareData))) {
			await nav.share(shareData);
			return 'shared';
		}
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
	}
	return (await copyText(text)) ? 'copied' : 'failed';
}
