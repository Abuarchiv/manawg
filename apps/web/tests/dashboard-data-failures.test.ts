// The dashboard read refuses to answer with incomplete data when a required table read fails, and
// its due recurring count matches the active templates while paused ones keep their activity.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as schema from '../src/core/db/schema';
import { getDueRecurringExpenses } from '../src/features/expenses/recurring-expenses';
import { mockModuleWithReal } from './support/module-mocks';

type Select = (projection: Record<string, unknown>) => { from: (table: unknown) => unknown };

/** The table reads of the dashboard load under test. */
let select: Select = () => ({ from: () => query(Promise.resolve([])) });

/** A thenable query chain that ignores every builder call and settles with `result`. */
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

const utcDay = (date: Date, offset = 0) =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));

await mockModuleWithReal('@/core/db', {
	db: {
		select: (projection: Record<string, unknown>) => select(projection),
		query: { wgMembers: { findFirst: async () => null } },
	},
});
await mockModuleWithReal('@/core/infra/observability', { captureException: () => undefined });
await mockModuleWithReal('@/core/utils/berlin-day', {
	berlinDayKey: (date: Date) => date.toISOString().slice(0, 10),
	startOfBerlinDay: (date: Date) => utcDay(date),
	nextBerlinDayStart: (date: Date) => utcDay(date, 1),
	prevBerlinDayStart: (date: Date) => utcDay(date, -1),
});
await mockModuleWithReal('@/features/chores/absence', { getAbsentMemberIds: () => [] });
await mockModuleWithReal('@/features/expenses/debt-reduction', { computeNetBalances: () => [] });
await mockModuleWithReal('@/composition/dashboard-insights', {
	buildDueChores: () => [],
	getWgHealth: (input: { dueRecurringCount: number }) => ({
		dueRecurringCount: input.dueRecurringCount,
	}),
});
await mockModuleWithReal('@/composition/dashboard-links', {
	getDashboardActivityHref: () => '/wg/WG/aktivitaet',
});

const { loadDashboardData } = await import('../src/composition/dashboard-data');

describe('finance failure regressions', () => {
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
			select = () => ({
				from: (selected: unknown) =>
					query(selected === schema[table] ? Promise.reject(failure) : Promise.resolve([])),
			});
			await assert.rejects(loadDashboardData('wg'), (error) => {
				assert.equal(error, failure);
				return true;
			});
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
		select = (projection) => ({
			from: (selected: unknown) => {
				if (selected !== schema.recurringExpenses) return query(Promise.resolve([]));
				const projectedRows = recurringRows.map((row) =>
					Object.fromEntries(Object.entries(row).filter(([key]) => key in projection)),
				);
				return query(Promise.resolve(projectedRows));
			},
		});
		const dashboard = (await loadDashboardData('wg')) as unknown as {
			dueRecurringExpenses: Array<{ id: string }>;
			wgHealth: { dueRecurringCount: number };
			activity: Array<{ kind: string; text: string }>;
		};
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
		assert.equal(dashboard.wgHealth.dueRecurringCount, abosDue.length);
		assert.deepEqual(
			dashboard.activity
				.filter((item) => item.kind === 'recurring')
				.map((item) => item.text)
				.sort(),
			['Internet als Vorlage angelegt', 'Wasser als Vorlage angelegt'],
		);
	});
});
