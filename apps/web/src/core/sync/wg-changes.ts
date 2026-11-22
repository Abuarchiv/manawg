'use client';

import { useEffect, useRef } from 'react';
import { apiFetch } from '@/core/infra/api-client';
import {
	LIST_REFRESH_INTERVAL_MS,
	useVisibilityPausedInterval,
} from '@/core/utils/use-visibility-paused-interval';

/** `GET /api/wg/[code]/changes`: transaction ids as strings, compared for equality only. */
export interface WgChangeVersions {
	data: string;
	members: string;
	chat: string;
}

export type WgChangeScope = keyof WgChangeVersions;

const listeners: Record<WgChangeScope, Set<() => void>> = {
	data: new Set(),
	members: new Set(),
	chat: new Set(),
};

/**
 * Runs `onChange` whenever the WG shell's change poll sees `scope` move: the list pages reload
 * on `data`, the shell on `members`, the unread badge on `chat`. Replaces one interval per
 * reader with a single cheap request per tab. `enabled: false` subscribes to nothing.
 */
export function useWgChange(scope: WgChangeScope, onChange: () => void, enabled = true): void {
	const saved = useRef(onChange);
	saved.current = onChange;
	useEffect(() => {
		if (!enabled) return;
		const listener = (): void => saved.current();
		listeners[scope].add(listener);
		return () => {
			listeners[scope].delete(listener);
		};
	}, [enabled, scope]);
}

/**
 * The one poll of an open WG tab, every 30 s while visible and in use (paused like every
 * `useVisibilityPausedInterval`). The first answer is the baseline; later answers notify the
 * scopes whose version moved. A removed member's 401 raises the membership-lost event in
 * `apiFetch`, as the members poll did.
 */
export function useWgChangesPoll(encodedShareCode: string, memberId: string | null): void {
	const lastRef = useRef<WgChangeVersions | null>(null);
	const runningRef = useRef(false);

	const poll = async (): Promise<void> => {
		if (!memberId || runningRef.current) return;
		runningRef.current = true;
		try {
			const res = await apiFetch<WgChangeVersions>(`/api/wg/${encodedShareCode}/changes`, {
				memberId,
			});
			if (!res.ok) {
				// Another tab switched accounts: the layout resolves the new member.
				if (res.error === 'member_context_changed') window.location.reload();
				return;
			}
			const previous = lastRef.current;
			lastRef.current = res.data;
			if (!previous) return;
			for (const scope of ['members', 'data', 'chat'] as const) {
				if (res.data[scope] !== previous[scope])
					for (const listener of listeners[scope]) listener();
			}
		} catch {
			// Network blip: the next tick, the tab becoming visible or the online event retries.
		} finally {
			runningRef.current = false;
		}
	};
	const pollRef = useRef(poll);
	pollRef.current = poll;

	useEffect(() => {
		lastRef.current = null;
		if (memberId && encodedShareCode) void pollRef.current();
	}, [encodedShareCode, memberId]);

	useVisibilityPausedInterval(
		() => void pollRef.current(),
		memberId ? LIST_REFRESH_INTERVAL_MS : null,
	);
}
