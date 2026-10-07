'use client';

import { useToast } from '@/components/ui/Toast';
import type { Member } from '@/components/wg/WgContextProvider';
import type { TodayImportantItem } from '@/composition/dashboard-insights';
import {
	type ChoreOccurrence,
	choreCompletionFeedback,
	completionRequestKey,
} from '@/features/chores/chore-completion';
import { useChoreCompletion } from '@/features/chores/hooks/use-chore-completion';
import { useState } from 'react';

interface HomeChoreCompletionInput {
	wg: { id: string; shareCode: string };
	identity: { memberId: string };
	members: Member[];
	reload: () => void;
}

/**
 * Only the member's own chores can be checked off on the start page. As in the cleaning plan:
 * the button first, then the confirm dialog; the outcome copy is the cleaning plan's.
 */
export function useHomeChoreCompletion({
	wg,
	identity,
	members,
	reload,
}: HomeChoreCompletionInput) {
	const toast = useToast();
	const complete = useChoreCompletion(wg, identity);
	const [confirmItem, setConfirmItem] = useState<TodayImportantItem | null>(null);
	const [pendingChoreId, setPendingChoreId] = useState<string | null>(null);
	const [doneTick, setDoneTick] = useState(0);
	const [completeError, setCompleteError] = useState<string | null>(null);
	const [queuedOccurrences, setQueuedOccurrences] = useState<ReadonlySet<string>>(() => new Set());

	async function confirm(item: TodayImportantItem): Promise<void> {
		const choreId = item.entityId;
		if (!choreId || !item.expectedNextDueAt || pendingChoreId) return;
		const chore: ChoreOccurrence = {
			id: choreId,
			title: item.title,
			nextDueAt: item.expectedNextDueAt,
			assignedMemberId: item.expectedAssignedMemberId ?? null,
		};
		setCompleteError(null);
		setPendingChoreId(choreId);
		const outcome = await complete(chore);
		setPendingChoreId(null);
		if (outcome.kind === 'queued') {
			setQueuedOccurrences((current) => new Set(current).add(completionRequestKey(chore)));
		}

		const feedback = choreCompletionFeedback(
			outcome,
			chore,
			(id) => members.find((member) => member.id === id)?.name,
		);
		// The start page has no message slot outside the dialog: what outlives it is a toast.
		if (feedback.tone === 'success') toast.success(feedback.message);
		else if (feedback.tone === 'notice') toast.info(feedback.message);
		else if (feedback.done) toast.error(feedback.message);
		else setCompleteError(feedback.message);
		if (feedback.toast && feedback.toast !== feedback.message) toast.error(feedback.toast);
		if (feedback.done) {
			setConfirmItem(null);
			setDoneTick((tick) => tick + 1);
		}
		if (feedback.reload) reload();
	}

	return {
		confirmItem,
		doneTick,
		pendingChoreId,
		completeError,
		queuedOccurrences,
		arm(item: TodayImportantItem) {
			setCompleteError(null);
			setConfirmItem(item);
		},
		cancel() {
			setConfirmItem(null);
		},
		confirm,
	};
}

export type HomeChoreCompletion = ReturnType<typeof useHomeChoreCompletion>;
