'use client';

import { subscribeOnline, subscribeVisibility } from '@/core/hooks/use-online-status';
import { useEffect, useRef } from 'react';

/**
 * Like setInterval but paused while the document is hidden; `tick()` runs immediately when the
 * tab becomes visible again or the connection comes back. Background tabs therefore cost no API
 * traffic, database connections or rate-limit quota.
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
			savedCallback.current();
		});
		// Regaining the connection is a "became reachable" moment, like the tab becoming visible.
		const unsubscribeOnline = subscribeOnline(() => {
			if (!document.hidden) savedCallback.current();
		});
		return () => {
			unsubscribeVisibility();
			unsubscribeOnline();
			stop();
		};
	}, [delayMs]);
}
