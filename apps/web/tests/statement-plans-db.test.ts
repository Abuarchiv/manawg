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

// Every member with an account has a confirmed address derived from the Auth user id, except the
// ones a test lists in `failingLookups`. `lookups` records the Auth user ids the loader asks for.
const lookups: string[] = [];
const failingLookups = new Set<string>();
mock.module('@/core/auth/auth-user-emails', {
	namedExports: {
		loadConfirmedEmails: async (ids: readonly string[]) => {
			lookups.push(...ids);
			return {
				emails: new Map(
					ids.filter((id) => !failingLookups.has(id)).map((id) => [id, `${id}@example.org`]),
				),
				locales: new Map(),
				unresolved: new Set(ids.filter((id) => failingLookups.has(id))),
			};
		},
	},
});

type Deps = {
	db: typeof import('../src/core/db/index.ts').db;
	expenses: typeof import('../src/core/db/index.ts').expenses;
	expenseSplits: typeof import('../src/core/db/index.ts').expenseSplits;
	expensePayments: typeof import('../src/core/db/index.ts').expensePayments;
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
		expensePayments: core.expensePayments,
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

type MemberSeed = Partial<typeof import('../src/core/db/index.ts').wgMembers.$inferInsert> & {
	name: string;
};
const anna = (): MemberSeed => ({ name: 'Anna', authUserId: randomUUID() });
const ben = (): MemberSeed => ({ name: 'Ben', authUserId: randomUUID() });

/**
 * A WG with an even-split 60,00 EUR expense paid by its first member. The members default to Anna
 * and Ben, both with an account; the expense defaults to 2026-09-15.
 */
async function setup(
	category: string,
	options: { members?: MemberSeed[]; occurredAt?: string } = {},
) {
	const [wg] = await d.db
		.insert(d.wgs)
		.values({ name: 'Testhaus', shareCode: randomUUID().replaceAll('-', '').slice(0, 8) })
		.returning();
	assert.ok(wg);
	wgIds.push(wg.id);
	const members = await d.db
		.insert(d.wgMembers)
		.values((options.members ?? [anna(), ben()]).map((member) => ({ ...member, wgId: wg.id })))
		.returning();
	const [payer] = members;
	assert.ok(payer);
	const [expense] = await d.db
		.insert(d.expenses)
		.values({
			wgId: wg.id,
			paidByMemberId: payer.id,
			amountCents: 6000,
			currency: 'EUR',
			description: 'Wocheneinkauf',
			category,
			occurredAt: new Date(options.occurredAt ?? '2026-09-15T12:00:00Z'),
		})
		.returning();
	assert.ok(expense);
	await d.db.insert(d.expenseSplits).values(
		members.map((member) => ({
			expenseId: expense.id,
			debtorMemberId: member.id,
			amountCents: 6000 / members.length,
		})),
	);
	return { wg, members };
}

/** The plan of one WG in a month's load, or undefined when the loader skips the WG. */
async function planOf(monthKey: string, wgId: string) {
	const plans = await d.load(monthKey);
	return plans.find((entry) => entry.wg.id === wgId)?.plan;
}

test('the loader keeps the expense category in the statement', { skip }, async () => {
	const { wg } = await setup('groceries');
	const plan = await planOf('2026-09', wg.id);
	assert.ok(plan);
	assert.equal(plan.recipients.length, 2);
	for (const recipient of plan.recipients) {
		assert.deepEqual(recipient.statement.categories, [
			{ category: 'groceries', cents: 6000, share: 100 },
		]);
	}
});

test('an expense on the Berlin side of a month edge belongs to that month', { skip }, async () => {
	// 22:30 UTC on 30 September is 00:30 on 1 October in Berlin.
	const { wg } = await setup('other', { occurredAt: '2026-09-30T22:30:00Z' });
	const plan = await planOf('2026-10', wg.id);
	assert.ok(plan);
	assert.equal(plan.recipients.length, 2);
	for (const recipient of plan.recipients) {
		assert.equal(recipient.statement.monthKey, '2026-10');
		assert.equal(recipient.statement.totalCents, 6000);
	}
});

test('an expense late in the month belongs to that month', { skip }, async () => {
	// 22:30 UTC on 31 October is 23:30 in Berlin.
	const { wg } = await setup('other', { occurredAt: '2026-10-31T22:30:00Z' });
	const plan = await planOf('2026-10', wg.id);
	assert.ok(plan);
	assert.equal(plan.recipients.length, 2);
});

test('a WG without an expense in the month is not loaded', { skip }, async () => {
	const { wg } = await setup('other', { occurredAt: '2026-09-15T12:00:00Z' });
	assert.equal(await planOf('2026-10', wg.id), undefined);
	assert.equal(await planOf('2026-08', wg.id), undefined);
});

test('only completed payments offset the open balance', { skip }, async () => {
	const { wg, members } = await setup('other');
	const [payer, debtor] = members;
	assert.ok(payer && debtor);
	const payment = (status: string) => ({
		wgId: wg.id,
		fromMemberId: debtor.id,
		toMemberId: payer.id,
		amountCents: 3000,
		currency: 'EUR',
		status,
		completedAt: status === 'completed' ? new Date('2026-09-20T12:00:00Z') : null,
	});

	await d.db.insert(d.expensePayments).values(payment('voided'));
	const open = await planOf('2026-09', wg.id);
	assert.ok(open);
	const owed = open.recipients[0]?.statement;
	assert.equal(owed?.settled, false);
	assert.deepEqual(
		owed?.open.map((row) => [row.name, row.cents]),
		[
			['Anna', 3000],
			['Ben', -3000],
		],
	);

	await d.db.insert(d.expensePayments).values(payment('completed'));
	const settled = await planOf('2026-09', wg.id);
	assert.ok(settled);
	assert.equal(settled.recipients[0]?.statement.settled, true);
	assert.deepEqual(settled.recipients[0]?.statement.open, []);
});

test('only active, opted-in members with an account are looked up', { skip }, async () => {
	const accountless: MemberSeed = { name: 'Dora', authUserId: null };
	const members = [
		anna(),
		{ ...ben(), deactivatedAt: new Date('2026-09-20T12:00:00Z') },
		{ name: 'Carl', authUserId: randomUUID(), notifyStatementEmail: false },
		accountless,
		{ name: 'Eve', authUserId: randomUUID() },
	];
	const { wg, members: rows } = await setup('other', { members });
	const byName = new Map(rows.map((row) => [row.name, row]));
	lookups.length = 0;
	const plan = await d.load('2026-09').then((plans) => plans.find((p) => p.wg.id === wg.id)?.plan);
	assert.ok(plan);

	const asked = (name: string) => lookups.includes(byName.get(name)?.authUserId ?? 'none');
	assert.deepEqual(['Anna', 'Ben', 'Carl', 'Dora', 'Eve'].map(asked), [
		true,
		false,
		false,
		false,
		true,
	]);
	assert.deepEqual(plan.recipients.map((r) => r.name).sort(), ['Anna', 'Eve']);
	const skipped = plan.skipped.map((s) => [rows.find((r) => r.id === s.memberId)?.name, s.reason]);
	assert.deepEqual(skipped.sort(), [
		['Ben', 'inactive'],
		['Carl', 'opted_out'],
		['Dora', 'no_email'],
	]);
});

test('a member whose Auth lookup fails is left for a later run', { skip }, async () => {
	const { wg, members } = await setup('other');
	const failing = members[1]?.authUserId;
	assert.ok(failing);
	failingLookups.add(failing);
	const warn = mock.method(console, 'warn', () => {});
	try {
		const plan = await planOf('2026-09', wg.id);
		assert.ok(plan);
		assert.deepEqual(
			plan.recipients.map((r) => r.name),
			['Anna'],
		);
		assert.deepEqual(plan.skipped, []);
		assert.ok(
			warn.mock.calls.some((call) => String(call.arguments[0]).includes('Auth lookups failed')),
		);
	} finally {
		warn.mock.restore();
		failingLookups.delete(failing);
	}
});

test('each recipient gets the language the member stored', { skip }, async () => {
	const { wg } = await setup('other', { members: [anna(), { ...ben(), locale: 'en' }] });
	const plan = await planOf('2026-09', wg.id);
	assert.ok(plan);
	assert.deepEqual(plan.recipients.map((r) => [r.name, r.locale]).sort(), [
		['Anna', 'de'],
		['Ben', 'en'],
	]);
});
