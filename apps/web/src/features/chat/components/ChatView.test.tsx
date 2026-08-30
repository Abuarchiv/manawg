import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView';

const apiMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const chatChannelMock = vi.hoisted(() => ({
	handlers: null as null | { onMessageCreated: () => void },
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		identity: { memberId: 'member-1', name: 'Ada' },
		members: [{ id: 'member-1', name: 'Ada', color: '#123456' }],
	}),
}));

vi.mock('./ChatComposer', () => ({
	ChatComposer: ({
		onSend,
	}: {
		onSend: (input: {
			body: string;
			mentionMemberIds: string[];
			replyToMessageId: string | null;
		}) => Promise<boolean>;
	}) => (
		<button
			type="button"
			data-testid="composer"
			onClick={() =>
				void onSend({
					body: 'Neue Nachricht',
					mentionMemberIds: [],
					replyToMessageId: null,
				})
			}
		>
			Senden
		</button>
	),
}));

vi.mock('./MessageList', () => ({
	MessageList: ({
		messages,
		onDelete,
		onLoadOlder,
		onReact,
		reactionsByMessage,
	}: {
		messages: Array<{ id: string; body: string | null; deletedAt: string | null }>;
		onDelete: (messageId: string) => Promise<void>;
		onLoadOlder: () => void;
		onReact: (messageId: string, emoji: string) => Promise<void>;
		reactionsByMessage: Map<string, Array<{ emoji: string }>>;
	}) => (
		<div>
			<button type="button" onClick={onLoadOlder}>
				Ältere laden
			</button>
			{messages.map((message) => (
				<div key={message.id}>
					<span>{message.deletedAt ? 'Diese Nachricht wurde gelöscht.' : message.body}</span>
					<span>
						{(reactionsByMessage.get(message.id) ?? []).map((reaction) => reaction.emoji).join(' ')}
					</span>
					<button type="button" onClick={() => void onReact(message.id, '👍')}>
						Reagieren
					</button>
					<button type="button" onClick={() => void onDelete(message.id)}>
						Löschen
					</button>
				</div>
			))}
		</div>
	),
}));

vi.mock('./TypingIndicator', () => ({
	TypingIndicator: () => null,
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiMock.apiFetch(...args),
}));

vi.mock('@/shared/lib/haptics', () => ({
	haptic: vi.fn(),
}));

vi.mock('../chat-channel', () => ({
	useChatChannel: (_wgId: string, handlers: { onMessageCreated: () => void }) => {
		chatChannelMock.handlers = handlers;
		return { mode: 'off' };
	},
}));

