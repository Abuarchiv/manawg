// commitImport skips rows the user excluded without validating their member mapping, so a mapping
// to a departed member cannot block the rest of an import.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockModuleWithReal } from './support/module-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const expenseImports = { name: 'expenseImports' };
let memberLookups = 0;
const db = {
	select: () => {
		memberLookups += 1;
		return {
			from: () => ({ where: async () => [] }),
		};
	},
};
const tx = {
	insert: (table: unknown) => ({
		values: () => ({
			returning: async () => (table === expenseImports ? [{ id: 'import-1' }] : []),
		}),
	}),
	update: () => ({ set: () => ({ where: async () => undefined }) }),
};

await mockModuleWithReal('@/core/activity-feed', { postSystemNotice: async () => undefined });
await mockModuleWithReal('@/core/audit', { recordAuditEvent: async () => undefined });
await mockModuleWithReal('@/core/db', {
	db,
	expenseImports,
	expenseSplits: {},
	expenses: {},
	wgMembers: {},
});
await mockModuleWithReal('@/core/notifications/notification-dispatch', {
	dispatchNotificationSafely: async () => ({ warning: null }),
});
await mockModuleWithReal('@/core/utils/money', { formatEuroCents: () => '0,00 €' });
await mockModuleWithReal('@/features/expenses/server/expense-payments', {
	hasCapturingExpensePayment: async () => false,
	withExpensePaymentLock: async (
		_wgId: string,
		operation: (value: typeof tx) => Promise<unknown>,
	) => operation(tx),
});
await mockModuleWithReal('@/features/expenses/split-math', { settledAtForOwnShare: () => null });

const { commitImport } = await import('../src/features/expenses/server/import-commit');

test('import helper does not validate member mappings for skipped rows', async () => {
	const foreignMemberId = '24ba761e-a429-45c3-a311-18e9a44b9be8';
	const outcome = (await commitImport(
		{ scope: 'import', key: null },
		async () =>
			({
				input: {
					wg: { id: WG_ID, name: 'WG', shareCode: 'MTE8PZAT' },
					source: 'splitwise_csv',
					importedByMemberId: CALLER_ID,
					importedByName: 'Mina',
					mayRecordForOthers: false,
					expenses: [
						{
							parsed: {
								date: '2026-09-01T00:00:00.000Z',
								description: 'Alte Ausgabe',
								amountCents: 500,
								currency: 'EUR',
								paidByName: 'Ausgetretene Person',
								splits: [{ memberName: 'Ausgetretene Person', amountCents: 500 }],
								warnings: [],
							},
							skip: true,
						},
					],
					mapping: { 'Ausgetretene Person': foreignMemberId },
					skipDuplicates: false,
					rawPayloadHash: 'hash',
				},
			}) as never,
	)) as { result: { skipped: number } };

	assert.equal(outcome.result.skipped, 1);
	assert.equal(memberLookups, 0);
});
