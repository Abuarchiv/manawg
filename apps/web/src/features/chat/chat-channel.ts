'use client';

import { useEffect, useRef, useState } from 'react';

// 8s default keeps the chat reasonably fresh while avoiding the 3s
// busy-loop full-refetch problem. Visibility-pause halts polling while
// the tab is hidden (handled inline below).
const POLL_DEFAULT_MS = 8000;

interface ChatChannelHandlers {
	onMessageCreated?: () => void;
	onMessageUpdated?: () => void;
	onMessageDeleted?: () => void;
	onReactionChanged?: () => void;
	onTyping?: (memberId: string) => void;
}

interface ChatPollingResult {
	tick: number;
	mode: 'realtime' | 'polling';
}

/**
 * Chat updates feed. Returns an incrementing `tick` whenever the channel
 * fires a change. The consumer should re-fetch its data on tick change.
 *
 * This codebase currently uses polling only (no Supabase Realtime client
 * is shipped). The `mode` field is retained for forward-compat with a
 * future realtime implementation; it is always `'polling'` today.
 */
export function useChatChannel(
	wgId: string | null,
	handlers: ChatChannelHandlers = {},
	pollIntervalMs: number = POLL_DEFAULT_MS,
): ChatPollingResult {
	const [tick, setTick] = useState(0);
	const handlersRef = useRef(handlers);
	useEffect(() => {
		handlersRef.current = handlers;
	}, [handlers]);

	useEffect(() => {
		if (!wgId) return;
		let pollTimer: ReturnType<typeof setInterval> | null = null;

		// Start/stop around the page being visible — no timer ticks (and no
		// catch-up refetch) while the tab is hidden.
		const start = (): void => {
			if (pollTimer !== null) return;
			pollTimer = setInterval(() => {
				handlersRef.current.onMessageCreated?.();
				setTick((value) => value + 1);
			}, pollIntervalMs);
		};
		const stop = (): void => {
			if (pollTimer === null) return;
			clearInterval(pollTimer);
			pollTimer = null;
		};
		const onVisibilityChange = (): void => {
			if (typeof document === 'undefined') return;
			if (document.visibilityState === 'hidden') {
				stop();
				return;
			}
			// Catch up immediately on return instead of waiting a full interval.
			start();
			handlersRef.current.onMessageCreated?.();
			setTick((value) => value + 1);
		};

		if (typeof document === 'undefined' || document.visibilityState !== 'hidden') start();
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			stop();
		};
	}, [wgId, pollIntervalMs]);

	return { tick, mode: 'polling' };
}
