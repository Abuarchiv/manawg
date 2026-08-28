'use client';

import { useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 3000;

interface ConfirmDelete {
	confirmId: string | null;
	request: (id: string) => boolean;
	cancel: () => void;
}

export function useConfirmDelete(timeoutMs = DEFAULT_TIMEOUT_MS): ConfirmDelete {
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, []);

	function stopTimer(): void {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}

	function request(id: string): boolean {
		if (confirmId === id) {
			stopTimer();
			setConfirmId(null);
			return true;
		}

		stopTimer();
		setConfirmId(id);
		timerRef.current = setTimeout(() => {
			setConfirmId((current) => (current === id ? null : current));
			timerRef.current = null;
		}, timeoutMs);

		return false;
	}

	function cancel(): void {
		stopTimer();
		setConfirmId(null);
	}

	return { confirmId, request, cancel };
}
