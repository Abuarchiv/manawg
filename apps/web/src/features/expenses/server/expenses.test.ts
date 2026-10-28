import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const chatMessages: Array<{ kind: string; payload: Record<string, unknown> }> = [];

mock.module('server-only', { namedExports: {} });
mock.module('@/core/db', {
	namedExports: { db: {}, expenseSplits: {}, expenses: {}, wgMembers: {} },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort: class extends Error {},
		withTransaction: async () => undefined,
	},
});
mock.module('@/core/activity-feed', {
	namedExports: {
		postChatSystemMessage: async (input: { kind: string; payload: Record<string, unknown> }) => {
			chatMessages.push(input);
		},
	},
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});
const { recordExpenseCreatedSideEffects } = await import('@/features/expenses/server/expenses');

test('the expense chat notice carries cents and currency next to the German text', async () => {
	await recordExpenseCreatedSideEffects({
		wg: { id: 'wg' } as never,
		actor: { memberId: 'm1', name: 'Anna' },
		expense: {
			id: 'e1',
			amountCents: 2480,
			currency: 'EUR',
			description: 'Reis',
			paidByMemberId: 'm1',
		} as never,
	});
	assert.equal(chatMessages.length, 1);
	assert.deepEqual(chatMessages[0]?.payload, {
		expenseId: 'e1',
		actorMemberId: 'm1',
		actorName: 'Anna',
		description: 'Reis',
		amountCents: 2480,
		currency: 'EUR',
		amount: chatMessages[0]?.payload.amount,
	});
	assert.match(String(chatMessages[0]?.payload.amount), /^24,80\s€$/);
});
