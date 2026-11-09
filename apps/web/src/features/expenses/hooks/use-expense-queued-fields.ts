'use client';

import { useCallback, useMemo, useState } from 'react';
import type { OfflineActionType } from '@/core/offline/offline-queue';
import type { ExpenseDraft } from '@/features/expenses/expense-form-draft';

/**
 * The form fields that only matter for a queued offline edit or a fixed-cost booking.
 * They travel with the draft and are cleared whenever the form switches to another record.
 */
export function useExpenseQueuedFields() {
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [queueEditType, setQueueEditType] = useState<OfflineActionType | null>(null);
	const [recurringIntervalMonths, setRecurringIntervalMonths] = useState(1);
	const [recurringNextDueAt, setRecurringNextDueAt] = useState<string | null>(null);

	// Stable while no field changes, so effects can list it as a dependency.
	const draftFields = useMemo(
		() => ({ queueEditId, queueEditType, recurringIntervalMonths, recurringNextDueAt }),
		[queueEditId, queueEditType, recurringIntervalMonths, recurringNextDueAt],
	);
	const clear = useCallback((): void => {
		setQueueEditId(null);
		setQueueEditType(null);
		setRecurringIntervalMonths(1);
		setRecurringNextDueAt(null);
	}, []);
	const restore = useCallback((draft: ExpenseDraft): void => {
		if (draft.queueEditId) setQueueEditId(draft.queueEditId);
		if (draft.queueEditType) setQueueEditType(draft.queueEditType);
		if (draft.recurringIntervalMonths) setRecurringIntervalMonths(draft.recurringIntervalMonths);
		if (draft.recurringNextDueAt) setRecurringNextDueAt(draft.recurringNextDueAt);
	}, []);

	return {
		queueEditId,
		setQueueEditId,
		queueEditType,
		setQueueEditType,
		recurringIntervalMonths,
		setRecurringIntervalMonths,
		recurringNextDueAt,
		setRecurringNextDueAt,
		draftFields,
		clear,
		restore,
	};
}
