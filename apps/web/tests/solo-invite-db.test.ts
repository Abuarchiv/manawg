import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';

// Who gets the one invitation reminder, against a real PostgreSQL: a wrong filter mails people
// who never asked for it. Opt-in: TEST_DATABASE_URL must name a disposable loopback database
// with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

process.env.MEMBER_SESSION_SECRET = 'test-secret';
if (url) {
	// The test deletes the WGs it creates; never point it at a non-local database.
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
}
// No provider configured outside production: the dry-run transport reports every mail as sent.
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;
delete process.env.STATEMENT_EMAIL_ALLOWLIST;
process.env.VERCEL_ENV = 'development';

mock.module('@/core/auth/auth-user-emails', {
	namedExports: {
		loadConfirmedEmails: async (ids: readonly string[]) => ({
			emails: new Map(ids.map((id) => [id, `${id}@example.org`])),
			locales: new Map(),
			unresolved: new Set(),
		}),
	},
});

// The provider answers through a stand-in: `sendsBeforeQuota` mails go out, then it reports the
// daily quota as reached (Resend 429), which the run must stop at.
let sendsBeforeQuota = Number.POSITIVE_INFINITY;
const transport = await import('../src/core/mail/transport.ts');
mock.module('../src/core/mail/transport.ts', {
	namedExports: {
		...transport,
		createMailTransport: () => ({
			name: 'dry-run',
			sendBatch: async (mails: readonly unknown[]) =>
				mails.map(() =>
					sendsBeforeQuota-- > 0 ? { kind: 'sent', providerId: 'test' } : { kind: 'deferred' },
				),
		}),
	},
});

type Core = typeof import('../src/core/db/index.ts');
let core: Core;
let soloInvite: typeof import('../src/core/mail/solo-invite.ts');
let sql: typeof import('drizzle-orm').sql;
const wgIds: string[] = [];
const deletedAccounts: string[] = [];

before(async () => {
	if (!url) return;
	core = await import('../src/core/db/index.ts');
	soloInvite = await import('../src/core/mail/solo-invite.ts');
	sql = (await import('drizzle-orm')).sql;
});

after(async () => {
	if (!url) return;
	for (const id of wgIds) {
		await core.db.execute(sql`delete from mail_log where wg_id = ${id}`);
		await core.db.execute(sql`delete from wgs where id = ${id}`);
	}
	for (const id of deletedAccounts) {
		await core.db.execute(sql`delete from account_deletions where auth_user_id = ${id}`);
	}
});

/** A WG created `hoursAgo`, its admin with an account, and `others` further members. */
async function seed(
	label: string,
	hoursAgo: number,
	options: { others?: number; movedOut?: number; optedOut?: boolean } = {},
): Promise<{ wgId: string; adminAuth: string }> {
	const createdAt = new Date(Date.now() - hoursAgo * 3_600_000);
	const [wg] = await core.db
		.insert(core.wgs)
		.values({ name: label, shareCode: `t${randomUUID().slice(0, 12)}`, createdAt })
		.returning({ id: core.wgs.id });
	assert.ok(wg);
	wgIds.push(wg.id);
	const adminAuth = randomUUID();
	await core.db.insert(core.wgMembers).values({
		wgId: wg.id,
		name: 'Admin',
		role: 'admin',
		authUserId: adminAuth,
		notifyOnboardingEmail: !options.optedOut,
	});
	for (let i = 0; i < (options.others ?? 0) + (options.movedOut ?? 0); i++) {
		await core.db.insert(core.wgMembers).values({
			wgId: wg.id,
			name: `Member ${i}`,
			authUserId: randomUUID(),
			deactivatedAt: i < (options.movedOut ?? 0) ? new Date() : null,
		});
	}
	return { wgId: wg.id, adminAuth };
}

async function mailedWgs(): Promise<Set<string>> {
	const rows = await core.db.execute<{ wg_id: string }>(
		sql`select wg_id from mail_log where kind = 'solo_invite' and status = 'sent'`,
	);
	return new Set(rows.rows.map((row) => row.wg_id).filter((id) => wgIds.includes(id)));
}

test('only WGs still alone 24 to 72 hours after creation get the reminder, once', {
	skip,
}, async () => {
	const due = await seed('due', 30);
	const movedOut = await seed('flatmate moved out', 30, { movedOut: 1 });
	await seed('too new', 10);
	await seed('too old', 80);
	await seed('has a flatmate', 30, { others: 1 });
	await seed('opted out', 30, { optedOut: true });
	const deleting = await seed('account being deleted', 30);
	await core.db.insert(core.accountDeletions).values({ authUserId: deleting.adminAuth });
	deletedAccounts.push(deleting.adminAuth);

	const outOfTime = await soloInvite.sendSoloInviteMails(-1);
	assert.equal(outOfTime.sent, 0);
	assert.ok(outOfTime.deferred >= 2, 'nothing starts once the time budget is spent');
	assert.deepEqual(await mailedWgs(), new Set());

	const first = await soloInvite.sendSoloInviteMails();
	assert.ok(first.sent >= 2);
	assert.deepEqual(await mailedWgs(), new Set([due.wgId, movedOut.wgId]));

	const candidates = await soloInvite.findSoloInviteCandidates(1000);
	assert.deepEqual(
		candidates.filter((row) => wgIds.includes(row.wgId)),
		[],
		'a WG whose reminder went out is not picked again',
	);
});

test('a quota stop leaves the remaining WGs unsent and eligible for the next run', {
	skip,
}, async () => {
	const first = await seed('quota first', 50);
	const deferred = await seed('quota deferred', 49);
	const untouched = await seed('quota untouched', 48);
	const ours = [first.wgId, deferred.wgId, untouched.wgId];
	const eligible = async () =>
		(await soloInvite.findSoloInviteCandidates(1000))
			.map((row) => row.wgId)
			.filter((id) => ours.includes(id));

	sendsBeforeQuota = 1;
	try {
		const run = await soloInvite.sendSoloInviteMails();
		assert.equal(run.sent, 1);
		assert.equal(run.deferred, run.candidates - 1, 'every mail after the quota stop is deferred');
	} finally {
		sendsBeforeQuota = Number.POSITIVE_INFINITY;
	}
	const mailedOfOurs = async () =>
		[...(await mailedWgs())].filter((id) => ours.includes(id)).sort();
	assert.deepEqual(await mailedOfOurs(), [first.wgId]);
	assert.deepEqual(await eligible(), [deferred.wgId, untouched.wgId]);

	const next = await soloInvite.sendSoloInviteMails();
	assert.equal(next.deferred, 0);
	assert.deepEqual(await mailedOfOurs(), [...ours].sort());
	assert.deepEqual(await eligible(), []);
});
