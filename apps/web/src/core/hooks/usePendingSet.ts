'use client';

import { useRef, useState } from 'react';

interface PendingSet {
	isPending: (id: string) => boolean;
	start: (id: string) => void;
	end: (id: string) => void;
	reset: () => void;
}

export function usePendingSet(): PendingSet {
	const [, setPending] = useState<Set<string>>(new Set());
	const pendingRef = useRef<Set<string>>(new Set());

	function isPending(id: string): boolean {
		return pendingRef.current.has(id);
	}

	function start(id: string): void {
		const next = new Set(pendingRef.current).add(id);
		pendingRef.current = next;
		setPending(next);
	}

	function end(id: string): void {
		const next = new Set(pendingRef.current);
		next.delete(id);
		pendingRef.current = next;
		setPending(next);
	}

	function reset(): void {
		const next = new Set<string>();
		pendingRef.current = next;
		setPending(next);
	}

	return { isPending, start, end, reset };
}
