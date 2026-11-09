'use client';

import { useEffect, useState } from 'react';

/** The page must have been visible this long before the visit counts as seen. */
const SEEN_AFTER_MS = 5_000;

/**
 * When this member last saw the start page, kept in this browser only. `undefined` until
 * localStorage was read, `null` on the first visit. The value is read once per mount, so the
 * "new since" list does not vanish when the marker advances during the visit. The marker advances
 * after 5 s of visible time or when the page is left, never on a quick reload or tab flip.
 */
export function useLastSeen(wgId: string, memberId: string): number | null | undefined {
	const key = `manawg:start-last-seen:${wgId}:${memberId}`;
	const [state, setState] = useState<{ key: string; since: number | null } | null>(null);

	useEffect(() => {
		const write = () => {
			try {
				localStorage.setItem(key, new Date().toISOString());
			} catch {
				// Blocked storage: nothing is remembered, the list stays empty.
			}
		};
		let since: number | null = null;
		try {
			const parsed = Date.parse(localStorage.getItem(key) ?? '');
			// A marker from the future (clock changed) cannot hide newer entries forever.
			if (Number.isFinite(parsed)) since = Math.min(parsed, Date.now());
		} catch {
			// Blocked storage: treated like a first visit.
		}
		setState({ key, since });
		if (since === null) write();

		let seenMs = 0;
		let visibleSince: number | null = null;
		let timer: number | undefined;
		const start = () => {
			if (visibleSince !== null) return;
			visibleSince = Date.now();
			timer = window.setTimeout(write, Math.max(0, SEEN_AFTER_MS - seenMs));
		};
		const stop = () => {
			window.clearTimeout(timer);
			if (visibleSince !== null) seenMs += Date.now() - visibleSince;
			visibleSince = null;
			if (seenMs >= SEEN_AFTER_MS) write();
		};
		const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
		if (document.visibilityState === 'visible') start();
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', stop);
		window.addEventListener('pageshow', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', stop);
			window.removeEventListener('pageshow', onVisibility);
			stop();
		};
	}, [key]);

	return state?.key === key ? state.since : undefined;
}
