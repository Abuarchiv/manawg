'use client';

import { useCallback, useRef, useState } from 'react';

interface PendingSet {
	isPending: (id: string) => boolean;
	start: (id: string) => void;
	end: (id: string) => void;
	reset: () => void;
}

export function usePendingSet(): PendingSet {
	const [, setPending] = useState<Set<string>>(new Set());
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

	return { isPending, start, end, reset };
}
