import { beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
const selectChain = vi.fn(() => ({
	from: vi.fn(() => ({
		where: vi.fn(() => ({
			orderBy: vi.fn(() => ({ limit: limitMock })),
			limit: limitMock,
		})),
	})),
}));

vi.mock('@/lib/db', () => ({
	db: { select: selectChain },
	wgChatMentions: { messageId: 'col' },
	wgChatMessages: { id: 'col', wgId: 'col', createdAt: 'col', deletedAt: 'col' },
	wgChatReactions: { messageId: 'col', memberId: 'col', emoji: 'col' },
	wgs: { id: 'col', name: 'col', shareCode: 'col' },
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	desc: (...args: unknown[]) => ({ desc: args }),
	eq: (...args: unknown[]) => ({ eq: args }),
	inArray: (...args: unknown[]) => ({ inArray: args }),
	isNull: (...args: unknown[]) => ({ isNull: args }),
}));

vi.mock('next/navigation', () => ({
	notFound: vi.fn(() => {
		throw new Error('NEXT_NOT_FOUND');
	}),
}));

vi.mock('@/components/wg/chat/ChatView', () => ({
	ChatView: () => null,
}));

vi.mock('@manawg/shared/lib/share-code', () => ({
	isValidShareCode: (value: string) => /^[A-Z0-9]{8}$/.test(value),
	normalizeShareCode: (value: string) => value.toUpperCase(),
}));

describe('ChatPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('triggers notFound for malformed share code', async () => {
		const { default: ChatPage } = await import('./page');
		await expect(ChatPage({ params: Promise.resolve({ code: 'bad' }) })).rejects.toThrow(
			'NEXT_NOT_FOUND',
		);
	});

	it('triggers notFound when WG is missing', async () => {
		limitMock.mockResolvedValueOnce([]);
		const { default: ChatPage } = await import('./page');
		await expect(ChatPage({ params: Promise.resolve({ code: 'MTE8PZAT' }) })).rejects.toThrow(
			'NEXT_NOT_FOUND',
		);
	});

	it('RED BUG-140 + chat-leak fix: SSR never loads chat data — share code alone reveals no messages', async () => {
		// The RSC must not read messages/reactions/mentions at all: it has no
		// member identity, so anything loaded here would leak chat history to
		// anyone holding the share code. ChatView bootstraps via the gated API.
		limitMock
			.mockResolvedValueOnce([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }])
			.mockResolvedValue([]);
		selectChain.mockImplementation(() => {
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({ limit: limitMock })),
						limit: limitMock,
					})),
					limit: limitMock,
				})),
			};
		});

		const { default: ChatPage } = await import('./page');
		await ChatPage({ params: Promise.resolve({ code: 'MTE8PZAT' }) });

		expect(selectChain).toHaveBeenCalledTimes(1);
	});
});
