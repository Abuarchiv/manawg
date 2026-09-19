import { expect, test } from '@playwright/test';
import {
	createQueuedExpenseUpdate,
	getOfflineActionRequest,
} from '../src/core/offline/offline-queue';

test('offline expense edits replay as a PATCH for the original expense', () => {
	const action = createQueuedExpenseUpdate({
		expenseId: 'expense-1',
		expectedUpdatedAt: '2026-09-19T10:00:00.000Z',
		shareCode: 'MTE8PZAT',
		memberId: 'member-1',
		description: 'Wocheneinkauf',
		amountCents: 1250,
		paidByMemberId: 'member-1',
		splits: [{ debtorMemberId: 'member-1', amountCents: 1250 }],
		imageUrl: null,
		now: Date.parse('2026-09-19T11:00:00.000Z'),
	});

	const request = getOfflineActionRequest(action);
	expect(action.type).toBe('expense.update');
	expect(request.method).toBe('PATCH');
	expect(request.path).toBe('/api/wg/MTE8PZAT/expenses/expense-1');
	expect(request.body).toMatchObject({
		expectedUpdatedAt: '2026-09-19T10:00:00.000Z',
		description: 'Wocheneinkauf',
	});
});
