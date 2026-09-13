'use client';

import { useState } from 'react';

interface ConfirmDelete {
	confirmId: string | null;
	request: (id: string) => boolean;
	cancel: () => void;
}

export function useConfirmDelete(_timeoutMs?: number): ConfirmDelete {
	const [confirmId, setConfirmId] = useState<string | null>(null);

	function request(id: string): boolean {
		if (confirmId === id) {
			setConfirmId(null);
			return true;
		}

		setConfirmId(id);
		return false;
	}

	function cancel(): void {
		setConfirmId(null);
	}

	return { confirmId, request, cancel };
}
