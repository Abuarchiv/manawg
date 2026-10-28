'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTodayInputValue } from '@/core/hooks/use-today-input-value';
import type { ExpenseDraft } from '@/features/expenses/expense-form-draft';

const INPUT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The expense date and the members an equal split is shared between. Kept apart from the rest of
 * the form state; `null` participants means every active member.
 */
export function useExpenseFormExtras() {
	// null until the resident picks a day, so the form follows the current day.
	const [pickedOccurredOn, setOccurredOn] = useState<string | null>(null);
	const today = useTodayInputValue();
	const occurredOn = pickedOccurredOn ?? today;
	const [participantIds, setParticipantIds] = useState<string[] | null>(null);

	const reset = useCallback(() => {
		setOccurredOn(null);
		setParticipantIds(null);
	}, []);
	const load = useCallback((values: { occurredOn: string; participantIds: string[] | null }) => {
		setOccurredOn(values.occurredOn);
		setParticipantIds(values.participantIds);
	}, []);
	/** Takes over what a stored draft holds; the draft is untrusted localStorage data. */
	const restore = useCallback((draft: ExpenseDraft) => {
		if (typeof draft.occurredOn === 'string' && INPUT_DATE_PATTERN.test(draft.occurredOn)) {
			setOccurredOn(draft.occurredOn);
		}
		if (Array.isArray(draft.participantIds)) {
			setParticipantIds(draft.participantIds.filter((id) => typeof id === 'string'));
		}
	}, []);
	// Stable while neither field changes, so effects can list it as a dependency.
	const draftFields = useMemo(
		() => ({ occurredOn: pickedOccurredOn, participantIds }),
		[pickedOccurredOn, participantIds],
	);

	return {
		/** The shown day: the picked one, else today. */
		occurredOn,
		/** The day the resident picked; null while untouched. */
		pickedOccurredOn,
		setOccurredOn,
		participantIds,
		setParticipantIds,
		/** The fields stored with the draft. */
		draftFields,
		reset,
		load,
		restore,
	};
}
