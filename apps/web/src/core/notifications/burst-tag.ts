/** Entries by one member within one window replace each other on the device; see `public/sw.js`. */
export const BURST_WINDOW_MS = 30 * 60 * 1000;

/**
 * Push tag for a burst of shopping or chat entries. It names the sender and the window, so a
 * different sender or an older, unread notification is never replaced silently: only the next
 * entry of the same sender in the same window is. Keep the `shopping:`/`chat:` prefixes in step
 * with the service worker.
 */
export function burstTag(
	kind: 'shopping' | 'chat',
	wgId: string,
	memberId: string,
	now = Date.now(),
): string {
	return `${kind}:${wgId}:${memberId}:${Math.floor(now / BURST_WINDOW_MS)}`;
}
