import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { type Dispatch, type SetStateAction, useRef } from 'react';
import { explainChatError } from '../chat-errors';
import { withOwnReaction } from '../chat-reactions';
import type { ReactionMutationTracker } from '../chat-refresh';
import type { ChatReactionRow } from '../chat-types';

interface ChatReactionsOptions {
	encodedShareCode: string;
	memberId: string;
	setReactionRows: Dispatch<SetStateAction<ChatReactionRow[]>>;
}

/**
 * Adding and removing the viewer's reactions. Each change is tracked as in flight (and versioned
 * once committed) so a concurrent refresh keeps the local state instead of an older snapshot.
 */
export function useChatReactions({
	encodedShareCode,
	memberId,
	setReactionRows,
}: ChatReactionsOptions) {
	const requestKeysRef = useRef(new Map<string, string>());
	const trackerRef = useRef<ReactionMutationTracker>({ versions: new Map(), pending: new Set() });

	async function mutateReaction(
		kind: 'add' | 'remove',
		messageId: string,
		emoji: string,
	): Promise<string | null> {
		const action = kind === 'add' ? 'react' : 'unreact';
		const requestKeyId = `${kind}:${messageId}:${emoji}`;
		const idempotencyKey = requestKeysRef.current.get(requestKeyId) ?? createIdempotencyKey();
		if (!idempotencyKey) {
			return explainChatError(action, 'Netzwerkfehler');
		}
		requestKeysRef.current.set(requestKeyId, idempotencyKey);

		const tracker = trackerRef.current;
		const mutationKey = `${messageId}|${memberId}|${emoji}`;
		const current = tracker.versions.get(mutationKey);
		tracker.versions.set(mutationKey, { messageId, version: (current?.version ?? 0) + 1 });
		tracker.pending.add(mutationKey);
		let committed = false;
		try {
			const reactionsUrl = `/api/wg/${encodedShareCode}/chat/messages/${messageId}/reactions`;
			const res =
				kind === 'add'
					? await apiFetch(reactionsUrl, {
							method: 'POST',
							memberId,
							headers: { 'Idempotency-Key': idempotencyKey },
							body: JSON.stringify({ emoji }),
						})
					: await apiFetch(`${reactionsUrl}?emoji=${encodeURIComponent(emoji)}`, {
							method: 'DELETE',
							memberId,
							headers: { 'Idempotency-Key': idempotencyKey },
						});
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error))
					requestKeysRef.current.delete(requestKeyId);
				return explainChatError(action, res.error);
			}
			committed = true;
			// A committed add or remove settles both directions: a key kept from an earlier
			// uncertain attempt in the other direction would otherwise replay that old result
			// later instead of reaching the server.
			requestKeysRef.current.delete(`add:${messageId}:${emoji}`);
			requestKeysRef.current.delete(`remove:${messageId}:${emoji}`);
			setReactionRows((prev) => withOwnReaction(prev, kind, { messageId, memberId, emoji }));
			return null;
		} finally {
			const latest = tracker.versions.get(mutationKey);
			if (committed && latest) {
				tracker.versions.set(mutationKey, { ...latest, version: latest.version + 1 });
			}
			tracker.pending.delete(mutationKey);
		}
	}

	return {
		tracker: trackerRef.current,
		react: (messageId: string, emoji: string) => mutateReaction('add', messageId, emoji),
		unreact: (messageId: string, emoji: string) => mutateReaction('remove', messageId, emoji),
	};
}
