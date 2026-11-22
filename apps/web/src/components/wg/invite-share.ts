import { mutationError } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { copyText, type NavigatorWithShare } from '@/core/utils/clipboard';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import { MS_PER_DAY } from '@/core/utils/time';
import type { Message } from '@/shared/i18n/message';
import { MAX_ACTIVE_INVITES } from '@/shared/lib/limits';

export interface CreatedInvite {
	id: string;
	url: string;
	expiresAt: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled';

const CREATE_ERRORS: Record<string, Message> = {
	invite_limit_reached: {
		key: 'shell.inviteShare.limitReached',
		values: { max: MAX_ACTIVE_INVITES },
	},
	rate_limited: { key: 'shell.inviteShare.rateLimited' },
};

function createError(code: string): Message {
	return (
		CREATE_ERRORS[code] ??
		mutationError(
			{ key: 'shell.inviteShare.createFailed' },
			code,
			{},
			{ key: 'shell.inviteShare.createFailedRetry' },
		)
	);
}

/** Asks the server for a fresh 14-day invitation link of the WG. */
export async function createInvite(
	code: string,
	memberId: string,
): Promise<{ ok: true; invite: CreatedInvite } | { ok: false; message: Message }> {
	const res = await apiFetch<CreatedInvite>(`/api/wg/${encodeURIComponent(code)}/invites`, {
		method: 'POST',
		memberId,
	});
	if (res.ok) return { ok: true, invite: res.data };
	return { ok: false, message: createError(res.error) };
}

/**
 * The invite card's link: the WG's newest invitation, or a fresh one once that is dead.
 * `invite: null` means the WG has a second active member.
 */
export async function currentInvite(
	code: string,
	memberId: string,
): Promise<{ ok: true; invite: CreatedInvite | null } | { ok: false; message: Message }> {
	const res = await apiFetch<{ invite: CreatedInvite | null }>(
		`/api/wg/${encodeURIComponent(code)}/invites/current`,
		{ method: 'POST', memberId },
	);
	if (res.ok) return { ok: true, invite: res.data.invite };
	return { ok: false, message: createError(res.error) };
}

/** The share text. It promises the days the link has left (a reused link may expire sooner). */
export function inviteShareMessage(
	wgName: string,
	url: string,
	expiresAt?: string,
	now = new Date(),
): Message {
	const days = expiresAt
		? Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / MS_PER_DAY))
		: INVITE_VALID_DAYS;
	return { key: 'shell.inviteShare.text', values: { wgName, url, days } };
}

/** Native share sheet when there is one, the clipboard otherwise. `text` is the rendered share message, which already carries the link. */
export async function shareInvite(text: string): Promise<ShareOutcome> {
	const shareData = { title: 'ManaWG', text };
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

/**
 * Copies `text` once it resolves, `null` meaning "do not share". The clipboard write starts at
 * once, inside the tap, so a browser that only lets the tap itself write still takes text that
 * arrives after a request. Without `ClipboardItem`, or when that write fails, it copies as usual.
 */
export async function copyWhenReady(text: Promise<string | null>): Promise<ShareOutcome> {
	const safe = text.catch(() => null);
	const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	if (typeof ClipboardItem !== 'undefined' && clipboard?.write) {
		const blob = safe.then((ready) => {
			if (ready === null) throw new Error('not shared');
			return new Blob([ready], { type: 'text/plain' });
		});
		try {
			await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
			return 'copied';
		} catch {
			// Not shared, or refused: the plain copy below decides.
		}
	}
	const ready = await safe;
	if (ready === null) return 'cancelled';
	return (await copyText(ready)) ? 'copied' : 'failed';
}
