import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';

// Guards of the statement ledger and run loop against a real PostgreSQL: persistent skips,
// interrupted-row closing, the claim cap, dispatch errors, the quota stop and the allow-list.
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

type Deps = {
	db: typeof import('../src/core/db/index.ts').db;
	statementEmails: typeof import('../src/core/db/index.ts').statementEmails;
	wgMembers: typeof import('../src/core/db/index.ts').wgMembers;
	wgs: typeof import('../src/core/db/index.ts').wgs;
	run: typeof import('../src/features/expenses/server/statement-run.ts').runStatementPlans;
	eq: typeof import('drizzle-orm').eq;
};
let d: Deps;
// A month no other DB test uses: runs claim open rows of the whole month across WGs.
const MONTH = '2026-06';
const wgIds: string[] = [];

before(async () => {
	if (!url) return;
	const core = await import('../src/core/db/index.ts');
	const orm = await import('drizzle-orm');
	const runModule = await import('../src/features/expenses/server/statement-run.ts');
	d = {
		db: core.db,
		statementEmails: core.statementEmails,
		wgMembers: core.wgMembers,
		wgs: core.wgs,
		run: runModule.runStatementPlans,
		eq: orm.eq,
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
	const statementFor = (monthKey: string) => ({
		monthKey,
		totalCents: 1000,
		items: [],
		members: [],
		open: [],
		transfers: [],
		settled: true,
		asOf: '2026-10-02T08:00:00Z',
		categories: [],
	});
	const recipient = (index: number, monthKey: string) => ({
		memberId: members[index]?.id ?? '',
		name: `M${index}`,
		email: `m${index}@example.org`,
		statement: statementFor(monthKey),
	});
	const plan = (recipients: number[], skipped: number[] = [], monthKey = MONTH) => [
		{
			wg: { id: wg.id, name: wg.name, shareCode: wg.shareCode },
			plan: {
				recipients: recipients.map((index) => recipient(index, monthKey)),
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

const deferAll = (sizes: number[] = []): Transport => ({
	name: 'resend',
	async sendBatch(mails) {
		sizes.push(mails.length);
		return mails.map(() => ({ kind: 'deferred' as const }));
	},
});

test('a member who stays skipped does not break the next daily run', { skip }, async () => {
	const { plan, rows } = await setup(2);
	const one = await d.run(plan([0], [1]), MONTH, transport(ok).fake);
	assert.deepEqual([one.queued, one.skipped, one.sent], [1, 1, 1]);
	const two = await d.run(plan([0], [1]), MONTH, transport(ok).fake);
	assert.deepEqual([two.queued, two.skipped, two.sent], [0, 0, 0]);
	assert.deepEqual((await rows()).map((row) => row.status).sort(), ['sent', 'skipped']);
});

test('closing interrupted rows leaves old sent and retryable failed rows alone', {
	skip,
}, async () => {
	const { plan, rows } = await setup(3);
	await d.run(
		plan([0, 1, 2]),
		MONTH,
		transport((to) => {
			if (to.startsWith('m0')) return ok();
			return to.startsWith('m1') ? { kind: 'failed', error: 'http_500' } : { kind: 'deferred' };
		}).fake,
	);
	const [sent, failed, stale] = await rows();
	assert.ok(sent && failed && stale);
	assert.deepEqual([sent.status, failed.status, stale.status], ['sent', 'failed', 'pending']);
	const longAgo = new Date(Date.now() - 24 * 3600_000);
	await d.db
		.update(d.statementEmails)
		.set({ claimedAt: longAgo })
		.where(d.eq(d.statementEmails.wgId, sent.wgId));
	await d.db
		.update(d.statementEmails)
		.set({ status: 'sending', attempts: 1 })
		.where(d.eq(d.statementEmails.id, stale.id));
	const retry = transport(ok);
	const summary = await d.run(plan([0, 1, 2]), MONTH, retry.fake);
	assert.equal(summary.unconfirmed, 1);
	assert.deepEqual(retry.sent, ['m1@example.org']);
	const byId = Object.fromEntries(
		(await rows()).map((row) => [row.id, [row.status, row.error, row.attempts]]),
	);
	assert.deepEqual(byId, {
		[sent.id]: ['sent', null, 1],
		[failed.id]: ['sent', null, 2],
		[stale.id]: ['failed', 'interrupted_unconfirmed', 5],
	});
});

test('a claim batch holds at most 100 rows and a deferred batch stops the run', {
	skip,
}, async () => {
	const { plan, rows } = await setup(101);
	const sizes: number[] = [];
	const everyone = Array.from({ length: 101 }, (_, i) => i);
	const summary = await d.run(plan(everyone), MONTH, deferAll(sizes));
	assert.deepEqual(sizes, [100]);
	assert.equal(summary.quotaReached, true);
	assert.equal((await rows()).filter((row) => row.status === 'pending').length, 101);
});

test('a transport that throws leaves failed, retryable rows', { skip }, async () => {
	const { plan, rows } = await setup(1);
	const boom: Transport = {
		name: 'resend',
		async sendBatch() {
			throw new Error('boom');
		},
	};
	await assert.rejects(d.run(plan([0]), MONTH, boom));
	assert.deepEqual(
		(await rows()).map((row) => [row.status, row.error, row.attempts]),
		[['failed', 'dispatch_error', 1]],
	);
	const again = transport(ok);
	await d.run(plan([0]), MONTH, again.fake);
	assert.deepEqual(again.sent, ['m0@example.org']);
});

test('the allow-list keeps other members out of the ledger', { skip }, async () => {
	const { plan, rows } = await setup(2);
	process.env.STATEMENT_EMAIL_ALLOWLIST = 'M0@example.org';
	try {
		const t = transport(ok);
		await d.run(plan([0, 1]), MONTH, t.fake);
		assert.deepEqual(t.sent, ['m0@example.org']);
		assert.deepEqual(
			(await rows()).map((row) => row.status),
			['sent'],
		);
	} finally {
		delete process.env.STATEMENT_EMAIL_ALLOWLIST;
	}
});

afterEach(async () => {
	delete process.env.STATEMENT_EMAIL_ALLOWLIST;
	if (url) await d.db.delete(d.statementEmails).where(d.eq(d.statementEmails.monthKey, MONTH));
});

test('the allow-list never claims an already queued row of another member', { skip }, async () => {
	const { plan, rows, members } = await setup(2);
	const [a, b] = members;
	assert.ok(a && b);
	await d.db
		.insert(d.statementEmails)
		.values({ wgId: b.wgId, memberId: b.id, monthKey: MONTH, status: 'pending' });
	process.env.STATEMENT_EMAIL_ALLOWLIST = 'm0@example.org';
	const t = transport(ok);
	await d.run(plan([0, 1]), MONTH, t.fake);
	assert.deepEqual(t.sent, ['m0@example.org']);
	const byMember = Object.fromEntries(
		(await rows()).map((row) => [row.memberId, [row.status, row.attempts]]),
	);
	assert.deepEqual(byMember, { [a.id]: ['sent', 1], [b.id]: ['pending', 0] });
});

test('an allow-list that matches nobody claims and sends nothing', { skip }, async () => {
	const { plan, rows, members } = await setup(2);
	await d.db.insert(d.statementEmails).values(
		members.map((member) => ({
			wgId: member.wgId,
			memberId: member.id,
			monthKey: MONTH,
			status: 'pending',
		})),
	);
	process.env.STATEMENT_EMAIL_ALLOWLIST = 'nobody@example.org';
	const sizes: number[] = [];
	const summary = await d.run(plan([0, 1]), MONTH, deferAll(sizes));
	assert.deepEqual(sizes, []);
	assert.deepEqual([summary.queued, summary.sent, summary.quotaReached], [0, 0, false]);
	assert.deepEqual(
		(await rows()).map((row) => [row.status, row.attempts]),
		[
			['pending', 0],
			['pending', 0],
		],
	);
});
