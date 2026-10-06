import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { haptic } from '@/shared/lib/haptics';
import { useEffect, useRef, useState } from 'react';
import type { BubbleMessage } from '../chat-types';

interface BubbleActionsOptions {
	message: BubbleMessage;
	draftKey: string;
	onReact: (messageId: string, emoji: string) => Promise<boolean>;
	onUnreact: (messageId: string, emoji: string) => Promise<boolean>;
	onEdit: (messageId: string, next: string) => Promise<boolean>;
	onDelete: (messageId: string) => Promise<boolean>;
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
			if (await onEdit(message.id, text)) {
				setEditing(false);
				setHasDraft(false);
				removeDraft(draftKey);
			} else setError('Änderung nicht gespeichert. Dein Text ist noch da.');
		});
	}

	async function remove() {
		await runExclusive(async () => {
			if (await onDelete(message.id)) {
				setDeleteOpen(false);
				removeDraft(draftKey);
			} else setError('Nachricht konnte nicht gelöscht werden.');
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
			const ok = await (mine ? onUnreact(message.id, emoji) : onReact(message.id, emoji));
			if (!ok) setError('Reaktion konnte nicht gespeichert werden.');
			return ok;
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
