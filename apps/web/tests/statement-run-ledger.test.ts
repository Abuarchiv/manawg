import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// Ledger behaviour of the monthly statement run against a real PostgreSQL.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all migrations
// applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

process.env.MEMBER_SESSION_SECRET = 'test-secret';
if (url) {
	// The ledger tests delete the WGs they create; never point them at a non-local database.
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
}

type Unsubscribe = typeof import('../src/features/expenses/server/statement-unsubscribe.ts');
type Deps = {
	db: typeof import('../src/core/db/index.ts').db;
	statementEmails: typeof import('../src/core/db/index.ts').statementEmails;
	wgMembers: typeof import('../src/core/db/index.ts').wgMembers;
	wgs: typeof import('../src/core/db/index.ts').wgs;
	run: typeof import('../src/features/expenses/server/statement-run.ts').runStatementPlans;
	eq: typeof import('drizzle-orm').eq;
	disable: Unsubscribe['disableStatementEmail'];
};
let d: Deps;
const wgIds: string[] = [];

before(async () => {
	if (!url) return;
	const core = await import('../src/core/db/index.ts');
	const orm = await import('drizzle-orm');
	const unsubscribe = await import('../src/features/expenses/server/statement-unsubscribe.ts');
	const runModule = await import('../src/features/expenses/server/statement-run.ts');
	d = {
		db: core.db,
		statementEmails: core.statementEmails,
		wgMembers: core.wgMembers,
		wgs: core.wgs,
		run: runModule.runStatementPlans,
		eq: orm.eq,
		disable: unsubscribe.disableStatementEmail,
	};
});

after(async () => {
	if (!url) return;
	for (const id of wgIds) await d.db.delete(d.wgs).where(d.eq(d.wgs.id, id));
	// The node test runner exits once the file is done; the lazy pool needs no explicit close.
});

type Transport = import('../src/features/expenses/server/statement-transport.ts').MailTransport;
type Outcome = import('../src/features/expenses/server/statement-transport.ts').MailOutcome;

function transport(outcome: (to: string) => Outcome, name: Transport['name'] = 'resend') {
	const sent: string[] = [];
	const fake: Transport = {
		name,
		async sendBatch(mails) {
			sent.push(...mails.map((mail) => mail.to));
			return mails.map((mail) => outcome(mail.to));
		},
	};
	return { fake, sent };
}

const ok = (): Outcome => ({ kind: 'sent', providerId: 'p' });

async function setup(mailCount: number) {
	const [wg] = await d.db
		.insert(d.wgs)
		.values({ name: 'Testhaus', shareCode: Math.random().toString(36).slice(2, 10).toUpperCase() })
		.returning();
	assert.ok(wg);
	wgIds.push(wg.id);
	const members = await d.db
		.insert(d.wgMembers)
		.values(Array.from({ length: mailCount }, (_, i) => ({ wgId: wg.id, name: `M${i}` })))
		.returning();
	const statement = {
		monthKey: '2026-09',
		totalCents: 1000,
		items: [],
		members: [],
		transfers: [],
		settled: true,
		categories: [],
	};
	const recipient = (index: number) => ({
		memberId: members[index]?.id ?? '',
		name: `M${index}`,
		email: `m${index}@example.org`,
		statement,
	});
	const plan = (recipients: number[], skipped: number[] = []) => [
		{
			wg: { id: wg.id, name: wg.name, shareCode: wg.shareCode },
			plan: {
				recipients: recipients.map(recipient),
				skipped: skipped.map((i) => ({
					memberId: members[i]?.id ?? '',
					reason: 'no_email' as const,
				})),
			},
		},
	];
	const rows = () =>
		d.db.select().from(d.statementEmails).where(d.eq(d.statementEmails.wgId, wg.id));
	return { plan, rows, members };
}

test('a second invocation sends nothing again', { skip }, async () => {
	const { plan, rows } = await setup(2);
	const first = transport(ok);
	const one = await d.run(plan([0, 1]), '2026-09', first.fake);
	assert.equal(one.sent, 2);
	const second = transport(ok);
	const two = await d.run(plan([0, 1]), '2026-09', second.fake);
	assert.equal(two.sent, 0);
	assert.deepEqual(second.sent, []);
	assert.deepEqual(
		(await rows()).map((row) => [row.status, row.attempts]),
		[
			['sent', 1],
			['sent', 1],
		],
	);
});

