// Both recurring expense PATCH routes (collection and item) apply the same payer guard: financial
// edits on a template paid by someone else are refused, while ordinary changes and unchanged
// foreign-payer templates still save.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { type Column, type Predicate, matches } from './support/column-predicates';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const PAYER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

const OTHER_MEMBER_ID = 'd35ea6ee-e297-4a90-b6df-3e78ce47b395';
const recurringExpenses = {
	id: { table: 'recurringExpenses', name: 'id' },
	wgId: { table: 'recurringExpenses', name: 'wgId' },
	pausedAt: { table: 'recurringExpenses', name: 'pausedAt' },
};
const wgMembers = {
	id: { table: 'wgMembers', name: 'id' },
	wgId: { table: 'wgMembers', name: 'wgId' },
	deactivatedAt: { table: 'wgMembers', name: 'deactivatedAt' },
};
const template = {
	id: EXPENSE_ID,
	wgId: WG_ID,
	createdByMemberId: CALLER_ID,
	description: 'Miete',
	amountCents: 1200,
	paidByMemberId: CALLER_ID,
	intervalMonths: 1,
	nextDueAt: new Date('2026-10-01T00:00:00.000Z'),
	anchorAt: new Date('2026-10-01T00:00:00.000Z'),
	lastCreatedAt: null,
	pausedAt: null,
	splitsJson: JSON.stringify([{ debtorMemberId: CALLER_ID, amountCents: 1200 }]),
	createdAt: new Date('2026-09-01T00:00:00.000Z'),
};
const memberRows = [
	{ id: CALLER_ID, wgId: WG_ID, deactivatedAt: null },
	{ id: PAYER_ID, wgId: WG_ID, deactivatedAt: null },
	{ id: OTHER_MEMBER_ID, wgId: WG_ID, deactivatedAt: null },
];
let updates = 0;
const db = {
	select: () => {
		let table: unknown;
		const query = {
			from(nextTable: unknown) {
				table = nextTable;
				return query;
			},
			where(condition: Predicate) {
				const rows =
					table === wgMembers ? memberRows.filter((row) => matches(row, condition)) : [template];
				const result = Promise.resolve(rows) as Promise<unknown[]> & {
					limit: (count: number) => Promise<unknown[]>;
				};
				result.limit = async () => (table === recurringExpenses ? [template] : []);
				return result;
			},
		};
		return query;
	},
	update: () => ({
		set: (values: Record<string, unknown>) => ({
			where: () => ({
				returning: async () => {
					updates += 1;
					Object.assign(template, values);
					return [template];
				},
			}),
		}),
	}),
};
const operators = {
	and: (...values: Predicate[]): Predicate => ({ kind: 'and', values }),
	asc: () => undefined,
	eq: (column: Column, value: unknown): Predicate => ({ kind: 'eq', column, value }),
	gt: () => undefined,
	inArray: (column: Column, values: unknown[]): Predicate => ({ kind: 'in', column, values }),
	isNotNull: (column: Column): Predicate => ({ kind: 'notNull', column }),
	isNull: (column: Column): Predicate => ({ kind: 'null', column }),
	sql: () => undefined,
};

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID, name: 'WG', shareCode: 'MTE8PZAT' },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/db', { db, recurringExpenses, wgMembers });
await mockModuleWithReal('@/core/guards/admin', { requireOwnerOrAdmin: async () => null });
await mockModuleWithReal('@/core/guards/route-preamble', {
	readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
});
// The collection route writes through withIdempotentWrite without a replay key.
await mockModuleWithReal('@/core/idempotency-store', {
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
	readIdempotencyKey: () => null,
});
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/features/expenses/expense-payments', {
	withExpensePaymentLock: async (_wgId: string, operation: (tx: unknown) => Promise<unknown>) =>
		operation({}),
});
await mockModuleWithReal('drizzle-orm', operators);

const collectionRoute = await import('../src/app/api/wg/[code]/recurring-expenses/route');
const itemRoute = await import('../src/app/api/wg/[code]/recurring-expenses/[id]/route');

