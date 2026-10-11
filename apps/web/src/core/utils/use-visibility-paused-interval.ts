'use client';

import { subscribeOnline, subscribeVisibility } from '@/core/hooks/use-online-status';
import { useEffect, useRef } from 'react';

/** Spreads the catch-up ticks of all pollers over this window after the tab returns. */
const RESUME_JITTER_MS = 1500;

/**
 * Like setInterval but paused while the document is hidden; `tick()` runs immediately when the
 * tab becomes visible again or the connection comes back. Background tabs therefore cost no API
 * traffic, database connections or rate-limit quota.
 *
 * The immediate tick is delayed by a random 0-1500 ms so the pollers of one page do not all
 * fire in the same instant.
 *
 * `callback` is stored in a ref so changing identity does not restart the timer.
 */
export function useVisibilityPausedInterval(callback: () => void, delayMs: number | null): void {
	const savedCallback = useRef(callback);
	useEffect(() => {
		savedCallback.current = callback;
	}, [callback]);

	useEffect(() => {
		if (delayMs === null) return;

		let timer: ReturnType<typeof setInterval> | null = null;
		let resumeTimer: ReturnType<typeof setTimeout> | null = null;
		const tickSoon = (): void => {
			if (resumeTimer !== null) clearTimeout(resumeTimer);
			resumeTimer = setTimeout(() => {
				resumeTimer = null;
				if (typeof document === 'undefined' || !document.hidden) savedCallback.current();
			}, Math.random() * RESUME_JITTER_MS);
		};
		const start = (): void => {
			if (timer !== null) return;
			timer = setInterval(() => {
				if (typeof document !== 'undefined' && document.hidden) return;
				savedCallback.current();
			}, delayMs);
		};
		const stop = (): void => {
			if (timer === null) return;
			clearInterval(timer);
			timer = null;
		};

		if (typeof document === 'undefined' || !document.hidden) start();
		const unsubscribeVisibility = subscribeVisibility((visible) => {
			if (!visible) {
				stop();
				return;
			}
			start();
			tickSoon();
		});
		// Regaining the connection is a "became reachable" moment, like the tab becoming visible.
		const unsubscribeOnline = subscribeOnline(() => {
			if (!document.hidden) tickSoon();
		});
		return () => {
			unsubscribeVisibility();
			unsubscribeOnline();
			stop();
			if (resumeTimer !== null) clearTimeout(resumeTimer);
		};
	}, [delayMs]);
}
