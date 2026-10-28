import { belongsToAccount, getKnownWgs, type KnownWg } from '@/core/auth/local-account';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { parseAccountWgs } from '@/core/infra/account-wgs';
import { getOfflineActionSummary, type OfflineAction } from '@/core/offline/offline-queue';
import { parseTimestamp } from '@/core/utils/time';
import type { Message, MessageKey } from '@/shared/i18n/message';

export function moduleLabel(action: OfflineAction): Message {
	return getOfflineActionSummary(action).title;
}

export function offlineAgeMessage(iso: string, now = Date.now()): Message {
	const timestamp = parseTimestamp(iso);
	if (timestamp === null) return { key: 'offline.page.age.unclear' };
	const ageMs = now - timestamp;
	if (ageMs < 0) return { key: 'offline.page.age.future' };
	if (ageMs < 60_000) return { key: 'offline.page.age.justNow' };
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return { key: 'offline.page.age.minutes', values: { count: minutes } };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { key: 'offline.page.age.hours', values: { count: hours } };
	return { key: 'offline.page.age.days', values: { count: Math.floor(hours / 24) } };
}

export function countByShareCode(items: OfflineAction[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.shareCode, (counts.get(item.shareCode) ?? 0) + 1);
	return counts;
}

export function queuedActionCountMessage(count: number): Message {
	return { key: 'offline.page.queued', values: { count } };
}

export function wgQueuedActionCountMessage(count: number): Message {
	return { key: 'offline.page.wgQueued', values: { count } };
}

export function wgHref(code: string, suffix = ''): string {
	return `/wg/${encodeURIComponent(code)}${suffix}`;
}

export type AccountMembership = { code: string; memberId: string };
export type OfflineStatus =
	| 'checking'
	| 'browser-offline'
	| 'server-unreachable'
	| 'unauthenticated'
	| 'ready';

export async function getAccountMemberships(
	signal?: AbortSignal,
): Promise<AccountMembership[] | null> {
	// Signed-out visitors: no probe, no 401 in the console (same as /login).
	if (!hasSessionCookie()) return null;
	const res = await fetch('/api/wg/mine', {
		cache: 'no-store',
		...(signal ? { signal } : {}),
	});
	if (res.status === 401) return null;
	if (!res.ok) throw new Error('account_wgs_failed');
	const wgs = parseAccountWgs(await res.json());
	if (!wgs) throw new Error('account_wgs_invalid');
	return wgs.flatMap(({ code, memberId }) => (memberId ? [{ code, memberId }] : []));
}

/** The remembered WGs of the signed-in account. */
export function visibleKnownWgs(authUserId: string | null): KnownWg[] {
	return getKnownWgs().filter((wg) => belongsToAccount(wg.authUserId, authUserId));
}

const STATUS_LABEL = {
	checking: 'offline.page.label.checking',
	'browser-offline': 'offline.page.label.browserOffline',
	'server-unreachable': 'offline.page.label.serverUnreachable',
	unauthenticated: 'offline.page.label.unauthenticated',
	ready: 'offline.page.label.ready',
} as const satisfies Record<OfflineStatus, MessageKey>;

const STATUS_DESCRIPTION = {
	checking: 'offline.page.description.checking',
	'browser-offline': 'offline.page.description.browserOffline',
	'server-unreachable': 'offline.page.description.serverUnreachable',
	unauthenticated: 'offline.page.description.unauthenticated',
} as const satisfies Partial<Record<OfflineStatus, MessageKey>>;

/** Badge, heading and description of the offline page for a connection status. */
export function offlineStatusCopy(
	status: OfflineStatus,
	online: boolean,
	hasWg = true,
): { label: Message; heading: Message; description: Message } {
	const heading: MessageKey =
		status === 'checking'
			? 'offline.page.title.checking'
			: status === 'server-unreachable'
				? 'offline.page.title.serverUnreachable'
				: status === 'unauthenticated'
					? 'offline.page.title.unauthenticated'
					: status === 'ready' && online
						? 'offline.page.title.online'
						: 'offline.page.title.offline';
	const description: MessageKey =
		status === 'ready'
			? hasWg
				? 'offline.page.description.readyWithFlat'
				: 'offline.page.description.readyWithoutFlat'
			: STATUS_DESCRIPTION[status];
	return {
		label: { key: STATUS_LABEL[status] },
		heading: { key: heading },
		description: { key: description },
	};
}
