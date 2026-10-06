// Creating a recurring template paid by someone else requires the caller to bear a positive share,
// so a member cannot record a standing charge between two other people.

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

let memberRows = [{ id: PAYER_ID }];
const recurringExpenses = {};
let insertCount = 0;
const tx = {
	insert: () => ({
		values: (value: Record<string, unknown>) => ({
			returning: async () => {
				insertCount += 1;
				return [
					{
						...value,
						id: EXPENSE_ID,
						createdAt: new Date(),
						lastCreatedAt: null,
						pausedAt: null,
					},
				];
			},
		}),
	}),
};

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID, name: 'WG', shareCode: 'MTE8PZAT' },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/db', {
	db: { select: () => ({ from: () => ({ where: async () => memberRows }) }) },
	idempotencyResponses: {},
	recurringExpenses,
	wgMembers: {},
});
await mockModuleWithReal('@/core/guards/admin', { requireOwnerOrAdmin: async () => null });
await mockModuleWithReal('@/core/guards/route-preamble', {
	readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
});
await mockModuleWithReal('@/core/idempotency-store', {
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
	readIdempotencyKey: () => null,
});
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/features/expenses/expense-payments', {
	withExpensePaymentLock: async (_wgId: string, operation: (tx: unknown) => Promise<unknown>) =>
		operation(tx),
});
await mockModuleWithReal('@/features/expenses/recurring-expenses', {
	parseRecurringSplits: JSON.parse,
	serializeRecurringExpense: (row: { splitsJson: string }) => ({
		...row,
		splits: JSON.parse(row.splitsJson),
	}),
});
await mockModuleWithReal('drizzle-orm', {
	and: (...conditions: unknown[]) => conditions,
	asc: () => undefined,
	eq: () => undefined,
	gt: () => undefined,
	inArray: () => undefined,
	isNull: () => undefined,
	sql: () => undefined,
});

const route = await import('../src/app/api/wg/[code]/recurring-expenses/route');

test('recurring expense creation requires the caller to bear a positive share', async () => {
	const post = (splits: Array<{ debtorMemberId: string; amountCents: number }>) =>
		route.POST(
			new NextRequest('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					description: 'Miete',
					amountCents: 1200,
					paidByMemberId: PAYER_ID,
					nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
					splits,
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

	const fabricated = await post([{ debtorMemberId: PAYER_ID, amountCents: 1200 }]);
	assert.equal(fabricated.status, 403);
	assert.deepEqual(await fabricated.json(), { error: 'paid_by_must_include_caller' });
	assert.equal(insertCount, 0);

	memberRows = [{ id: PAYER_ID }, { id: CALLER_ID }];
	const zeroShare = await post([
		{ debtorMemberId: PAYER_ID, amountCents: 1200 },
		{ debtorMemberId: CALLER_ID, amountCents: 0 },
	]);
	assert.equal(zeroShare.status, 403);
	assert.deepEqual(await zeroShare.json(), { error: 'paid_by_must_include_caller' });
	assert.equal(insertCount, 0);

	const includedCaller = await post([
		{ debtorMemberId: PAYER_ID, amountCents: 1199 },
		{ debtorMemberId: CALLER_ID, amountCents: 1 },
	]);
	assert.equal(includedCaller.status, 200);
	assert.equal(insertCount, 1);
});
