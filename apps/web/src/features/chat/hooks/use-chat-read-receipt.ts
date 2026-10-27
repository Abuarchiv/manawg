import { notifyChatReadConfirmed } from '@/components/wg/use-wg-counts';
import { apiFetch } from '@/core/infra/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageDto } from '../chat-types';

interface ChatReadReceiptOptions {
	shareCode: string;
	memberId: string;
	messages: readonly ChatMessageDto[];
}

/**
 * Marks the newest message as read once the sentinel below the list is fully visible, and keeps
 * the unread badge in the navigation in step with the confirmed receipt.
 */
export function useChatReadReceipt({ shareCode, memberId, messages }: ChatReadReceiptOptions) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const [readError, setReadError] = useState(false);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const readSentinelRef = useRef<HTMLDivElement | null>(null);
	const lastReadSentIdRef = useRef<string | null>(null);

	const sendRead = useCallback(
		async (messageId: string | null) => {
			const res = await apiFetch(`/api/wg/${encodedShareCode}/chat/read`, {
				method: 'POST',
				memberId,
				body: JSON.stringify({ lastReadMessageId: messageId }),
			});
			// An older response must not overwrite a newer receipt's state.
			if (lastReadSentIdRef.current !== messageId) return;
			setReadError(!res.ok);
			if (!res.ok) lastReadSentIdRef.current = null;
			else notifyChatReadConfirmed(shareCode);
		},
		[encodedShareCode, memberId, shareCode],
	);

	const markLatestRead = useCallback(() => {
		const latest = messages[messages.length - 1];
		if (!latest) return;
		if (lastReadSentIdRef.current === latest.id) return;
		lastReadSentIdRef.current = latest.id;
		void sendRead(latest.id);
	}, [messages, sendRead]);

	useEffect(() => {
		const root = scrollRef.current;
		const sentinel = readSentinelRef.current;
		if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) markLatestRead();
			},
			{ root, threshold: 1 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [markLatestRead]);

	return { readError, scrollRef, readSentinelRef, markLatestRead };
}
