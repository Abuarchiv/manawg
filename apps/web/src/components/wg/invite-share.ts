import { mutationError } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { copyText, type NavigatorWithShare } from '@/core/utils/clipboard';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import type { Message } from '@/shared/i18n/message';

export interface CreatedInvite {
	id: string;
	url: string;
	expiresAt: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled';

const CREATE_ERRORS: Record<string, Message> = {
	invite_limit_reached: { key: 'shell.inviteShare.limitReached' },
	rate_limited: { key: 'shell.inviteShare.rateLimited' },
};

/** Asks the server for a fresh 7-day invitation link of the WG. */
export async function createInvite(
	code: string,
	memberId: string,
): Promise<{ ok: true; invite: CreatedInvite } | { ok: false; message: Message }> {
	const res = await apiFetch<CreatedInvite>(`/api/wg/${encodeURIComponent(code)}/invites`, {
		method: 'POST',
		memberId,
	});
	if (res.ok) return { ok: true, invite: res.data };
	return {
		ok: false,
		message:
			CREATE_ERRORS[res.error] ??
			mutationError(
				{ key: 'shell.inviteShare.createFailed' },
				res.error,
				{},
				{ key: 'shell.inviteShare.createFailedRetry' },
			),
	};
}

export function inviteShareMessage(wgName: string, url: string): Message {
	return { key: 'shell.inviteShare.text', values: { wgName, url, days: INVITE_VALID_DAYS } };
}

/** Native share sheet when there is one, the clipboard otherwise. `text` is the rendered share message. */
export async function shareInvite(text: string, url: string): Promise<ShareOutcome> {
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
