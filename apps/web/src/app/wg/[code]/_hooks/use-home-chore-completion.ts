'use client';

import { useToast } from '@/components/ui/Toast';
import type { Member } from '@/components/wg/WgContextProvider';
import type { TodayImportantItem } from '@/composition/dashboard-insights';
import { pendingChoreCompletions } from '@/core/offline/offline-queue';
import { readOfflineQueue } from '@/core/offline/offline-store';
import {
	type ChoreOccurrence,
	choreCompletionFeedback,
	completionRequestKey,
} from '@/features/chores/chore-completion';
import { useChoreCompletion } from '@/features/chores/hooks/use-chore-completion';
import { useEffect, useState } from 'react';

interface HomeChoreCompletionInput {
	wg: { id: string; shareCode: string };
	identity: { memberId: string };
	members: Member[];
	reload: () => void;
}

function queuedChoreCompletions(shareCode: string): ReadonlySet<string> {
	return new Set(pendingChoreCompletions(readOfflineQueue(), shareCode).map(completionRequestKey));
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

	// Read from the queue itself: a completion that synced, was discarded or
	// was rejected on replay shows its chore again instead of hiding it for the session.
	useEffect(() => {
		const update = () => setQueuedOccurrences(queuedChoreCompletions(wg.shareCode));
		update();
		window.addEventListener('manawg:offline-queue', update);
		window.addEventListener('manawg:offline-synced', update);
		return () => {
			window.removeEventListener('manawg:offline-queue', update);
			window.removeEventListener('manawg:offline-synced', update);
		};
	}, [wg.shareCode]);

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
		if (outcome.kind === 'queued') setQueuedOccurrences(queuedChoreCompletions(wg.shareCode));

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
