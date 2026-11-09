'use client';

import { useLocale } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { Member } from '@/components/wg/WgContextProvider';
import type { TodayImportantItem } from '@/composition/dashboard-insights';
import { pendingChoreCompletions } from '@/core/offline/offline-queue';
import { readOfflineQueue, subscribeOfflineQueueChanges } from '@/core/offline/offline-store';
import {
	type ChoreOccurrence,
	choreCompletionFeedback,
	completionRequestKey,
} from '@/features/chores/chore-completion';
import { getChoreStatus } from '@/features/chores/chore-status';
import { useChoreCompletion } from '@/features/chores/hooks/use-chore-completion';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';

interface HomeChoreCompletionInput {
	wg: { id: string; shareCode: string };
	identity: { memberId: string };
	members: Member[];
	reload: () => void;
}

function queuedChoreCompletions(shareCode: string): ReadonlySet<string> {
	return new Set(pendingChoreCompletions(readOfflineQueue(), shareCode).map(completionRequestKey));
}

/** Outcomes after which the row stays gone: the chore moved on, or a reload will say how. */
const ROW_STAYS_GONE: ReadonlySet<string> = new Set([
	'completed',
	'queued',
	'already_completed',
	'occurrence_changed',
	'not_found',
]);

/**
 * Only the member's own chores can be checked off on the start page. As in the cleaning plan:
 * one tap completes (the row leaves at once and the toast offers an undo); a late chore asks
 * in the confirm dialog first. The outcome copy is the cleaning plan's.
 */
export function useHomeChoreCompletion({
	wg,
	identity,
	members,
	reload,
}: HomeChoreCompletionInput) {
	const toast = useToast();
	const render = useMessage();
	const locale = useLocale() as Locale;
	const { complete, undoAction } = useChoreCompletion(wg, identity);
	const [confirmItem, setConfirmItem] = useState<TodayImportantItem | null>(null);
	const [pendingChoreId, setPendingChoreId] = useState<string | null>(null);
	const [doneTick, setDoneTick] = useState(0);
	const [completeError, setCompleteError] = useState<string | null>(null);
	const [queuedOccurrences, setQueuedOccurrences] = useState<ReadonlySet<string>>(() => new Set());
	// Completed on this screen and not yet confirmed by a reload: the row is already gone.
	const [completedOccurrences, setCompletedOccurrences] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const hiddenOccurrences = useMemo(
		() => new Set([...queuedOccurrences, ...completedOccurrences]),
		[queuedOccurrences, completedOccurrences],
	);
	function setCompleted(key: string, hidden: boolean): void {
		setCompletedOccurrences((current) => {
			const next = new Set(current);
			if (hidden) next.add(key);
			else next.delete(key);
			return next;
		});
	}

	// Read from the queue itself: a completion that synced, was discarded or
	// was rejected on replay shows its chore again instead of hiding it for the session.
	useEffect(() => {
		const update = () => setQueuedOccurrences(queuedChoreCompletions(wg.shareCode));
		update();
		const unsubscribeQueueChanges = subscribeOfflineQueueChanges(update);
		window.addEventListener('manawg:offline-synced', update);
		return () => {
			unsubscribeQueueChanges();
			window.removeEventListener('manawg:offline-synced', update);
		};
	}, [wg.shareCode]);

	async function confirm(item: TodayImportantItem): Promise<void> {
		const choreId = item.entityId;
		if (!choreId || !item.expectedNextDueAt || pendingChoreId) return;
		const chore: ChoreOccurrence = {
			id: choreId,
			// Chore rows carry the chore's own title as text.
			title: typeof item.title === 'string' ? item.title : '',
			nextDueAt: item.expectedNextDueAt,
			assignedMemberId: item.expectedAssignedMemberId ?? null,
		};
		const occurrenceKey = completionRequestKey(chore);
		const inDialog = confirmItem?.entityId === choreId;
		setCompleteError(null);
		setPendingChoreId(choreId);
		// A row with an open dialog stays until the outcome: the dialog shows the saving state.
		if (!inDialog) setCompleted(occurrenceKey, true);
		const outcome = await complete(chore);
		setPendingChoreId(null);
		if (outcome.kind === 'queued') setQueuedOccurrences(queuedChoreCompletions(wg.shareCode));
		setCompleted(occurrenceKey, ROW_STAYS_GONE.has(outcome.kind));

		const feedback = choreCompletionFeedback(
			outcome,
			chore,
			(id) => {
				const name = members.find((member) => member.id === id)?.name;
				// The start page names the member, even when it is the viewer.
				return name === undefined ? undefined : { name, isSelf: false };
			},
			locale,
		);
		const message = render(feedback.message);
		const toastText = feedback.toast ? render(feedback.toast) : null;
		const undo = undoAction(outcome, chore, () => {
			setCompleted(occurrenceKey, false);
			reload();
		});
		const withUndo = undo && { action: undo };
		// The start page has no message slot outside the dialog: what outlives it is a toast.
		if (feedback.tone === 'success') toast.success(message, withUndo);
		else if (feedback.tone === 'notice') toast.info(message, withUndo);
		else if (feedback.done || !inDialog) toast.error(message);
		else setCompleteError(message);
		if (toastText && toastText !== message) toast.error(toastText);
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
		hiddenOccurrences,
		/** The tap on a row: a late chore opens the confirm dialog, any other completes at once. */
		check(item: TodayImportantItem) {
			if (getChoreStatus(item.expectedNextDueAt ?? '').action === 'catchUp') {
				setCompleteError(null);
				setConfirmItem(item);
			} else {
				void confirm(item);
			}
		},
		cancel() {
			setConfirmItem(null);
		},
		confirm,
	};
}

export type HomeChoreCompletion = ReturnType<typeof useHomeChoreCompletion>;
