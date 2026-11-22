'use client';

import { useEffect, useRef } from 'react';
import { subscribeOnline, subscribeVisibility } from '@/core/hooks/use-online-status';

/** Shared refresh period of the list pages while their tab is visible. */
export const LIST_REFRESH_INTERVAL_MS = 30_000;

/** Spreads the catch-up ticks of all pollers over this window after the tab returns. */
const RESUME_JITTER_MS = 1500;

/**
 * A visible tab nobody has touched for this long stops polling: a desktop tab left open all day
 * would otherwise cost thousands of requests. The next input refreshes at once.
 */
const IDLE_AFTER_MS = 5 * 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'];

let lastActivity = Date.now();
const wakeListeners = new Set<() => void>();
let trackingActivity = false;

/** Nobody has used the page for five minutes. */
export function isIdle(): boolean {
	return Date.now() - lastActivity > IDLE_AFTER_MS;
}

function markActive(): void {
	const wasIdle = isIdle();
	lastActivity = Date.now();
	if (wasIdle) for (const wake of wakeListeners) wake();
}

function subscribeWake(listener: () => void): () => void {
	if (!trackingActivity && typeof window !== 'undefined') {
		trackingActivity = true;
		for (const type of ACTIVITY_EVENTS)
			window.addEventListener(type, markActive, { capture: true, passive: true });
	}
	wakeListeners.add(listener);
	return () => {
		wakeListeners.delete(listener);
	};
}

/**
 * Like setInterval but paused while the document is hidden or nobody has used the page for five
 * minutes; `tick()` runs immediately when the tab becomes visible again, the user is back or the
 * connection comes back. Background and forgotten tabs therefore cost no API traffic, database
 * connections or rate-limit quota.
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
				if ((typeof document !== 'undefined' && document.hidden) || isIdle()) return;
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
			markActive();
			start();
			tickSoon();
		});
		const unsubscribeWake = subscribeWake(tickSoon);
		// Regaining the connection is a "became reachable" moment, like the tab becoming visible.
		const unsubscribeOnline = subscribeOnline(() => {
			if (!document.hidden) tickSoon();
		});
		return () => {
			unsubscribeVisibility();
			unsubscribeWake();
			unsubscribeOnline();
			stop();
			if (resumeTimer !== null) clearTimeout(resumeTimer);
		};
	}, [delayMs]);
}