test('failed rows are retried, unconfirmed ones never', { skip }, async () => {
	const { plan, rows } = await setup(2);
	const flaky = transport((to) =>
		to.startsWith('m0')
			? { kind: 'failed', error: 'http_500' }
			: { kind: 'failed', error: 'timeout', unconfirmed: true },
	);
	const one = await d.run(plan([0, 1]), '2026-09', flaky.fake);
	assert.deepEqual([one.failed, one.unconfirmed], [2, 1]);
	const retry = transport(ok);
	const two = await d.run(plan([0, 1]), '2026-09', retry.fake);
	assert.deepEqual(retry.sent, ['m0@example.org']);
	assert.equal(two.sent, 1);
	const byAttempts = Object.fromEntries((await rows()).map((row) => [row.status, row.attempts]));
	assert.deepEqual(byAttempts, { sent: 2, failed: 5 });
});

test('a skipped member who becomes a recipient is mailed on a later run', { skip }, async () => {
	const { plan, rows } = await setup(2);
	const first = transport(ok);
	const one = await d.run(plan([0], [1]), '2026-09', first.fake);
	assert.deepEqual([one.queued, one.skipped, one.sent], [1, 1, 1]);
	const second = transport(ok);
	await d.run(plan([0, 1]), '2026-09', second.fake);
	assert.deepEqual(second.sent, ['m1@example.org']);
	assert.deepEqual(
		(await rows()).map((row) => row.status),
		['sent', 'sent'],
	);
});

test('rows left sending by a dead run are closed, not resent', { skip }, async () => {
	const { plan, rows } = await setup(2);
	await d.run(plan([0, 1]), '2026-09', transport(() => ({ kind: 'deferred' })).fake);
	const open = await rows();
	assert.deepEqual(
		open.map((row) => [row.status, row.attempts]),
		[
			['pending', 0],
			['pending', 0],
		],
	);
	const [stale, fresh] = open;
	assert.ok(stale && fresh);
	const sending = (id: string, minutesAgo: number) =>
		d.db
			.update(d.statementEmails)
			.set({
				status: 'sending',
				attempts: 1,
				claimedAt: new Date(Date.now() - minutesAgo * 60_000),
			})
			.where(d.eq(d.statementEmails.id, id));
	await sending(stale.id, 60);
	await sending(fresh.id, 1);
	const after = transport(ok);
	const summary = await d.run(plan([0, 1]), '2026-09', after.fake);
	assert.deepEqual(after.sent, []);
	assert.equal(summary.unconfirmed, 1);
	const states = Object.fromEntries((await rows()).map((row) => [row.id, row.status]));
	assert.deepEqual(states, { [stale.id]: 'failed', [fresh.id]: 'sending' });
});

test('the dry-run transport leaves the ledger empty', { skip }, async () => {
	const { plan, rows } = await setup(2);
	const dry = transport(ok, 'dry-run');
	const summary = await d.run(plan([0, 1]), '2026-09', dry.fake);
	assert.equal(summary.sent, 0);
	assert.equal(dry.sent.length, 2);
	assert.deepEqual(await rows(), []);
});

test('one-click unsubscribe switches off every membership of the account', { skip }, async () => {
	const [{ members: one }, { members: two }] = [await setup(1), await setup(1)];
	const account = crypto.randomUUID();
	const [first, second] = [one[0], two[0]];
	assert.ok(first && second);
	for (const member of [first, second]) {
		await d.db
			.update(d.wgMembers)
			.set({ authUserId: account })
			.where(d.eq(d.wgMembers.id, member.id));
	}
	await d.disable(first.id);
	const flags = await d.db.select().from(d.wgMembers).where(d.eq(d.wgMembers.authUserId, account));
	assert.deepEqual(
		flags.map((row) => row.notifyStatementEmail),
		[false, false],
	);
});
