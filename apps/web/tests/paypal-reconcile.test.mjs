import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import {
	parsePayPalAmountCents,
	terminalPayPalCaptureOutcome,
} from '../src/features/expenses/paypal-settlement.ts';

test('reconciliation leaves a mismatched or missing provider order identity unresolved', async () => {
	for (const status of ['COMPLETED', 'VOIDED']) {
		for (const id of ['different-order', undefined]) {
			let writes = 0;
			const payment = {
				id: 'payment-1',
				wgId: 'wg-1',
				providerOrderId: 'expected-order',
				payeeMerchantId: 'merchant-1',
				amountCents: 1234,
				currency: 'EUR',
			};
			const query = {
				from: () => query,
				where: () => query,
				limit: async () => [payment],
			};
			const mocks = {
				'@/core/audit': {
					recordAuditEvent: async () => {
						writes += 1;
					},
				},
				'@/core/db': { db: { select: () => query }, expensePayments: {}, wgMembers: {} },
				'@/core/infra/observability': { logApiError: () => {} },
				'@/core/infra/paypal': {
					getPayPalOrder: async (orderId, merchantId) => {
						assert.equal(orderId, payment.providerOrderId);
						assert.equal(merchantId, payment.payeeMerchantId);
						return {
							id,
							status,
							purchase_units: [
								{
									payee: { merchant_id: payment.payeeMerchantId },
									payments: {
										captures:
											status === 'VOIDED'
												? []
												: [
														{
															status: 'COMPLETED',
															amount: { value: '12.34', currency_code: 'EUR' },
														},
													],
									},
								},
							],
						};
					},
				},
				'@/core/utils/money': { formatEuroCents: () => '12,34 €' },
				'drizzle-orm': { and: () => {}, eq: () => {}, lt: () => {} },
				'./expense-payments': {
					withExpensePaymentLock: async (_wgId, action) => {
						writes += 1;
						return action({
							update: () => ({
								set: () => ({ where: () => ({ returning: async () => [{ id: payment.id }] }) }),
							}),
						});
					},
				},
				'./paypal-settlement': { parsePayPalAmountCents, terminalPayPalCaptureOutcome },
			};
			const source = readFileSync(
				new URL('../src/features/expenses/paypal-reconcile.ts', import.meta.url),
				'utf8',
			);
			const compiled = transpileModule(source, {
				compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
			}).outputText;
			const loaded = { exports: {} };
			new Function('require', 'module', 'exports', compiled)(
				(name) => {
					assert.ok(name in mocks, `unexpected import: ${name}`);
					return mocks[name];
				},
				loaded,
				loaded.exports,
			);
			assert.deepEqual(await loaded.exports.reconcileStaleCapturingPayments(), {
				completed: 0,
				failed: 0,
				pending: 1,
			});
			assert.equal(writes, 0);
		}
	}
});