test('both recurring expense PATCH routes guard financial edits without blocking ordinary changes', async () => {
	const collectionEndpoint = {
		route: collectionRoute,
		// withWgRoute is the identity here, so handlers receive the context the wrapper would build.
		context: { code: 'MTE8PZAT' } as never,
	};
	const itemEndpoint = {
		route: itemRoute,
		context: { code: 'MTE8PZAT', id: EXPENSE_ID } as never,
	};
	const endpoints = [collectionEndpoint, itemEndpoint];
	const send = async (endpoint: (typeof endpoints)[number], body: Record<string, unknown>) => {
		const response = await endpoint.route.PATCH(
			new NextRequest('http://localhost', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			}),
			endpoint.context,
		);
		return { status: response.status, body: await response.json() };
	};
	const results = [];
	for (const endpoint of endpoints) {
		results.push(
			await send(endpoint, {
				id: EXPENSE_ID,
				paidByMemberId: PAYER_ID,
				splits: [{ debtorMemberId: PAYER_ID, amountCents: 1200 }],
			}),
		);
	}

	assert.deepEqual(
		{ results, updates },
		{
			results: [
				{ status: 403, body: { error: 'paid_by_must_include_caller' } },
				{ status: 403, body: { error: 'paid_by_must_include_caller' } },
			],
			updates: 0,
		},
	);

	const positiveCallerShare = await send(collectionEndpoint, {
		id: EXPENSE_ID,
		paidByMemberId: PAYER_ID,
		splits: [
			{ debtorMemberId: PAYER_ID, amountCents: 1199 },
			{ debtorMemberId: CALLER_ID, amountCents: 1 },
		],
	});
	const selfPayer = await send(itemEndpoint, {
		paidByMemberId: CALLER_ID,
		splits: [{ debtorMemberId: CALLER_ID, amountCents: 1200 }],
	});
	const legacySplits = [{ debtorMemberId: PAYER_ID, amountCents: 1200 }];
	const reorderedLegacySplits = [
		{ debtorMemberId: PAYER_ID, amountCents: 900 },
		{ debtorMemberId: OTHER_MEMBER_ID, amountCents: 300 },
	];
	Object.assign(template, {
		amountCents: 1200,
		paidByMemberId: PAYER_ID,
		splitsJson: JSON.stringify(legacySplits),
		pausedAt: null,
	});
	const unchangedForeignPayerEdits = [];
	for (const endpoint of endpoints) {
		for (const splits of [legacySplits, reorderedLegacySplits]) {
			Object.assign(template, {
				description: 'Miete',
				amountCents: 1200,
				paidByMemberId: PAYER_ID,
				splitsJson: JSON.stringify(splits),
			});
			unchangedForeignPayerEdits.push(
				await send(endpoint, {
					id: EXPENSE_ID,
					description: 'Miete angepasst',
					amountCents: 1200,
					paidByMemberId: PAYER_ID,
					intervalMonths: 1,
					nextDueAt: '2026-10-01T00:00:00.000Z',
					splits: [...splits].reverse(),
				}),
			);
		}
	}
	Object.assign(template, {
		description: 'Miete',
		amountCents: 1200,
		paidByMemberId: PAYER_ID,
		splitsJson: JSON.stringify(legacySplits),
	});
	const updatesBeforeRejectedEdits = updates;
	const rejectedFinancialEdits = [];
	for (const endpoint of endpoints) {
		rejectedFinancialEdits.push(
			await send(endpoint, {
				id: EXPENSE_ID,
				amountCents: 1300,
				paidByMemberId: PAYER_ID,
				splits: [{ debtorMemberId: PAYER_ID, amountCents: 1300 }],
			}),
			await send(endpoint, {
				id: EXPENSE_ID,
				amountCents: 1200,
				paidByMemberId: PAYER_ID,
				splits: [
					{ debtorMemberId: PAYER_ID, amountCents: 1000 },
					{ debtorMemberId: OTHER_MEMBER_ID, amountCents: 200 },
				],
			}),
			await send(endpoint, {
				id: EXPENSE_ID,
				amountCents: 1200,
				paidByMemberId: OTHER_MEMBER_ID,
				splits: legacySplits,
			}),
		);
	}
	const ordinaryChanges = [
		await send(collectionEndpoint, { id: EXPENSE_ID, description: 'Miete angepasst' }),
		await send(collectionEndpoint, {
			id: EXPENSE_ID,
			nextDueAt: '2026-11-01T00:00:00.000Z',
		}),
		await send(collectionEndpoint, {
			id: EXPENSE_ID,
			expectedNextDueAt: template.nextDueAt.toISOString(),
		}),
		await send(itemEndpoint, { description: 'Miete angepasst' }),
		await send(itemEndpoint, { nextDueAt: '2026-12-01T00:00:00.000Z' }),
		await send(itemEndpoint, { paused: true }),
		await send(itemEndpoint, { paused: false }),
	];

	assert.equal(positiveCallerShare.status, 200);
	assert.equal(selfPayer.status, 200);
	assert.deepEqual(
		unchangedForeignPayerEdits.map((result) => result.status),
		[200, 200, 200, 200],
	);
	assert.deepEqual(
		rejectedFinancialEdits.map((result) => result.status),
		[403, 403, 403, 403, 403, 403],
	);
	assert.equal(updates, updatesBeforeRejectedEdits + 7);
	assert.deepEqual(
		ordinaryChanges.map((result) => result.status),
		[200, 200, 200, 200, 200, 200, 200],
	);
});
