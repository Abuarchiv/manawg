import { describe, expect, it, vi } from 'vitest';

const insertReturning = vi.fn();

vi.mock('@/core/db', () => ({
	db: {
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: () => insertReturning(),
			})),
		})),
	},
	wgChatMessages: { __table: 'wg_chat_messages' },
}));

vi.mock('server-only', () => ({}));

import { appendSystemMessage } from '@/features/chat/chat-server';

describe('appendSystemMessage', () => {
	it('inserts a system row and returns it', async () => {
		const row = {
			id: 'sys-1',
			wgId: 'wg-1',
			kind: 'system',
			systemKind: 'member.joined',
		};
		insertReturning.mockResolvedValue([row]);
		const result = await appendSystemMessage({
			wgId: 'wg-1',
			kind: 'member.joined',
			payload: { name: 'Lena' },
		});
		expect(result).toBe(row);
	});

	it('throws when insert returns nothing', async () => {
		insertReturning.mockResolvedValue([]);
		await expect(
			appendSystemMessage({ wgId: 'wg-1', kind: 'member.joined', payload: {} }),
		).rejects.toThrow('chat_system_insert_failed');
	});
});
