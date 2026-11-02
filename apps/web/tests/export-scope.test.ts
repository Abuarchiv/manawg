import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';

// Export of one flat against a real PostgreSQL that also holds a second flat. Opt-in: TEST_DATABASE_URL
// must name a disposable loopback database with all migrations applied (`pnpm test:db`).
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

test('the export of one flat holds only its own rows, newest first and paged', {
	skip,
}, async () => {
	const { buildSectionLoaders, countExportSections } = await import(
		'../src/composition/export-queries.ts'
	);
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const suffix = randomUUID().replaceAll('-', '');
	const wgIds: string[] = [];
	try {
		const flats: Array<{ wgId: string; a: string; b: string }> = [];
		for (const n of [0, 1]) {
			const [wg] = await database
				.insert(schema.wgs)
				.values({ shareCode: `X${n}${suffix.slice(0, 6)}`, name: `Export ${n}` })
				.returning({ id: schema.wgs.id });
			assert.ok(wg);
			wgIds.push(wg.id);
			const [a, b] = await database
				.insert(schema.wgMembers)
				.values([
					{ wgId: wg.id, name: `A${n}` },
					{ wgId: wg.id, name: `B${n}` },
				])
				.returning({ id: schema.wgMembers.id });
			assert.ok(a && b);
			flats.push({ wgId: wg.id, a: a.id, b: b.id });
		}
		const [mine, other] = flats;
		assert.ok(mine && other);
		for (const [flat, descriptions] of [
			[mine, ['old', 'new']],
			[other, ['foreign']],
		] as const) {
			for (const [i, description] of descriptions.entries()) {
				const [expense] = await database
					.insert(schema.expenses)
					.values({
						wgId: flat.wgId,
						paidByMemberId: flat.a,
						amountCents: 1000,
						description,
						occurredAt: new Date(Date.UTC(2026, 0, 10 + i * 10)),
					})
					.returning();
				assert.ok(expense);
				await database
					.insert(schema.expenseSplits)
					.values({ expenseId: expense.id, debtorMemberId: flat.b, amountCents: 1000 });
			}
			await database.insert(schema.expensePayments).values([
				{
					wgId: flat.wgId,
					fromMemberId: flat.b,
					toMemberId: flat.a,
					amountCents: 500,
					status: 'completed',
					completedAt: new Date(),
				},
				{
					wgId: flat.wgId,
					fromMemberId: flat.b,
					toMemberId: flat.a,
					amountCents: 700,
					status: 'voided',
					completedAt: new Date(),
				},
			]);
			const due = new Date('2026-03-01T12:00:00.000Z');
			await database.insert(schema.recurringExpenses).values({
				wgId: flat.wgId,
				createdByMemberId: flat.a,
				paidByMemberId: flat.a,
				description: `rent ${flat.wgId}`,
				amountCents: 100,
				nextDueAt: due,
				anchorAt: due,
				splitsJson: '[]',
			});
			await database
				.insert(schema.announcements)
				.values({ wgId: flat.wgId, authorMemberId: flat.a, content: `post ${flat.wgId}` });
			await database.insert(schema.wgChatMessages).values({
				wgId: flat.wgId,
				senderMemberId: flat.a,
				kind: 'text',
				body: `chat ${flat.wgId}`,
			});
		}
		const names = async () =>
			new Map([
				[mine.a, 'A0'],
				[mine.b, 'B0'],
			]);
		const load = (page = { limit: Number.MAX_SAFE_INTEGER, offset: 0 }) =>
			buildSectionLoaders(mine.wgId, page, names, 'de');

		const expenses = await load().expenses();
		assert.deepEqual(
			expenses.map((r) => r.description),
			['new', 'old'],
		);
		const newest = expenses[0] as { splits: Array<{ debtor: string }> };
		assert.deepEqual(
			newest.splits.map((s) => s.debtor),
			['B0'],
		);
		assert.equal(expenses[0]?.paidBy, 'A0');
		assert.equal(expenses[0]?.imageUrl, '');
		assert.deepEqual(
			(await load({ limit: 1, offset: 1 }).expenses()).map((r) => r.description),
			['old'],
		);
		assert.equal((await load().expensePayments()).length, 1);
		assert.equal((await load().recurringExpenses()).length, 1);
		assert.deepEqual((await load().members()).map((r) => r.name).sort(), ['A0', 'B0']);
		assert.deepEqual(
			(await load().announcements()).map((r) => r.content),
			[`post ${mine.wgId}`],
		);
		assert.deepEqual(
			(await load().chatMessages()).map((r) => r.body),
			[`chat ${mine.wgId}`],
		);

		const counts = await countExportSections(mine.wgId);
		assert.equal(counts.expenses, 2);
		assert.equal(counts.expensePayments, 1);
		assert.equal(counts.recurringExpenses, 1);
		assert.equal(counts.members, 2);
		assert.equal(counts.announcements, 1);
		assert.equal(counts.chatMessages, 1);
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
});
