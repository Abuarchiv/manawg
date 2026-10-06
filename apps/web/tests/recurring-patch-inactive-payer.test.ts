// Changing a recurring template's payer to a member who has left the WG is rejected.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { type Predicate, columnOperators, matches } from './support/column-predicates';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const wgMembers = {
	id: { table: 'wgMembers', name: 'id' },
	wgId: { table: 'wgMembers', name: 'wgId' },
	deactivatedAt: { table: 'wgMembers', name: 'deactivatedAt' },
};
const recurringExpenses = {
	id: { table: 'recurringExpenses', name: 'id' },
	wgId: { table: 'recurringExpenses', name: 'wgId' },
	pausedAt: { table: 'recurringExpenses', name: 'pausedAt' },
};
const inactiveId = '24ba761e-a429-45c3-a311-18e9a44b9be8';
const activeDebtorId = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
const template = {
	id: EXPENSE_ID,
	wgId: WG_ID,
	createdByMemberId: CALLER_ID,
	description: 'Miete',
	amountCents: 1200,
	paidByMemberId: CALLER_ID,
	intervalMonths: 1,
	nextDueAt: new Date('2026-10-01T00:00:00.000Z'),
	lastCreatedAt: null,
	pausedAt: null,
	splitsJson: JSON.stringify([{ debtorMemberId: activeDebtorId, amountCents: 1200 }]),
	createdAt: new Date('2026-09-01T00:00:00.000Z'),
};
const memberRows = [
	{ id: activeDebtorId, wgId: WG_ID, deactivatedAt: null },
	{ id: inactiveId, wgId: WG_ID, deactivatedAt: new Date('2026-09-10T00:00:00.000Z') },
];
const db = {
	select: () => {
		let table: unknown;
		let condition: Predicate | undefined;
		const rows = () =>
			table === recurringExpenses
				? [template]
				: table === wgMembers
					? memberRows.filter((row) => !condition || matches(row, condition))
					: [];
		const query = {
			from(nextTable: unknown) {
				table = nextTable;
				return query;
			},
			where(nextCondition: Predicate) {
				condition = nextCondition;
				return query;
			},
			limit: async () => rows().slice(0, 1),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; the fake applies the predicate on await.
			then<TResult1 = unknown[], TResult2 = never>(
				onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
				onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
			): PromiseLike<TResult1 | TResult2> {
				return Promise.resolve(rows()).then(onfulfilled, onrejected);
			},
		};
		return query;
	},
	update: () => ({
		set: () => ({
			where: () => ({ returning: async () => [template] }),
		}),
	}),
};

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/db', { db, recurringExpenses, wgMembers });
await mockModuleWithReal('@/core/guards/admin', { requireOwnerOrAdmin: async () => null });
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/features/expenses/paid-by-guard', {
	checkPaidByGuard: () => ({ ok: true }),
});
await mockModuleWithReal('drizzle-orm', columnOperators);

const route = await import('../src/app/api/wg/[code]/recurring-expenses/[id]/route');
// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'MTE8PZAT', id: EXPENSE_ID } as never;

test('recurring expense PATCH rejects an inactive payer', async () => {
	const response = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paidByMemberId: inactiveId }),
		}),
		handlerCtx,
	);

	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'member_not_in_wg' });
});
