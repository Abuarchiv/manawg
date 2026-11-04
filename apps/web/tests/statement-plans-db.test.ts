import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';

// The statement loader against a real PostgreSQL: what it reads from the expense rows ends up in
// the statement mail and PDF. Opt-in: TEST_DATABASE_URL must name a disposable loopback database
// with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

process.env.MEMBER_SESSION_SECRET = 'test-secret';
if (url) {
	// The tests delete the WGs they create; never point them at a non-local database.
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
}

// Every member with an account has a confirmed address derived from the Auth user id.
mock.module('@/core/auth/auth-user-emails', {
	namedExports: {
		loadConfirmedEmails: async (ids: readonly string[]) => ({
			emails: new Map(ids.map((id) => [id, `${id}@example.org`])),
			locales: new Map(),
			unresolved: new Set<string>(),
		}),
	},
});

type Deps = {
	db: typeof import('../src/core/db/index.ts').db;
	expenses: typeof import('../src/core/db/index.ts').expenses;
	expenseSplits: typeof import('../src/core/db/index.ts').expenseSplits;
	wgMembers: typeof import('../src/core/db/index.ts').wgMembers;
	wgs: typeof import('../src/core/db/index.ts').wgs;
	load: typeof import('../src/features/expenses/server/statement-plans.ts').loadStatementPlans;
	eq: typeof import('drizzle-orm').eq;
};
let d: Deps;
const wgIds: string[] = [];

before(async () => {
	if (!url) return;
	const core = await import('../src/core/db/index.ts');
	const orm = await import('drizzle-orm');
	const plans = await import('../src/features/expenses/server/statement-plans.ts');
	d = {
		db: core.db,
		expenses: core.expenses,
		expenseSplits: core.expenseSplits,
		wgMembers: core.wgMembers,
		wgs: core.wgs,
		load: plans.loadStatementPlans,
		eq: orm.eq,
	};
});

after(async () => {
	if (!url) return;
	// Expenses reference their payer with `restrict`, so the WG goes first and cascades.
	for (const id of wgIds) await d.db.delete(d.wgs).where(d.eq(d.wgs.id, id));
	// The node test runner exits once the file is done; the lazy pool needs no explicit close.
});

/** A WG of two account members and one even-split 60,00 EUR expense on 2026-09-15. */
async function setup(category: string) {
	const [wg] = await d.db
		.insert(d.wgs)
		.values({ name: 'Testhaus', shareCode: randomUUID().replaceAll('-', '').slice(0, 8) })
		.returning();
	assert.ok(wg);
	wgIds.push(wg.id);
	const [anna, ben] = await d.db
		.insert(d.wgMembers)
		.values([
			{ wgId: wg.id, name: 'Anna', authUserId: randomUUID() },
			{ wgId: wg.id, name: 'Ben', authUserId: randomUUID() },
		])
		.returning();
	assert.ok(anna && ben);
	const [expense] = await d.db
		.insert(d.expenses)
		.values({
			wgId: wg.id,
			paidByMemberId: anna.id,
			amountCents: 6000,
			currency: 'EUR',
			description: 'Wocheneinkauf',
			category,
			occurredAt: new Date('2026-09-15T12:00:00Z'),
		})
		.returning();
	assert.ok(expense);
	await d.db.insert(d.expenseSplits).values([
		{ expenseId: expense.id, debtorMemberId: anna.id, amountCents: 3000 },
		{ expenseId: expense.id, debtorMemberId: ben.id, amountCents: 3000 },
	]);
	return wg;
}

test('the loader keeps the expense category in the statement', { skip }, async () => {
	const wg = await setup('groceries');
	const plans = await d.load('2026-09');
	const plan = plans.find((entry) => entry.wg.id === wg.id);
	assert.ok(plan);
	assert.equal(plan.plan.recipients.length, 2);
	for (const recipient of plan.plan.recipients) {
		assert.deepEqual(recipient.statement.categories, [
			{ category: 'groceries', cents: 6000, share: 100 },
		]);
	}
});
