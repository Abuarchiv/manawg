'use client';

import { useCallback, useRef, useState } from 'react';

interface PendingSet {
	/**
	 * Synchronous check against the latest start/end, for double-submit guards
	 * that run before React re-renders. Stable identity.
	 */
	isPending: (id: string) => boolean;
	/**
	 * The same set as render state. Pass this (not `isPending`) to memoized
	 * children: its identity changes on every start/end, so they re-render.
	 */
	pendingIds: ReadonlySet<string>;
	start: (id: string) => void;
	end: (id: string) => void;
	reset: () => void;
}

export function usePendingSet(): PendingSet {
	const [pendingIds, setPending] = useState<ReadonlySet<string>>(new Set<string>());
	const pendingRef = useRef<Set<string>>(new Set());

	// Callbacks stay referentially stable — callers hand them to memoized
	// children as props, where a fresh function identity defeats memoization.
	const isPending = useCallback((id: string): boolean => pendingRef.current.has(id), []);

	const start = useCallback((id: string): void => {
		const next = new Set(pendingRef.current).add(id);
		pendingRef.current = next;
		setPending(next);
	}, []);

	const end = useCallback((id: string): void => {
		const next = new Set(pendingRef.current);
		next.delete(id);
		pendingRef.current = next;
		setPending(next);
	}, []);

	const reset = useCallback((): void => {
		const next = new Set<string>();
		pendingRef.current = next;
		setPending(next);
	}, []);

	return { isPending, pendingIds, start, end, reset };
}
