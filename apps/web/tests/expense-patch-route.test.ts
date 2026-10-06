// Editing an expense keeps its splits consistent: fractional timestamps and concurrent amount
// changes conflict instead of overwriting, historical shares of departed members survive, and
// financial edits wait while a PayPal capture is in flight.

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

const expenses = {
	id: { table: 'expenses', name: 'id' },
	wgId: { table: 'expenses', name: 'wgId' },
	paidByMemberId: { table: 'expenses', name: 'paidByMemberId' },
	amountCents: { table: 'expenses', name: 'amountCents' },
	updatedAt: { table: 'expenses', name: 'updatedAt' },
	description: { table: 'expenses', name: 'description' },
	currency: { table: 'expenses', name: 'currency' },
	imageUrl: { table: 'expenses', name: 'imageUrl' },
};
const expenseSplits = {
	expenseId: { table: 'expenseSplits', name: 'expenseId' },
	debtorMemberId: { table: 'expenseSplits', name: 'debtorMemberId' },
	amountCents: { table: 'expenseSplits', name: 'amountCents' },
	settledAt: { table: 'expenseSplits', name: 'settledAt' },
};
const wgMembers = {
	id: { table: 'wgMembers', name: 'id' },
	wgId: { table: 'wgMembers', name: 'wgId' },
	deactivatedAt: { table: 'wgMembers', name: 'deactivatedAt' },
};
const debtorId = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
const departedId = '9f2f0a21-b135-4d08-b1bd-846b034e7e90';
const initialUpdatedAt = new Date('2026-09-20T00:00:00.123Z');
const concurrentUpdatedAt = new Date('2026-09-20T00:00:00.123Z');
let mutateAtLock = true;
let capturing = false;
let currentExpense = {
	id: EXPENSE_ID,
	wgId: WG_ID,
	paidByMemberId: CALLER_ID,
	amountCents: 1200,
	updatedAt: initialUpdatedAt,
	updatedAtPrecise: '2026-09-20T00:00:00.123456Z',
	description: 'Einkauf',
	currency: 'EUR',
	imageUrl: null,
};
let currentSplits: Array<Record<string, unknown>> = [
	{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 1200, settledAt: null },
];
const operators = {
	eq: (column: Column, value: unknown): Predicate => ({ kind: 'eq', column, value }),
	inArray: (column: Column, values: unknown[]): Predicate => ({ kind: 'in', column, values }),
	isNull: (column: Column): Predicate => ({ kind: 'null', column }),
	and: (...values: Predicate[]): Predicate => ({ kind: 'and', values }),
	sql: (strings: TemplateStringsArray, _column: unknown, value: unknown): Predicate =>
		strings[0]?.includes('greatest') ? { kind: 'nextVersion' } : { kind: 'millisEq', value },
};
const members = [
	{ id: debtorId, wgId: WG_ID, deactivatedAt: null },
	{ id: CALLER_ID, wgId: WG_ID, deactivatedAt: null },
	{ id: departedId, wgId: WG_ID, deactivatedAt: new Date('2026-09-01T00:00:00.000Z') },
];
const makeSelect = () => {
	let table: unknown;
	let condition: Predicate | undefined;
	const rows = () => {
		const allRows =
			table === expenses
				? [currentExpense]
				: table === expenseSplits
					? currentSplits
					: table === wgMembers
						? members
						: [];
		return allRows.filter((row) => !condition || matches(row, condition));
	};
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
};
const tx = {
	select: makeSelect,
	update: () => ({
		set: (values: Record<string, unknown>) => ({
			where: (condition: Predicate) => ({
				returning: async () => {
					if (!matches(currentExpense, condition)) return [];
					const updatedAt =
						(values.updatedAt as Predicate).kind === 'nextVersion'
							? new Date(Math.max(Date.now(), currentExpense.updatedAt.getTime() + 1))
							: (values.updatedAt as Date);
					currentExpense = {
						...currentExpense,
						...values,
						updatedAt,
						updatedAtPrecise: updatedAt.toISOString(),
					};
					return [{ id: EXPENSE_ID }];
				},
			}),
		}),
	}),
	delete: (table: unknown) => ({
		where: (condition: Predicate) => {
			if (table === expenseSplits) {
				currentSplits = currentSplits.filter((split) => !matches(split, condition));
			}
			return Promise.resolve([]);
		},
	}),
	insert: (table: unknown) => ({
		values: (values: Array<Record<string, unknown>>) => ({
			returning: async () => {
				if (table === expenseSplits) currentSplits = values;
				return values.map(() => ({ expenseId: EXPENSE_ID }));
			},
		}),
	}),
};
const db = { select: makeSelect };

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/db', { db, expenseSplits, expenses, wgMembers });
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
	hasCapturingExpensePayment: async () => capturing,
	withExpensePaymentLock: async (
		_wgId: string,
		operation: (value: typeof tx) => Promise<unknown>,
	) => {
		if (mutateAtLock) {
			currentExpense = {
				...currentExpense,
				amountCents: 2000,
				updatedAt: concurrentUpdatedAt,
				updatedAtPrecise: '2026-09-20T00:00:00.123789Z',
			};
			currentSplits = [
				{
					expenseId: EXPENSE_ID,
					debtorMemberId: debtorId,
					amountCents: 2000,
					settledAt: null,
				},
			];
		}
		return operation(tx);
	},
});
await mockModuleWithReal('drizzle-orm', operators);

