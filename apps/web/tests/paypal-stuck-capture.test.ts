import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as schema from '../src/core/db/schema.ts';

// A stuck `capturing` PayPal row blocks every money write of the WG. The check that
// finds it schedules a reconcile for that WG instead of waiting for the nightly run.

const reconciled: Array<string | undefined> = [];
const tasks: Array<() => Promise<unknown>> = [];

mock.module('@/core/db', { namedExports: { ...schema, db: {} } });
mock.module('@/core/db/transaction', {
	namedExports: { lockExpensePayments: async () => {}, withTransaction: async () => {} },
});
mock.module('@/core/infra/after-response', {
	namedExports: { afterResponse: (task: () => Promise<unknown>) => tasks.push(task) },
});
mock.module('@/core/infra/paypal', { namedExports: { isPayPalConfigured: () => true } });
mock.module(new URL('../src/features/expenses/server/paypal-reconcile.ts', import.meta.url).href, {
	namedExports: {
		reconcileStaleCapturingPayments: async (_now: Date, wgId?: string) => {
			reconciled.push(wgId);
		},
	},
});

const { hasCapturingExpensePayment } = await import(
	'../src/features/expenses/server/expense-payments.ts'
);

function txWith(createdAt: Date) {
	const query = {
		from: () => query,
		where: () => query,
		limit: async () => [{ id: 'payment-1', createdAt }],
	};
	return { select: () => query } as never;
}

test('a capture stuck for over 15 minutes schedules a reconcile for its WG', async () => {
	assert.equal(await hasCapturingExpensePayment(txWith(new Date()), 'wg-1'), true);
	assert.equal(tasks.length, 0);

	const stuck = new Date(Date.now() - 20 * 60 * 1000);
	assert.equal(await hasCapturingExpensePayment(txWith(stuck), 'wg-1'), true);
	assert.equal(tasks.length, 1);
	await tasks[0]?.();
	assert.deepEqual(reconciled, ['wg-1']);
});
