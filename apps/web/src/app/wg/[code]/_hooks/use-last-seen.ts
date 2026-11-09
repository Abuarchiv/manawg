'use client';

import { useEffect, useRef, useState } from 'react';

/** The page must have been visible this long before the visit counts as seen. */
const SEEN_AFTER_MS = 5_000;

function writeMarker(key: string, serverTime: string | undefined): void {
	if (!serverTime) return;
	try {
		// Never moves back, e.g. when an older cached payload is on screen.
		if (!(Date.parse(localStorage.getItem(key) ?? '') >= Date.parse(serverTime)))
			localStorage.setItem(key, serverTime);
	} catch {
		// Blocked storage: nothing is remembered.
	}
}

/**
 * When this member last saw the start page, kept in this browser only. The marker is the server
 * time of the dashboard payload on screen (`serverTime`), so it compares with the server
 * timestamps of the entries and does not depend on the phone's clock. `undefined` until
 * localStorage was read, `null` when no marker exists (first visit, blocked storage). The value is
 * read once per mount, so the "new since" list does not vanish when the marker advances during the
 * visit. The marker advances after 5 s of visible time or when the page is left, never on a quick
 * reload or tab flip, and never before a payload has loaded.
 */
export function useLastSeen(
	wgId: string,
	memberId: string,
	serverTime: string | undefined,
): number | null | undefined {
	const key = `manawg:start-last-seen:${wgId}:${memberId}`;
	const [state, setState] = useState<{ key: string; since: number | null } | null>(null);
	const serverTimeRef = useRef(serverTime);

	useEffect(() => {
		// Keeps the last payload shown while a refresh has no data for a moment.
		if (serverTime) serverTimeRef.current = serverTime;
	}, [serverTime]);

	useEffect(() => {
		let since: number | null = null;
		try {
			const parsed = Date.parse(localStorage.getItem(key) ?? '');
			if (Number.isFinite(parsed)) since = parsed;
		} catch {
			// Blocked storage: no marker, nothing is claimed about the last visit.
		}
		setState({ key, since });
	}, [key]);

	const firstVisit = state?.key === key && state.since === null;
	useEffect(() => {
		if (firstVisit && serverTime) writeMarker(key, serverTime);
	}, [firstVisit, key, serverTime]);

	useEffect(() => {
		const write = () => writeMarker(key, serverTimeRef.current);
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
