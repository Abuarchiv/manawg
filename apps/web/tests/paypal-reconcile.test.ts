import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	parsePayPalAmountCents,
	terminalPayPalCaptureOutcome,
} from '../src/features/expenses/paypal-settlement.ts';

// The module under test imports its siblings with relative specifiers, so those are mocked by URL.
const sibling = (name: string) => new URL(`../src/features/expenses/${name}`, import.meta.url).href;

const harness = {
	writes: 0,
	payment: {
		id: 'payment-1',
		wgId: 'wg-1',
		providerOrderId: 'expected-order',
		payeeMerchantId: 'merchant-1',
		amountCents: 1234,
		currency: 'EUR',
	},
	order: {} as unknown,
};

const query = {
	from: () => query,
	where: () => query,
	limit: async () => [harness.payment],
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			harness.writes += 1;
		},
	},
});
mock.module('@/core/db', {
	namedExports: { db: { select: () => query }, expensePayments: {}, wgMembers: {} },
});
mock.module('@/core/infra/observability', { namedExports: { logApiError: () => {} } });
mock.module('@/core/infra/paypal', {
	namedExports: {
		getPayPalOrder: async (orderId: string, merchantId: string) => {
			assert.equal(orderId, harness.payment.providerOrderId);
			assert.equal(merchantId, harness.payment.payeeMerchantId);
			return harness.order;
		},
	},
});
mock.module('@/core/utils/money', { namedExports: { formatEuroCents: () => '12,34 €' } });
mock.module('drizzle-orm', { namedExports: { and: () => {}, eq: () => {}, lt: () => {} } });
mock.module(sibling('server/expense-payments.ts'), {
	namedExports: {
		withExpensePaymentLock: async (_wgId: string, action: (tx: unknown) => Promise<unknown>) => {
			harness.writes += 1;
			return action({
				update: () => ({
					set: () => ({
						where: () => ({ returning: async () => [{ id: harness.payment.id }] }),
					}),
				}),
			});
		},
	},
});
mock.module(sibling('paypal-settlement.ts'), {
	namedExports: { parsePayPalAmountCents, terminalPayPalCaptureOutcome },
});

const { reconcileStaleCapturingPayments } = await import(
	'../src/features/expenses/server/paypal-reconcile.ts'
);

test('reconciliation leaves a mismatched or missing provider order identity unresolved', async () => {
	for (const status of ['COMPLETED', 'VOIDED']) {
		for (const id of ['different-order', undefined]) {
			harness.writes = 0;
			harness.order = {
				id,
				status,
				purchase_units: [
					{
						payee: { merchant_id: harness.payment.payeeMerchantId },
						payments: {
							captures:
								status === 'VOIDED'
									? []
									: [{ status: 'COMPLETED', amount: { value: '12.34', currency_code: 'EUR' } }],
						},
					},
				],
			};
			assert.deepEqual(await reconcileStaleCapturingPayments(), {
				completed: 0,
				failed: 0,
				pending: 1,
			});
			assert.equal(harness.writes, 0);
		}
	}
});
