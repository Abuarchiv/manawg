import { type KnownWg, belongsToAccount, getKnownWgs } from '@/core/auth/local-account';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { parseAccountWgs } from '@/core/infra/account-wgs';
import { type OfflineAction, getOfflineActionSummary } from '@/core/offline/offline-queue';
import { parseTimestamp } from '@/core/utils/time';
import { pluralize } from '@/shared/lib/plural';

export function moduleLabel(action: OfflineAction): string {
	return getOfflineActionSummary(action).title;
}

export function formatOfflineAge(iso: string, now = Date.now()): string {
	const timestamp = parseTimestamp(iso);
	if (timestamp === null) return 'Zeitpunkt unklar';
	const ageMs = now - timestamp;
	if (ageMs < 0) return 'Zeitpunkt in der Zukunft';
	if (ageMs < 60_000) return 'gerade eben';
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `vor ${minutes} Min.`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `vor ${hours} Std.`;
	const days = Math.floor(hours / 24);
	return `vor ${pluralize(days, 'Tag', 'Tagen')}`;
}

export function countByShareCode(items: OfflineAction[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.shareCode, (counts.get(item.shareCode) ?? 0) + 1);
	return counts;
}

export function formatQueuedActionCount(count: number): string {
	if (count === 0) return 'Keine wartenden Aktionen.';
	if (count === 1) return '1 Aktion wartet.';
	return `${count} Aktionen warten.`;
}

export function formatWgQueuedActionCount(count: number): string {
	if (count === 0) return 'Keine wartenden Aktionen';
	if (count === 1) return '1 Aktion wartet';
	return `${count} Aktionen warten`;
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
	// Signed-out visitors: no probe, no 401 in the console (same as /neu).
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

/** Badge, heading and description of the offline page for a connection status. */
export function offlineStatusCopy(status: OfflineStatus, online: boolean, hasWg = true) {
	const label =
		status === 'checking'
			? 'Prüft…'
			: status === 'browser-offline'
				? 'Offline-Modus'
				: status === 'server-unreachable'
					? 'Server nicht erreichbar'
					: status === 'unauthenticated'
						? 'Anmeldung nötig'
						: 'Wieder online';
	const heading =
		status === 'checking'
			? 'Verbindung wird geprüft…'
			: status === 'browser-offline'
				? 'Du bist gerade offline.'
				: status === 'server-unreachable'
					? 'Server gerade nicht erreichbar.'
					: status === 'unauthenticated'
						? 'Melde dich an, um Offline-Aktionen zu sehen.'
						: online
							? 'Du bist wieder verbunden.'
							: 'Du bist gerade offline.';
	const description =
		status === 'checking'
			? 'Einen Moment, wir prüfen deine Verbindung und dein Konto.'
			: status === 'browser-offline'
				? 'Deine lokal gespeicherten Aktionen bleiben sichtbar. Sobald du wieder online bist, kannst du sie synchronisieren.'
				: status === 'server-unreachable'
					? 'Der Server antwortet gerade nicht. Deine lokal gespeicherten Aktionen bleiben erhalten; versuche es später erneut.'
					: status === 'unauthenticated'
						? 'Offline-Aktionen und gemerkte WGs hängen an deinem Konto.'
						: hasWg
							? 'Deine Verbindung steht. Synchronisiere wartende Aktionen oder geh zurück in deine WG.'
							: 'Deine Verbindung steht. Wartende Aktionen kannst du jetzt synchronisieren.';
	return { label, heading, description };
}
