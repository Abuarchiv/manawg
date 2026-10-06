// PayPal capture and leaving members: the capture rechecks active membership under the payment lock,
// so a member deactivated after the request guard cannot settle a payment.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { mockModuleWithReal } from './support/module-mocks';
import { jsonResponse } from './support/values';

const wgId = '550e8400-e29b-41d4-a716-446655440000';
const callerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const recipientId = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const expensePayments = {
	id: 'payment.id',
	wgId: 'payment.wgId',
	providerOrderId: 'payment.providerOrderId',
	fromMemberId: 'payment.fromMemberId',
	status: 'payment.status',
	expiresAt: 'payment.expiresAt',
};
const wgMembers = {
	id: 'member.id',
	name: 'member.name',
	color: 'member.color',
	wgId: 'member.wgId',
};
const payment = {
	id: 'payment-1',
	wgId,
	providerOrderId: 'paypal-order-1',
	payeeMerchantId: 'merchant-1',
	fromMemberId: callerId,
	toMemberId: recipientId,
	amountCents: 1200,
	currency: 'EUR',
	status: 'created',
	expiresAt: new Date(Date.now() + 60_000),
};
let membershipActive = true;
let requireMemberCalls = 0;
let lockHeld = false;
let membershipChecks = 0;
let membershipChecksUnderLock = 0;
let captureCalls = 0;
let orderReads = 0;
const statusWrites: string[] = [];

function selectQuery(): unknown {
	let selectedTable: unknown;
	const rows = () => {
		if (selectedTable === expensePayments) return [{ ...payment }];
		if (selectedTable === wgMembers) return [{ id: callerId, name: 'Mina', color: 'blue' }];
		return [];
	};
	const result = Promise.resolve().then(rows);
	const chain: unknown = new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'then') return result.then.bind(result);
				if (key === 'limit') return async () => rows();
				if (key === 'from') {
					return (table: unknown) => {
						selectedTable = table;
						return chain;
					};
				}
				return () => chain;
			},
		},
	);
	return chain;
}

const tx = {
	select: selectQuery,
	update: () => ({
		set: (values: Record<string, unknown>) => {
			if (typeof values.status === 'string') {
				statusWrites.push(values.status);
				Object.assign(payment, values);
			}
			return {
				where: () => ({ returning: async () => [{ ...payment }] }),
			};
		},
	}),
};
const db = {
	select: () => {
		// Simulate deactivation after requireWgMember succeeds but before the payment lock.
		if (requireMemberCalls > 0) membershipActive = false;
		return selectQuery();
	},
};

await mockModuleWithReal('drizzle-orm', {
	and: (...conditions: unknown[]) => conditions,
	eq: (column: unknown, value: unknown) => ({ column, value }),
	gt: (column: unknown, value: unknown) => ({ column, value }),
});
await mockModuleWithReal('@/core/audit', { recordAuditEvent: async () => undefined });
await mockModuleWithReal('@/core/db', { db, expensePayments, wgMembers });
await mockModuleWithReal('@/core/db/account-deletion', {
	lockActiveAccountMember: async () => {
		membershipChecks += 1;
		if (lockHeld) membershipChecksUnderLock += 1;
		return membershipActive ? { memberId: callerId } : null;
	},
});
await mockModuleWithReal('@/core/http/api-errors', {
	badRequest: (code: string) => jsonResponse({ error: code }, 400),
	conflict: (code: string) => jsonResponse({ error: code }, 409),
	forbidden: (code: string) => jsonResponse({ error: code }, 403),
	serverError: (code: string) => jsonResponse({ error: code }, 500),
	tooMany: () => jsonResponse({ error: 'too_many' }, 429),
});
await mockModuleWithReal('@/core/guards/require-wg-member', {
	requireWgMember: async () => {
		requireMemberCalls += 1;
		membershipActive = true;
		return {
			ok: true,
			wg: { id: wgId },
			member: { memberId: callerId, name: 'Mina' },
			authUserId: callerId,
		};
	},
});
await mockModuleWithReal('@/core/guards/with-wg-route', {
	withWgRoute: (_name: string, handler: unknown) => handler,
});
await mockModuleWithReal('@/core/infra/observability', { logApiError: () => undefined });
await mockModuleWithReal('@/core/infra/paypal', {
	capturePayPalOrder: async () => {
		captureCalls += 1;
		return {
			status: 'COMPLETED',
			purchase_units: [
				{
					payments: {
						captures: [{ status: 'COMPLETED', amount: { value: '12.00', currency_code: 'EUR' } }],
					},
				},
			],
		};
	},
	getPayPalOrder: async () => {
		orderReads += 1;
		return { status: 'COMPLETED' };
	},
	isPayPalConfigured: () => true,
});
await mockModuleWithReal('@/core/rate-limit', {
	checkRateLimit: async () => ({ success: true }),
	wgWriteLimiter: {},
});
await mockModuleWithReal('@/features/expenses/debt-reduction', {
	computeNetBalances: () => [],
	simplifyDebts: () => [
		{ fromId: callerId, toId: recipientId, currency: 'EUR', cents: payment.amountCents },
	],
});
await mockModuleWithReal('@/features/expenses/server/expense-payments', {
	withExpensePaymentLock: async (
		_id: string,
		operation: (value: typeof tx) => Promise<unknown>,
	) => {
		lockHeld = true;
		try {
			return await operation(tx);
		} finally {
			lockHeld = false;
		}
	},
	loadCompletedExpensePayments: async () => [],
});
await mockModuleWithReal('@/features/expenses/server/open-expenses', {
	loadOpenExpenses: async () => [],
});
await mockModuleWithReal('@/features/expenses/paypal-settlement', {
	isPayPalCaptureDebtChanged: () => false,
});

// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'test' } as never;
const route = await import('../src/app/api/wg/[code]/paypal/capture/route');

test('PayPal capture rechecks active membership under the payment lock', async () => {
	const response = await route.POST(
		new NextRequest('http://localhost/api/wg/test/paypal/capture', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ orderId: payment.providerOrderId }),
		}),
		handlerCtx,
	);

	assert.deepEqual(
		{
			responseStatus: response.status,
			responseBody: await response.json(),
			captureCalls,
			orderReads,
			statusWrites,
		},
		{
			responseStatus: 403,
			responseBody: { error: 'member_deactivated' },
			captureCalls: 0,
			orderReads: 0,
			statusWrites: [],
		},
	);
	assert.equal(requireMemberCalls, 1);
	assert.equal(membershipChecks, 1);
	assert.equal(membershipChecksUnderLock, 1);
});
