// Deleting an expense rechecks the caller's right under the payment lock and refuses while a
// PayPal capture for the WG is in flight.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const PAYER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

let locked = false;
let callerIsDebtor = true;
let removeDebtorAtLock = true;
let capturing = false;
let deleted = 0;
let lockedReads = 0;
let captureChecks = 0;
const expenseRow = { paidByMemberId: PAYER_ID, description: 'Einkauf', amountCents: 1200 };
const expenses = { name: 'expenses' };
const expenseSplits = { name: 'expenseSplits' };

const makeSelect = (insideTransaction: boolean) => {
	let table: unknown;
	const query = {
		from(nextTable: unknown) {
			table = nextTable;
			return query;
		},
		where() {
			if (insideTransaction) {
				if (!locked) throw new Error('transaction read escaped payment lock');
				lockedReads += 1;
			}
			return query;
		},
		limit: async () => {
			if (table === expenses) return [expenseRow];
			if (table === expenseSplits) {
				return callerIsDebtor ? [{ debtorMemberId: CALLER_ID }] : [];
			}
			return [];
		},
	};
	return query;
};

const tx = {
	select: () => makeSelect(true),
	delete: () => ({
		where() {
			return {
				returning: async () => {
					deleted += 1;
					return [{ id: EXPENSE_ID }];
				},
			};
		},
	}),
};
const withPaymentLock = async (
	_wgId: string,
	operation: (value: typeof tx) => Promise<unknown>,
) => {
	locked = true;
	if (removeDebtorAtLock) callerIsDebtor = false;
	try {
		return await operation(tx);
	} finally {
		locked = false;
	}
};

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/db', {
	db: { select: () => makeSelect(false) },
	expenseSplits,
	expenses,
	wgMembers: {},
});
await mockModuleWithReal('@/core/db/private-image-deletions', {
	assertPrivateImageCanBeAttached: async () => undefined,
	revokePrivateImageIfUnreferenced: async () => undefined,
});
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/core/validators/image-url', {
	imageUrlSchema: z.string().nullable().optional(),
	isAllowedImageUrlForWg: () => true,
});
await mockModuleWithReal('@/features/expenses/expense-payments', {
	withExpensePaymentLock: withPaymentLock,
	hasCapturingExpensePayment: async () => {
		captureChecks += 1;
		return capturing;
	},
});
await mockModuleWithReal('@/features/expenses/split-math', {
	settledAtForOwnShare: () => null,
	splitValidationErrorCode: () => 'splits_invalid',
	validateSplits: () => ({ ok: true }),
});

const route = await import('../src/app/api/wg/[code]/expenses/[id]/route');
// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'MTE8PZAT', id: EXPENSE_ID } as never;

test('expense DELETE rechecks authorization and blocks an active capture under the payment lock', async () => {
	const response = await route.DELETE(new NextRequest('http://localhost'), handlerCtx);

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_owner' });
	assert.equal(lockedReads, 2);
	assert.equal(deleted, 0);

	removeDebtorAtLock = false;
	callerIsDebtor = true;
	capturing = true;
	const captureResponse = await route.DELETE(new NextRequest('http://localhost'), handlerCtx);
	assert.equal(captureResponse.status, 409);
	assert.deepEqual(await captureResponse.json(), { error: 'paypal_payment_pending' });
	assert.equal(captureChecks, 1);
	assert.equal(deleted, 0);
});
