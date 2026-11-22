'use client';

import { useEffect, useRef } from 'react';
import type { WgChangeVersions } from '@/core/db/change-versions';
import { apiFetch } from '@/core/infra/api-client';
import {
	LIST_REFRESH_INTERVAL_MS,
	useVisibilityPausedInterval,
} from '@/core/utils/use-visibility-paused-interval';

export type WgChangeScope = keyof WgChangeVersions;

interface ChangeListener {
	reload: () => void;
	/** The last reload failed: the next poll reloads again even if nothing moved since. */
	stale: () => boolean;
}

const listeners: Record<WgChangeScope, Set<ChangeListener>> = {
	data: new Set(),
	members: new Set(),
	chat: new Set(),
};

const pollers = new Set<() => void>();

/** Runs the open WG tab's change poll now, for a reader that needs news sooner than every 30 s. */
export function pollWgChangesNow(): void {
	for (const poll of pollers) poll();
}

/**
 * Runs `onChange` whenever the WG shell's change poll sees `scope` move: the list pages reload
 * on `data`, the shell on `members`, the unread badge on `chat`. Replaces one interval per
 * reader with a single cheap request per tab. While `isStale()` says the read's last load
 * failed, every poll runs `onChange` again until one succeeds. `enabled: false` subscribes to
 * nothing.
 */
export function useWgChange(
	scope: WgChangeScope,
	onChange: () => void,
	{ enabled = true, isStale }: { enabled?: boolean; isStale?: () => boolean } = {},
): void {
	const saved = useRef({ onChange, isStale });
	saved.current = { onChange, isStale };
	useEffect(() => {
		if (!enabled) return;
		const listener: ChangeListener = {
			reload: () => saved.current.onChange(),
			stale: () => saved.current.isStale?.() ?? false,
		};
		listeners[scope].add(listener);
		return () => {
			listeners[scope].delete(listener);
		};
	}, [enabled, scope]);
}

/**
 * The one poll of an open WG tab, every 30 s while visible and in use (paused like every
 * `useVisibilityPausedInterval`). It compares against `baseline`, the versions the WG layout read
 * on the server before any client read of the page; later answers notify the scopes whose
 * version moved. Without a baseline (the server read failed, another member signed in) the
 * first answer cannot tell what the page missed, so it notifies every scope once. A removed
 * member's 401 raises the membership-lost event in `apiFetch`, as the members poll did. The
 * service worker's push message triggers an extra poll.
 */
export function useWgChangesPoll(
	encodedShareCode: string,
	memberId: string | null,
	baseline: WgChangeVersions | null,
): void {
	const lastRef = useRef<WgChangeVersions | null>(baseline);
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
			for (const scope of ['members', 'data', 'chat'] as const) {
				const moved = !previous || res.data[scope] !== previous[scope];
				for (const listener of listeners[scope]) {
					if (moved || listener.stale()) listener.reload();
				}
			}
		} catch {
			// Network blip: the next tick, the tab becoming visible or the online event retries.
		} finally {
			runningRef.current = false;
		}
	};
	const pollRef = useRef(poll);
	pollRef.current = poll;

	// A different member's reads are not covered by the server baseline.
	const baselineMemberRef = useRef(memberId);
	useEffect(() => {
		if (!memberId || !encodedShareCode) return;
		if (baselineMemberRef.current === null) baselineMemberRef.current = memberId;
		if (baselineMemberRef.current !== memberId) {
			baselineMemberRef.current = memberId;
			lastRef.current = null;
		}
		if (lastRef.current === null) void pollRef.current();
	}, [encodedShareCode, memberId]);

	useVisibilityPausedInterval(
		() => void pollRef.current(),
		memberId ? LIST_REFRESH_INTERVAL_MS : null,
	);

	useEffect(() => {
		const poll = () => void pollRef.current();
		pollers.add(poll);
		return () => {
			pollers.delete(poll);
		};
	}, []);

	// A push (such as "Mina joined") polls at once instead of waiting for the next tick.
	useEffect(() => {
		const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
		if (!memberId || !container) return;
		const onMessage = (event: MessageEvent) => {
			if ((event.data as { type?: unknown } | null)?.type === 'push') void pollRef.current();
		};
		container.addEventListener('message', onMessage);
		return () => container.removeEventListener('message', onMessage);
	}, [memberId]);
}
