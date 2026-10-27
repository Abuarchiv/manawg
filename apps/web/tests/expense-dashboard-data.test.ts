import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Dashboard data never shows partial finance numbers [suite "finance failure
// regressions"]: a failing required query rejects, and recurring counts follow the active Abos.

const schema = await import('../src/core/db/schema.ts');
const dbState: { current: unknown } = { current: {} };

mock.module('@/core/db', {
	namedExports: {
		...schema,
		db: new Proxy(
			{},
			{ get: (_target, key) => (dbState.current as Record<PropertyKey, unknown>)[key] },
		),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const { loadDashboardData } = await import('../src/composition/dashboard-data.ts');
const { getDueRecurringExpenses } = await import('../src/features/expenses/recurring-expenses.ts');

/** A drizzle-style query chain that resolves (or rejects) with `result` when awaited. */
function query(result: Promise<unknown>): unknown {
	const chain: unknown = new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'then') return result.then.bind(result);
				if (key === 'catch') return result.catch.bind(result);
				return () => chain;
			},
		},
	);
	return chain;
}

for (const table of [
	'wgMembers',
	'expenses',
	'expenseSplits',
	'expensePayments',
	'shoppingItems',
	'chores',
	'recurringExpenses',
] as const) {
	test(`dashboard refuses incomplete required data when ${table} fails`, async () => {
		const failure = new Error(`${table} unavailable`);
		dbState.current = {
			select: () => ({
				from: (selected: unknown) =>
					query(selected === schema[table] ? Promise.reject(failure) : Promise.resolve([])),
			}),
			query: { wgMembers: { findFirst: async () => null } },
		};
		await assert.rejects(loadDashboardData('wg'), (error) => error === failure);
	});
}

test('dashboard due recurring count matches active Abos and retains paused activity', async () => {
	const recurringRows = [
		{
			id: 'active-recurring',
			description: 'Internet',
			amountCents: 3990,
			nextDueAt: new Date(Date.now() - 86_400_000),
			lastCreatedAt: null,
			createdAt: new Date('2026-08-01T10:00:00.000Z'),
			pausedAt: null,
		},
		{
			id: 'paused-recurring',
			description: 'Wasser',
			amountCents: 1800,
			nextDueAt: new Date(Date.now() - 86_400_000),
			lastCreatedAt: null,
			createdAt: new Date('2026-08-02T10:00:00.000Z'),
			pausedAt: new Date('2026-09-01T10:00:00.000Z'),
		},
	];
	dbState.current = {
		select: (projection: Record<string, unknown>) => ({
			from: (selected: unknown) => {
				if (selected !== schema.recurringExpenses) return query(Promise.resolve([]));
				const projectedRows = recurringRows.map((row) =>
					Object.fromEntries(Object.entries(row).filter(([key]) => key in projection)),
				);
				return query(Promise.resolve(projectedRows));
			},
		}),
		query: { wgMembers: { findFirst: async () => null } },
	};
	const dashboard = await loadDashboardData('wg');
	const abosDue = getDueRecurringExpenses(
		recurringRows
			.filter((abo) => abo.pausedAt === null)
			.map((abo) => ({
				id: abo.id,
				description: abo.description,
				amountCents: abo.amountCents,
				currency: 'EUR',
				nextDueAt: abo.nextDueAt.toISOString(),
			})),
		Date.now(),
	);

	assert.deepEqual(
		dashboard.dueRecurringExpenses.map((abo) => abo.id),
		abosDue.map((abo) => abo.id),
	);
	assert.equal(dashboard.dueRecurringExpenses.length, abosDue.length);
	assert.deepEqual(
		dashboard.activity
			.filter((item) => item.kind === 'recurring')
			.map((item) => item.text)
			.sort(),
		['Internet als Fixkosten-Vorlage angelegt', 'Wasser als Fixkosten-Vorlage angelegt'],
	);
});
