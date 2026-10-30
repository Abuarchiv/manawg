import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import type { DbTransaction } from '../src/core/db/transaction.ts';
import { writeExpense } from '../src/features/expenses/server/expense-create.ts';
import { loadLedger } from '../src/features/expenses/server/expense-ledger.ts';
import { writeImport } from '../src/features/expenses/server/import-commit.ts';

// The payer and debtor check that runs inside the expense payment lock, against a real
// PostgreSQL. Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all
// migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

async function withWg(
	run: (ctx: {
		database: ReturnType<typeof drizzle<typeof schema>>;
		wgId: string;
		active: string;
		movedOut: string;
	}) => Promise<void>,
) {
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const suffix = randomUUID().replaceAll('-', '');
	let wgId = '';
	try {
		const [wg] = await database
			.insert(schema.wgs)
			.values({ shareCode: `M${suffix.slice(0, 7)}`, name: `Member lock ${suffix}` })
			.returning({ id: schema.wgs.id });
		wgId = wg?.id ?? '';
		assert.ok(wgId);
		const [active] = await database
			.insert(schema.wgMembers)
			.values({ wgId, name: 'Active' })
			.returning({ id: schema.wgMembers.id });
		const [movedOut] = await database
			.insert(schema.wgMembers)
			.values({ wgId, name: 'Moved out', deactivatedAt: new Date() })
			.returning({ id: schema.wgMembers.id });
		assert.ok(active && movedOut);
		await run({ database, wgId, active: active.id, movedOut: movedOut.id });
	} finally {
		if (wgId) await database.delete(schema.wgs).where(eq(schema.wgs.id, wgId));
		await pool.end();
	}
}

function expenseInput(wgId: string, paidByMemberId: string, debtors: string[]) {
	return {
		wgId,
		paidByMemberId,
		amountCents: 200 * debtors.length,
		currency: 'EUR',
		description: 'Groceries',
		category: 'groceries',
		imageUrl: null,
		occurredAt: new Date(),
		splits: debtors.map((debtorMemberId) => ({ debtorMemberId, amountCents: 200 })),
	};
}

async function countRows(
	database: ReturnType<typeof drizzle<typeof schema>>,
	wgId: string,
): Promise<number> {
	const rows = await database.select().from(schema.expenses).where(eq(schema.expenses.wgId, wgId));
	return rows.length;
}

test('writeExpense refuses a debtor who moved out and writes nothing', { skip }, async () => {
	await withWg(async ({ database, wgId, active, movedOut }) => {
		await assert.rejects(
			database.transaction((tx) =>
				writeExpense(
					tx as unknown as DbTransaction,
					expenseInput(wgId, active, [active, movedOut]),
				),
			),
			{ code: 'member_not_in_wg' },
		);
		assert.equal(await countRows(database, wgId), 0);
	});
});

test('writeExpense refuses a payer who moved out and writes nothing', { skip }, async () => {
	await withWg(async ({ database, wgId, active, movedOut }) => {
		await assert.rejects(
			database.transaction((tx) =>
				writeExpense(tx as unknown as DbTransaction, expenseInput(wgId, movedOut, [active])),
			),
			{ code: 'member_not_in_wg' },
		);
		assert.equal(await countRows(database, wgId), 0);
	});
});

test('writeExpense still books for active members', { skip }, async () => {
	await withWg(async ({ database, wgId, active }) => {
		const outcome = await database.transaction((tx) =>
			writeExpense(tx as unknown as DbTransaction, expenseInput(wgId, active, [active])),
		);
		assert.equal(outcome.status, 200);
		assert.equal(await countRows(database, wgId), 1);
	});
});

test('writeImport refuses a mapped member who moved out and writes nothing', { skip }, async () => {
	await withWg(async ({ database, wgId, active, movedOut }) => {
		const input = {
			wg: { id: wgId, name: 'WG', shareCode: 'ABCDEFGH' },
			source: 'splitwise_csv' as const,
			importedByMemberId: active,
			importedByName: 'Active',
			mayRecordForOthers: true,
			expenses: [
				{
					parsed: {
						date: '2026-10-01T00:00:00.000Z',
						description: 'Rent',
						amountCents: 400,
						currency: 'EUR' as const,
						paidByName: 'Active',
						splits: [
							{ memberName: 'Active', amountCents: 200 },
							{ memberName: 'Moved out', amountCents: 200 },
						],
						warnings: [],
					},
					skip: false,
				},
			],
			mapping: { Active: active, 'Moved out': movedOut },
			skipDuplicates: false,
			rawPayloadHash: 'hash',
		};
		await assert.rejects(
			database.transaction((tx) => writeImport(tx as unknown as DbTransaction, input)),
			{ message: 'member_not_in_wg' },
		);
		assert.equal(await countRows(database, wgId), 0);
		const imports = await database
			.select()
			.from(schema.expenseImports)
			.where(eq(schema.expenseImports.wgId, wgId));
		assert.equal(imports.length, 0);
	});
});

test('the ledger reads real SQL joins scoped to the flat and keeps expenses without shares', {
	skip,
}, async () => {
	await withWg(async ({ database, wgId, active }) => {
		const [withSplit, withoutSplit] = await database
			.insert(schema.expenses)
			.values([
				{ wgId, paidByMemberId: active, amountCents: 500, description: 'Mit Anteil' },
				{ wgId, paidByMemberId: active, amountCents: 100, description: 'Ohne Anteil' },
			])
			.returning();
		assert.ok(withSplit && withoutSplit);
		await database.insert(schema.expenseSplits).values({
			expenseId: withSplit.id,
			debtorMemberId: active,
			amountCents: 500,
		});
		const result = await loadLedger(wgId, database);
		assert.equal(result.length, 2);
		assert.ok(result.every((entry) => entry.debt.paidByMemberId === active));
		assert.deepEqual(result.map((entry) => entry.debt.splits.length).sort(), [0, 1]);
		assert.deepEqual(
			result.flatMap((entry) => entry.debt.splits),
			[
				{
					debtorMemberId: active,
					amountCents: 500,
					settledAt: null,
				},
			],
		);
		assert.deepEqual(await loadLedger(randomUUID(), database), []);
	});
});
