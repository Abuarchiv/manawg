import { useEffect, useRef, useState } from 'react';
import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { haptic } from '@/shared/lib/haptics';
import type { BubbleMessage } from '../chat-types';

interface BubbleActionsOptions {
	message: BubbleMessage;
	draftKey: string;
	onReact: (messageId: string, emoji: string) => Promise<string | null>;
	onUnreact: (messageId: string, emoji: string) => Promise<string | null>;
	onEdit: (messageId: string, next: string) => Promise<string | null>;
	onDelete: (messageId: string) => Promise<string | null>;
}

/**
 * State of one message bubble: the edit draft (kept in local storage until saved or cancelled),
 * the delete confirmation and the reaction in flight. One request at a time per bubble.
 */
export function useMessageBubbleActions({
	message,
	draftKey,
	onReact,
	onUnreact,
	onEdit,
	onDelete,
}: BubbleActionsOptions) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.body ?? '');
	const [hasDraft, setHasDraft] = useState(false);
	const [pending, setPending] = useState(false);
	const [reactionPending, setReactionPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [reactOpen, setReactOpen] = useState(false);
	const pendingRef = useRef(false);
	const reactionRef = useRef(false);

	useEffect(() => {
		const saved = readDraft<{ body?: string }>(draftKey);
		// A draft identical to the stored message is no unsaved change.
		if (typeof saved?.body === 'string' && saved.body !== (message.body ?? '')) {
			setDraft(saved.body);
			setHasDraft(true);
		}
	}, [draftKey, message.body]);

	function changeDraft(value: string) {
		setDraft(value);
		setHasDraft(true);
		writeDraft(draftKey, { body: value });
	}

	function startEdit() {
		if (!hasDraft) setDraft(message.body ?? '');
		setError(null);
		setEditing(true);
	}

	function cancelEdit() {
		setEditing(false);
		setHasDraft(false);
		removeDraft(draftKey);
	}

	async function runExclusive(request: () => Promise<void>) {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await request();
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}

	async function saveEdit() {
		const text = draft.trim();
		if (!text || pendingRef.current) return;
		// Unchanged text sends no PATCH; it would mark the message as edited for no reason.
		if (text === (message.body ?? '').trim()) {
			cancelEdit();
			return;
		}
		await runExclusive(async () => {
			const failure = await onEdit(message.id, text);
			if (failure === null) {
				setEditing(false);
				setHasDraft(false);
				removeDraft(draftKey);
			} else setError(`${failure} Dein Text ist noch da.`);
		});
	}

	async function remove() {
		await runExclusive(async () => {
			const failure = await onDelete(message.id);
			if (failure === null) {
				setDeleteOpen(false);
				removeDraft(draftKey);
			} else setError(failure);
		});
	}

	function openDelete() {
		setError(null);
		setDeleteOpen(true);
	}

	async function toggleReaction(emoji: string, mine: boolean) {
		if (reactionRef.current) return false;
		reactionRef.current = true;
		setReactionPending(emoji);
		setError(null);
		haptic('selection');
		try {
			const failure = await (mine ? onUnreact(message.id, emoji) : onReact(message.id, emoji));
			if (failure !== null) setError(failure);
			return failure === null;
		} finally {
			reactionRef.current = false;
			setReactionPending(null);
		}
	}

	return {
		editing,
		draft,
		hasDraft,
		pending,
		pendingRef,
		reactionPending,
		error,
		deleteOpen,
		setDeleteOpen,
		reactOpen,
		setReactOpen,
		changeDraft,
		startEdit,
		cancelEdit,
		saveEdit,
		remove,
		openDelete,
		toggleReaction,
	};
}
