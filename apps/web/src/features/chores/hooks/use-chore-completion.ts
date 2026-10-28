import { useCallback, useRef } from 'react';
import {
	type ChoreCompletionOutcome,
	type ChoreOccurrence,
	submitChoreCompletion,
} from '@/features/chores/chore-completion';

interface ChoreCompletionIdentity {
	memberId: string;
}

/**
 * Completing a chore, shared by the start page and the cleaning plan. Keeps the
 * idempotency key per occurrence across retries for as long as the page lives.
 */
export function useChoreCompletion(
	wg: { id: string; shareCode: string },
	identity: ChoreCompletionIdentity,
): (chore: ChoreOccurrence) => Promise<ChoreCompletionOutcome> {
	const keysRef = useRef(new Map<string, string>());
	const { id: wgId, shareCode } = wg;
	const { memberId } = identity;
	return useCallback(
		(chore: ChoreOccurrence) =>
			submitChoreCompletion({ wgId, shareCode, memberId, keys: keysRef.current }, chore),
		[wgId, shareCode, memberId],
	);
}
