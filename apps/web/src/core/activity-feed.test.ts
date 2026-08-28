import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertValues = vi.fn();
const insertInto = vi.fn();

vi.mock('@/core/db', () => ({
	db: {
		insert: (table: unknown) => {
			insertInto(table);
			return { values: (row: unknown) => insertValues(row) };
		},
	},
	announcements: { __table: 'announcements' },
	wgChatMessages: { __table: 'wg_chat_messages' },
}));

vi.mock('server-only', () => ({}));

import { postChatSystemMessage, postSystemNotice } from '@/core/activity-feed';

beforeEach(() => {
	insertValues.mockReset().mockResolvedValue(undefined);
	insertInto.mockReset();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('postSystemNotice', () => {
	it('writes the notice into the announcements feed', async () => {
		await postSystemNotice({
			wgId: 'wg-1',
			authorMemberId: 'member-1',
			kind: 'info',
			source: 'expense',
			sourcePath: '/ausgaben',
			content: 'Lena hat eine Ausgabe eingetragen.',
		});

		expect(insertInto).toHaveBeenCalledWith({ __table: 'announcements' });
		expect(insertValues).toHaveBeenCalledWith({
			wgId: 'wg-1',
			authorMemberId: 'member-1',
			kind: 'info',
			source: 'expense',
			sourcePath: '/ausgaben',
			content: 'Lena hat eine Ausgabe eingetragen.',
		});
	});

	// The contract all six call sites rely on: they post the notice AFTER the
	// action already committed, so a failure here must never propagate and undo
	// it. If this ever throws, an expense that was saved would report a 500.
	it('swallows a database failure instead of propagating it', async () => {
		insertValues.mockRejectedValue(new Error('db down'));

		await expect(
			postSystemNotice({
				wgId: 'wg-1',
				authorMemberId: 'member-1',
				kind: 'info',
				source: 'system',
				content: 'x',
			}),
		).resolves.toBeUndefined();
	});
});

describe('postChatSystemMessage', () => {
	it('writes a senderless system row into the chat feed', async () => {
		await postChatSystemMessage({
			wgId: 'wg-1',
			kind: 'expense.created',
			payload: { expenseId: 'exp-1' },
		});

		expect(insertInto).toHaveBeenCalledWith({ __table: 'wg_chat_messages' });
		expect(insertValues).toHaveBeenCalledWith({
			wgId: 'wg-1',
			senderMemberId: null,
			kind: 'system',
			systemKind: 'expense.created',
			systemPayload: { expenseId: 'exp-1' },
		});
	});

	it('swallows a database failure instead of propagating it', async () => {
		insertValues.mockRejectedValue(new Error('db down'));

		await expect(
			postChatSystemMessage({ wgId: 'wg-1', kind: 'expense.created', payload: {} }),
		).resolves.toBeUndefined();
	});
});
