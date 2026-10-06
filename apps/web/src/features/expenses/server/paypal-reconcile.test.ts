import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const payment = {
	id: 'payment-1',
	wgId: 'wg-1',
	providerOrderId: 'expected-order',
	payeeMerchantId: 'merchant-1',
	amountCents: 1234,
	currency: 'EUR',
};

/** The provider order PayPal reports for the stale payment in the current case. */
const provider = {
	status: 'COMPLETED',
	id: undefined as string | undefined,
	writes: 0,
};

const query = {
	from: () => query,
	where: () => query,
	limit: async () => [payment],
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			provider.writes += 1;
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
			assert.equal(orderId, payment.providerOrderId);
			assert.equal(merchantId, payment.payeeMerchantId);
			return {
				id: provider.id,
				status: provider.status,
				purchase_units: [
					{
						payee: { merchant_id: payment.payeeMerchantId },
						payments: {
							captures:
								provider.status === 'VOIDED'
									? []
									: [{ status: 'COMPLETED', amount: { value: '12.34', currency_code: 'EUR' } }],
						},
					},
				],
			};
		},
	},
});
mock.module('drizzle-orm', { namedExports: { and: () => {}, eq: () => {}, lt: () => {} } });
mock.module('./expense-payments', {
	namedExports: {
		withExpensePaymentLock: async (_wgId: string, action: (tx: unknown) => unknown) => {
			provider.writes += 1;
			return action({
				update: () => ({
					set: () => ({ where: () => ({ returning: async () => [{ id: payment.id }] }) }),
				}),
			});
		},
	},
});

const { reconcileStaleCapturingPayments } = await import('./paypal-reconcile');

test('reconciliation leaves a mismatched or missing provider order identity unresolved', async () => {
	for (const status of ['COMPLETED', 'VOIDED']) {
		for (const id of ['different-order', undefined]) {
			provider.status = status;
			provider.id = id;
			provider.writes = 0;
			assert.deepEqual(await reconcileStaleCapturingPayments(), {
				completed: 0,
				failed: 0,
				pending: 1,
			});
			assert.equal(provider.writes, 0);
		}
	}
});
