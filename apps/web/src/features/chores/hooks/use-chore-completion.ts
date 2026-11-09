import { useTranslations } from 'next-intl';
import { useCallback, useRef } from 'react';
import { type ToastAction, useToast } from '@/components/ui/Toast';
import {
	type ChoreCompletionOutcome,
	type ChoreOccurrence,
	type ChoreUndoResult,
	submitChoreCompletion,
	undoChoreCompletion,
	undoQueuedChoreCompletion,
} from '@/features/chores/chore-completion';

interface ChoreCompletionIdentity {
	memberId: string;
}

/**
 * Completing a chore, shared by the start page and the cleaning plan. Keeps the
 * idempotency key per occurrence across retries for as long as the page lives.
 * `undoAction` is the toast action that takes the completion back: it removes a completion
 * still waiting in the offline queue, or asks the server to undo one that was saved.
 */
export function useChoreCompletion(
	wg: { id: string; shareCode: string },
	identity: ChoreCompletionIdentity,
): {
	complete: (chore: ChoreOccurrence) => Promise<ChoreCompletionOutcome>;
	undoAction: (
		outcome: ChoreCompletionOutcome,
		chore: ChoreOccurrence,
		onUndone: () => void,
	) => ToastAction | undefined;
} {
	const keysRef = useRef(new Map<string, string>());
	const toast = useToast();
	const t = useTranslations('chores.completion');
	const tShell = useTranslations('shell.ui');
	const { id: wgId, shareCode } = wg;
	const { memberId } = identity;
	const complete = useCallback(
		(chore: ChoreOccurrence) =>
			submitChoreCompletion({ wgId, shareCode, memberId, keys: keysRef.current }, chore),
		[wgId, shareCode, memberId],
	);
	const undoAction = useCallback(
		(
			outcome: ChoreCompletionOutcome,
			chore: ChoreOccurrence,
			onUndone: () => void,
		): ToastAction | undefined => {
			let revert: (() => Promise<ChoreUndoResult>) | null = null;
			if (outcome.kind === 'completed' && outcome.receipt) {
				const receipt = outcome.receipt;
				revert = () => undoChoreCompletion({ shareCode, memberId }, chore.id, receipt);
			} else if (outcome.kind === 'queued') {
				const { queuedActionId } = outcome;
				revert = () => undoQueuedChoreCompletion({ shareCode, memberId }, queuedActionId, chore);
			}
			if (!revert) return undefined;
			const run = revert;
			let attempted = false;
			return {
				label: tShell('undo'),
				onAction: () => {
					if (attempted) return;
					attempted = true;
					void run().then((result) => {
						if (result === 'undone') {
							onUndone();
							toast.info(t('undone', { title: chore.title }));
						} else {
							toast.error(t(result === 'unavailable' ? 'undoUnavailable' : 'undoFailed'));
						}
					});
				},
			};
		},
		[shareCode, memberId, toast, t, tShell],
	);
	return { complete, undoAction };
}
