// Settling a split authenticates before any lookup and only finds expenses of the caller's WG, so
// the route never confirms that a foreign expense exists.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { type Predicate, columnOperators, matches } from './support/column-predicates';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';
import { responseError } from './support/values';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const PAYER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

const expenses = {
	id: { table: 'expenses', name: 'id' },
	wgId: { table: 'expenses', name: 'wgId' },
	description: { table: 'expenses', name: 'description' },
	paidByMemberId: { table: 'expenses', name: 'paidByMemberId' },
};
const foreignExpense = {
	id: EXPENSE_ID,
	wgId: '3c149bad-33c6-4a32-bb6d-196a65d1e741',
	description: 'Private Ausgabe',
	paidByMemberId: PAYER_ID,
};
let authorized = false;
let lookups = 0;
const db = {
	select: () => {
		lookups += 1;
		let condition: Predicate;
		return {
			from: () => ({
				where: (nextCondition: Predicate) => {
					condition = nextCondition;
					return {
						limit: async () => (matches(foreignExpense, condition) ? [foreignExpense] : []),
					};
				},
			}),
		};
	},
};

await mockWgRouteInfrastructure({
	requireWgMember: async () =>
		authorized
			? { ok: true, wg: { id: WG_ID }, member: { memberId: CALLER_ID } }
			: { ok: false, response: responseError('unauthorized', 401) },
});
await mockModuleWithReal('@/core/db', { db, expenses, expenseSplits: {} });
await mockModuleWithReal('@/features/expenses/expense-payments', {
	hasCapturingExpensePayment: async () => false,
	withExpensePaymentLock: async () => undefined,
});
await mockModuleWithReal('drizzle-orm', columnOperators);

const route = await import('../src/app/api/wg/[code]/expenses/[id]/splits/[splitId]/settle/route');
// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = (id: string) => ({ code: 'MTE8PZAT', id, splitId: CALLER_ID }) as never;

test('split settle authenticates before lookup and scopes expenses to the WG', async () => {
	const request = () =>
		new NextRequest('http://localhost', {
			method: 'POST',
			body: JSON.stringify({ settled: true }),
		});
	for (const id of [EXPENSE_ID, PAYER_ID]) {
		const response = await route.POST(request(), handlerCtx(id));
		assert.equal(response.status, 401);
	}
	assert.equal(lookups, 0);
	authorized = true;
	const response = await route.POST(request(), handlerCtx(EXPENSE_ID));
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: 'expense_not_found' });
	assert.equal(lookups, 1);
});
