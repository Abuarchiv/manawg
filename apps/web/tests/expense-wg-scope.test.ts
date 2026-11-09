import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import type { DbTransaction } from '../src/core/db/transaction.ts';
import { writeExpense } from '../src/features/expenses/server/expense-create.ts';
import { findExpenseMemberIds } from '../src/features/expenses/server/expenses.ts';
import { writeImport } from '../src/features/expenses/server/import-commit.ts';

// Expense writes, imports and import undo against two flats in a real PostgreSQL: the WG
// filters on members, recurring templates and imports live in SQL, which the mocked tests
// cannot see. Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all
// migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

type Database = ReturnType<typeof drizzle<typeof schema>>;

interface TwoWgs {
	database: Database;
	wgId: string;
	member: string;
	otherWgId: string;
	stranger: string;
	strangerAdmin: string;
}

async function withTwoWgs(run: (ctx: TwoWgs) => Promise<void>) {
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const suffix = randomUUID().replaceAll('-', '');
	const wgIds: string[] = [];
	try {
		const wgs: string[] = [];
		for (const n of [0, 1]) {
			const [wg] = await database
				.insert(schema.wgs)
				.values({ shareCode: `S${n}${suffix.slice(0, 6)}`, name: `Expense scope ${n} ${suffix}` })
				.returning({ id: schema.wgs.id });
			assert.ok(wg);
			wgIds.push(wg.id);
			wgs.push(wg.id);
		}
		const addMember = async (wgId: string, name: string, role: 'admin' | 'member') => {
			const [row] = await database
				.insert(schema.wgMembers)
				.values({ wgId, name, role })
				.returning({ id: schema.wgMembers.id });
			assert.ok(row);
			return row.id;
		};
		const [wgId, otherWgId] = wgs as [string, string];
		await run({
			database,
			wgId,
			member: await addMember(wgId, 'Member A', 'member'),
			otherWgId,
			stranger: await addMember(otherWgId, 'Member B', 'member'),
			strangerAdmin: await addMember(otherWgId, 'Admin B', 'admin'),
		});
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
}

function expenseInput(wgId: string, paidByMemberId: string, debtorMemberId: string) {
	return {
		wgId,
		paidByMemberId,
		amountCents: 200,
		currency: 'EUR',
		description: 'Groceries',
		category: 'groceries',
		imageUrl: null,
		occurredAt: new Date(),
		splits: [{ debtorMemberId, amountCents: 200 }],
	};
}

async function expenseCount(database: Database, wgId: string): Promise<number> {
	const rows = await database.select().from(schema.expenses).where(eq(schema.expenses.wgId, wgId));
	return rows.length;
}

function importRow(description: string, amountCents: number, debtor: string) {
	return {
		parsed: {
			date: '2026-10-01T00:00:00.000Z',
			description,
			amountCents,
			currency: 'EUR' as const,
			paidByName: 'Ann',
			splits: [{ memberName: debtor, amountCents }],
			warnings: [],
		},
		skip: false,
	};
}

function importInput(
	wgId: string,
	member: string,
	mapping: Record<string, string | null>,
	rows: ReturnType<typeof importRow>[],
) {
	return {
		wg: { id: wgId, name: 'WG', shareCode: 'ABCDEFGH' },
		source: 'splitwise_csv' as const,
		importedByMemberId: member,
		importedByName: 'Member A',
		mayRecordForOthers: true,
		expenses: rows,
		mapping,
		skipDuplicates: false,
		rawPayloadHash: 'hash',
	};
}

test('writeExpense refuses a payer or debtor of another flat and writes nothing', {
	skip,
}, async () => {
	await withTwoWgs(async ({ database, wgId, member, otherWgId, stranger }) => {
		for (const [paidBy, debtor] of [
			[member, stranger],
			[stranger, member],
		] as const) {
			await assert.rejects(
				database.transaction((tx) =>
					writeExpense(tx as unknown as DbTransaction, expenseInput(wgId, paidBy, debtor)),
				),
				{ code: 'member_not_in_wg' },
			);
		}
		assert.equal(await expenseCount(database, wgId), 0);
		assert.equal(await expenseCount(database, otherWgId), 0);
	});
});

test('findExpenseMemberIds does not count a member of another flat', { skip }, async () => {
	await withTwoWgs(async ({ database, wgId, member, stranger }) => {
		const found = await findExpenseMemberIds(
			wgId,
			[member, stranger],
			database as unknown as DbTransaction,
		);
		assert.deepEqual([...found], [member]);
	});
});

test('writeImport refuses a name mapped to a member of another flat and writes nothing', {
	skip,
}, async () => {
	await withTwoWgs(async ({ database, wgId, member, stranger }) => {
		const input = importInput(wgId, member, { Ann: stranger }, [importRow('Rent', 400, 'Ann')]);
		await assert.rejects(
			database.transaction((tx) => writeImport(tx as unknown as DbTransaction, input)),
			{ code: 'member_not_in_wg' },
		);
		assert.equal(await expenseCount(database, wgId), 0);
		const imports = await database
			.select()
			.from(schema.expenseImports)
			.where(eq(schema.expenseImports.wgId, wgId));
		assert.equal(imports.length, 0);
	});
});

test('writeImport reports a row without a mapped debtor and totals only the inserted rows', {
	skip,
}, async () => {
	await withTwoWgs(async ({ database, wgId, member }) => {
		const input = importInput(wgId, member, { Ann: member, Ghost: null }, [
			importRow('Rent', 400, 'Ann'),
			importRow('Beer', 300, 'Ghost'),
			importRow('Gas', 100, 'Ann'),
		]);
		const outcome = await database.transaction((tx) =>
			writeImport(tx as unknown as DbTransaction, input),
		);
		assert.deepEqual(outcome.body.errors, [{ index: 1, reason: 'no_valid_splits' }]);
		assert.equal(outcome.body.inserted, 2);
		assert.equal(outcome.context.totalAmountCents, 500);
		assert.equal(await expenseCount(database, wgId), 2);
	});
});

test('booking a recurring template of another flat is refused and leaves that template alone', {
	skip,
}, async () => {
	await withTwoWgs(async ({ database, wgId, member, otherWgId, stranger }) => {
		const due = new Date('2026-03-01T12:00:00.000Z');
		const template = async (wg: string, by: string) => {
			const [row] = await database
				.insert(schema.recurringExpenses)
				.values({
					wgId: wg,
					createdByMemberId: by,
					paidByMemberId: by,
					description: 'Rent',
					amountCents: 200,
					nextDueAt: due,
					anchorAt: due,
					splitsJson: JSON.stringify([{ debtorMemberId: by, amountCents: 200 }]),
					category: 'housing',
				})
				.returning();
			assert.ok(row);
			return row;
		};
		const unbooked = await template(otherWgId, stranger);
		const booked = await template(otherWgId, stranger);
		await database.insert(schema.expenses).values({
			wgId: otherWgId,
			paidByMemberId: stranger,
			amountCents: 200,
			description: 'Rent',
			recurringExpenseId: booked.id,
			recurringDueAt: due,
		});
		for (const theirs of [unbooked, booked]) {
			await assert.rejects(
				database.transaction((tx) =>
					writeExpense(tx as unknown as DbTransaction, {
						...expenseInput(wgId, member, member),
						recurring: { id: theirs.id, expectedDueAt: due },
					}),
				),
				{ code: 'recurring_expense_not_found' },
			);
			const [after] = await database
				.select()
				.from(schema.recurringExpenses)
				.where(eq(schema.recurringExpenses.id, theirs.id));
			assert.equal(after?.nextDueAt.getTime(), due.getTime());
		}
		assert.equal(await expenseCount(database, wgId), 0);
		assert.equal(await expenseCount(database, otherWgId), 1);
	});
});

test('a booked recurring charge keeps the category of its template', { skip }, async () => {
	await withTwoWgs(async ({ database, wgId, member }) => {
		const due = new Date('2026-03-01T12:00:00.000Z');
		const [mine] = await database
			.insert(schema.recurringExpenses)
			.values({
				wgId,
				createdByMemberId: member,
				paidByMemberId: member,
				description: 'Rent',
				amountCents: 200,
				nextDueAt: due,
				anchorAt: due,
				splitsJson: JSON.stringify([{ debtorMemberId: member, amountCents: 200 }]),
				category: 'housing',
			})
			.returning();
		assert.ok(mine);
		const outcome = await database.transaction((tx) =>
			writeExpense(tx as unknown as DbTransaction, {
				...expenseInput(wgId, member, member),
				recurring: { id: mine.id, expectedDueAt: due },
			}),
		);
		assert.equal(outcome.status, 200);
		const [stored] = await database
			.select()
			.from(schema.expenses)
			.where(eq(schema.expenses.wgId, wgId));
		assert.equal(stored?.category, 'housing');
		assert.equal(stored?.recurringExpenseId, mine.id);
	});
});

test('undoImport refuses another flat and an admin of another flat, then removes the import', {
	skip,
}, async () => {
	const { undoImport } = await import('../src/features/expenses/server/import-undo.ts');
	await withTwoWgs(async ({ database, wgId, member, otherWgId, stranger, strangerAdmin }) => {
		const [imp] = await database
			.insert(schema.expenseImports)
			.values({
				wgId,
				source: 'splitwise_csv',
				importedByMemberId: member,
				rowCountTotal: 1,
				rawPayloadHash: 'hash',
				memberMapping: {},
			})
			.returning({ id: schema.expenseImports.id });
		assert.ok(imp);
		await database.insert(schema.expenses).values({
			wgId,
			paidByMemberId: member,
			amountCents: 100,
			description: 'Imported',
			importId: imp.id,
		});
		const importedCount = async () =>
			(await database.select().from(schema.expenses).where(eq(schema.expenses.importId, imp.id)))
				.length;

		assert.deepEqual(await undoImport(otherWgId, imp.id, { memberId: stranger, name: 'B' }), {
			ok: false,
			error: 'import_not_found',
		});
		assert.deepEqual(await undoImport(wgId, imp.id, { memberId: strangerAdmin, name: 'Admin B' }), {
			ok: false,
			error: 'not_allowed',
		});
		assert.equal(await importedCount(), 1);

		const done = await undoImport(wgId, imp.id, { memberId: member, name: 'Member A' });
		assert.ok(done.ok);
		assert.equal(done.removed, 1);
		assert.equal(await importedCount(), 0);
		const [audit] = await database
			.select()
			.from(schema.auditEvents)
			.where(eq(schema.auditEvents.wgId, wgId));
		assert.equal(audit?.eventType, 'import.undone');
		assert.equal(JSON.parse(audit?.metadataJson ?? '{}').removed, 1);
	});
});