const route = await import('../src/app/api/wg/[code]/expenses/[id]/route');
// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'MTE8PZAT', id: EXPENSE_ID } as never;

test('expense PATCH preserves split integrity with fractional timestamps and concurrent amount changes', async () => {
	const response = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				expectedUpdatedAt: initialUpdatedAt.toISOString(),
				splits: [{ debtorMemberId: debtorId, amountCents: 1200 }],
			}),
		}),
		handlerCtx,
	);

	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'expense_changed' });
	assert.equal(currentExpense.amountCents, 2000);
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 2000, settledAt: null },
	]);

	mutateAtLock = false;
	const priorVersion = new Date('2100-01-01T00:00:00.000Z');
	currentExpense = {
		...currentExpense,
		updatedAt: priorVersion,
		updatedAtPrecise: priorVersion.toISOString(),
	};
	const ordinaryResponse = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				expectedUpdatedAt: currentExpense.updatedAt.toISOString(),
				splits: [{ debtorMemberId: debtorId, amountCents: 2000 }],
			}),
		}),
		handlerCtx,
	);
	assert.equal(ordinaryResponse.status, 200);
	assert.ok(currentExpense.updatedAt.getTime() > priorVersion.getTime());
	const mismatchedResponse = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				splits: [{ debtorMemberId: debtorId, amountCents: 1900 }],
			}),
		}),
		handlerCtx,
	);
	assert.equal(mismatchedResponse.status, 400);
	assert.deepEqual(await mismatchedResponse.json(), { error: 'splits_sum_mismatch' });
	assert.equal(currentExpense.amountCents, 2000);
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 2000, settledAt: null },
	]);

	const historicalSplits = [
		{
			expenseId: EXPENSE_ID,
			debtorMemberId: CALLER_ID,
			amountCents: 1000,
			settledAt: new Date('2026-09-10T00:00:00.000Z'),
		},
		{ expenseId: EXPENSE_ID, debtorMemberId: departedId, amountCents: 1000, settledAt: null },
	];
	currentSplits = historicalSplits;
	const unchangedHistoricalResponse = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				description: 'Historischer Einkauf',
				splits: [
					{ debtorMemberId: CALLER_ID, amountCents: 1000 },
					{ debtorMemberId: departedId, amountCents: 1000 },
				],
			}),
		}),
		handlerCtx,
	);
	assert.equal(unchangedHistoricalResponse.status, 200);
	assert.deepEqual(currentSplits, historicalSplits);

	const removedHistoricalResponse = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				description: 'Versucht den historischen Anteil zu entfernen',
				splits: [{ debtorMemberId: CALLER_ID, amountCents: 2000 }],
			}),
		}),
		handlerCtx,
	);
	assert.equal(removedHistoricalResponse.status, 400);
	assert.deepEqual(await removedHistoricalResponse.json(), { error: 'member_not_in_wg' });
	assert.equal(currentExpense.description, 'Historischer Einkauf');
	assert.deepEqual(currentSplits, historicalSplits);

	currentSplits = [
		{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 2000, settledAt: null },
	];
	const newlyIntroducedResponse = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				description: 'Darf keinen neuen inaktiven Anteil anlegen',
				splits: [
					{ debtorMemberId: CALLER_ID, amountCents: 1000 },
					{ debtorMemberId: departedId, amountCents: 1000 },
				],
			}),
		}),
		handlerCtx,
	);
	assert.equal(newlyIntroducedResponse.status, 400);
	assert.deepEqual(await newlyIntroducedResponse.json(), { error: 'member_not_in_wg' });
	assert.equal(currentExpense.description, 'Historischer Einkauf');
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 2000, settledAt: null },
	]);
	capturing = true;
	const blockedFinancialEdit = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currency: 'USD' }),
		}),
		handlerCtx,
	);
	assert.equal(blockedFinancialEdit.status, 409);
	assert.deepEqual(await blockedFinancialEdit.json(), { error: 'paypal_payment_pending' });
	assert.equal(currentExpense.currency, 'EUR');
	const cosmeticEdit = await route.PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ description: 'Nur Text' }),
		}),
		handlerCtx,
	);
	assert.equal(cosmeticEdit.status, 200);
	assert.equal(currentExpense.description, 'Nur Text');
});