describe('ChatView', () => {
	beforeEach(() => {
		apiMock.apiFetch.mockReset();
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: {} });
		chatChannelMock.handlers = null;
	});

	it('RED BUG-145: keeps a message visible when delete returns an API error', async () => {
		apiMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/chat/read')) return Promise.resolve({ ok: true, data: {} });
			if (init?.method === 'DELETE') {
				return Promise.resolve({ ok: false, status: 403, error: 'forbidden' });
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={[
					{
						id: 'message-1',
						wgId: 'wg-1',
						body: 'Bitte nicht löschen',
						imageUrl: null,
						kind: 'text',
						replyToMessageId: null,
						senderMemberId: 'member-1',
						createdAt: '2026-05-25T10:00:00.000Z',
						editedAt: null,
						deletedAt: null,
					},
				]}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

		await waitFor(() => {
			expect(apiMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/MTE8PZAT/chat/messages/message-1',
				expect.objectContaining({ method: 'DELETE' }),
			);
		});
		expect(screen.getByText('Bitte nicht löschen')).toBeVisible();
		expect(screen.queryByText('Diese Nachricht wurde gelöscht.')).not.toBeInTheDocument();
	});

	it('shows a retry instead of an empty chat when the initial load fails', async () => {
		apiMock.apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: 'offline' });

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={[]}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		expect(await screen.findByText('Chat konnte nicht geladen werden.')).toBeVisible();
		expect(
			screen.queryByText('Noch keine Nachrichten. Schreibe die erste!'),
		).not.toBeInTheDocument();

		apiMock.apiFetch.mockResolvedValueOnce({ ok: true, data: { messages: [], reactions: [] } });
		fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
		expect(await screen.findByText('Noch keine Nachrichten. Schreibe die erste!')).toBeVisible();
	});

	it('RED BUG-554: appends a sent message before the refresh round-trip finishes', async () => {
		type ChatRefreshResponse = {
			ok: true;
			data: { messages: Array<Record<string, unknown>>; reactions: [] };
		};
		const refreshResolver: { current?: (value: ChatRefreshResponse) => void } = {};

		apiMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/chat/read')) return Promise.resolve({ ok: true, data: {} });
			if (init?.method === 'POST' && path.endsWith('/chat/messages')) {
				return Promise.resolve({
					ok: true,
					data: {
						message: {
							id: 'message-new',
							wgId: 'wg-1',
							body: 'Neue Nachricht',
							imageUrl: null,
							kind: 'text',
							replyToMessageId: null,
							senderMemberId: 'member-1',
							createdAt: '2026-05-29T10:01:00.000Z',
							editedAt: null,
							deletedAt: null,
						},
					},
				});
			}
			if (path.endsWith('/chat/messages?limit=50')) {
				return new Promise((resolve) => {
					refreshResolver.current = resolve as (value: ChatRefreshResponse) => void;
				});
			}
			return Promise.resolve({ ok: true, data: { messages: [], reactions: [] } });
		});

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={[
					{
						id: 'message-1',
						wgId: 'wg-1',
						body: 'Vorherige Nachricht',
						imageUrl: null,
						kind: 'text',
						replyToMessageId: null,
						senderMemberId: 'member-2',
						createdAt: '2026-05-29T10:00:00.000Z',
						editedAt: null,
						deletedAt: null,
					},
				]}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

		expect(await screen.findByText('Neue Nachricht')).toBeVisible();

		const finishRefresh = refreshResolver.current;
		if (!finishRefresh) throw new Error('Expected chat refresh request to be pending');
		finishRefresh({
			ok: true,
			data: {
				messages: [
					{
						id: 'message-new',
						wgId: 'wg-1',
						body: 'Neue Nachricht',
						imageUrl: null,
						kind: 'text',
						replyToMessageId: null,
						senderMemberId: 'member-1',
						createdAt: '2026-05-29T10:01:00.000Z',
						editedAt: null,
						deletedAt: null,
					},
				],
				reactions: [],
			},
		});

		await waitFor(() => {
			expect(apiMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/MTE8PZAT/chat/messages?limit=50',
				expect.anything(),
			);
		});
	});

	it('RED BUG-025: sends beforeId when loading older chat messages', async () => {
		apiMock.apiFetch.mockImplementation((path: string) => {
			if (path.endsWith('/chat/read')) return Promise.resolve({ ok: true, data: {} });
			return Promise.resolve({ ok: true, data: { messages: [], reactions: [] } });
		});
		const messages = Array.from({ length: 50 }, (_, index) => ({
			id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
			wgId: 'wg-1',
			body: `Nachricht ${index + 1}`,
			imageUrl: null,
			kind: 'text' as const,
			replyToMessageId: null,
			senderMemberId: 'member-1',
			createdAt: `2026-05-25T10:00:${String(index).padStart(2, '0')}.000Z`,
			editedAt: null,
			deletedAt: null,
		}));

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={messages}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));

		await waitFor(() => {
			expect(apiMock.apiFetch).toHaveBeenCalledWith(
				expect.stringContaining('before=2026-05-25T10%3A00%3A00.000Z'),
				expect.anything(),
			);
		});
		expect(apiMock.apiFetch).toHaveBeenCalledWith(
			expect.stringContaining('beforeId=00000000-0000-0000-0000-000000000001'),
			expect.anything(),
		);
	});

	it('RED BUG-026: keeps previously loaded older messages when a refresh returns the latest page', async () => {
		apiMock.apiFetch.mockImplementation((path: string) => {
			if (path.endsWith('/chat/read')) return Promise.resolve({ ok: true, data: {} });
			if (path.includes('before=')) {
				return Promise.resolve({
					ok: true,
					data: {
						messages: [
							{
								id: 'older-message',
								wgId: 'wg-1',
								body: 'Ältere Nachricht',
								imageUrl: null,
								kind: 'text',
								replyToMessageId: null,
								senderMemberId: 'member-1',
								createdAt: '2026-05-25T09:59:59.000Z',
								editedAt: null,
								deletedAt: null,
							},
						],
						reactions: [],
					},
				});
			}
			return Promise.resolve({
				ok: true,
				data: {
					messages: [
						{
							id: 'latest-message',
							wgId: 'wg-1',
							body: 'Neueste Nachricht',
							imageUrl: null,
							kind: 'text',
							replyToMessageId: null,
							senderMemberId: 'member-1',
							createdAt: '2026-05-25T10:01:00.000Z',
							editedAt: null,
							deletedAt: null,
						},
					],
					reactions: [],
				},
			});
		});
		const messages = Array.from({ length: 50 }, (_, index) => ({
			id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
			wgId: 'wg-1',
			body: `Nachricht ${index + 1}`,
			imageUrl: null,
			kind: 'text' as const,
			replyToMessageId: null,
			senderMemberId: 'member-1',
			createdAt: `2026-05-25T10:00:${String(index).padStart(2, '0')}.000Z`,
			editedAt: null,
			deletedAt: null,
		}));

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={messages}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
		expect(await screen.findByText('Ältere Nachricht')).toBeVisible();

		chatChannelMock.handlers?.onMessageCreated();

		await waitFor(() => {
			expect(screen.getByText('Neueste Nachricht')).toBeVisible();
		});
		expect(screen.getByText('Ältere Nachricht')).toBeVisible();
	});

	it('RED BUG-143: does not mark the latest message read before the user sees it', async () => {
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: {} });

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={[
					{
						id: 'message-visible-later',
						wgId: 'wg-1',
						body: 'Noch nicht gesehen',
						imageUrl: null,
						kind: 'text',
						replyToMessageId: null,
						senderMemberId: 'member-2',
						createdAt: '2026-05-25T10:00:00.000Z',
						editedAt: null,
						deletedAt: null,
					},
				]}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText('Noch nicht gesehen')).toBeVisible();
		});
		expect(apiMock.apiFetch).not.toHaveBeenCalledWith(
			'/api/wg/MTE8PZAT/chat/read',
			expect.objectContaining({
				body: JSON.stringify({ lastReadMessageId: 'message-visible-later' }),
			}),
		);
	});

	it('RED BUG-142: keeps a locally confirmed reaction when a stale refresh omits it', async () => {
		apiMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/chat/read')) return Promise.resolve({ ok: true, data: {} });
			if (init?.method === 'POST' && path.endsWith('/reactions')) {
				return Promise.resolve({ ok: true, data: {} });
			}
			return Promise.resolve({
				ok: true,
				data: {
					messages: [
						{
							id: 'message-1',
							wgId: 'wg-1',
							body: 'Bitte reagieren',
							imageUrl: null,
							kind: 'text',
							replyToMessageId: null,
							senderMemberId: 'member-2',
							createdAt: '2026-05-25T10:00:00.000Z',
							editedAt: null,
							deletedAt: null,
						},
					],
					reactions: [],
				},
			});
		});

		render(
			<ChatView
				wgId="wg-1"
				shareCode="MTE8PZAT"
				initialMessages={[
					{
						id: 'message-1',
						wgId: 'wg-1',
						body: 'Bitte reagieren',
						imageUrl: null,
						kind: 'text',
						replyToMessageId: null,
						senderMemberId: 'member-2',
						createdAt: '2026-05-25T10:00:00.000Z',
						editedAt: null,
						deletedAt: null,
					},
				]}
				initialReactions={[]}
				initialMentions={[]}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Reagieren' }));
		expect(await screen.findByText('👍')).toBeVisible();

		chatChannelMock.handlers?.onMessageCreated();

		await waitFor(() => {
			expect(apiMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/MTE8PZAT/chat/messages?limit=50',
				expect.anything(),
			);
		});
		expect(screen.getByText('👍')).toBeVisible();
	});
});
