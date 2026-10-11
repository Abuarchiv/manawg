import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const harness = {
	selects: [] as unknown[][],
	sends: [] as string[],
	results: [] as string[],
	gaps: 0,
};

// Every query builder step returns the same chain; awaiting it yields the next scripted result.
const chain: Record<string, unknown> = new Proxy(
	{},
	{
		get: (_target, prop) =>
			prop === 'then'
				? (resolve: (rows: unknown[]) => void) => resolve(harness.selects.shift() ?? [])
				: () => chain,
	},
);

const noop = () => {};
mock.module('drizzle-orm', {
	namedExports: {
		and: noop,
		asc: noop,
		eq: noop,
		gte: noop,
		inArray: noop,
		isNull: noop,
		lte: noop,
		or: noop,
		sql: noop,
	},
});
mock.module('@/core/db', {
	namedExports: {
		chores: {},
		db: { select: () => chain },
		expenses: {},
		wgEvents: {},
		wgInventoryItems: {},
		wgMembers: {},
		wgs: {},
	},
});
mock.module('@/core/auth/auth-user-emails', {
	namedExports: {
		loadConfirmedEmails: async () => ({
			emails: new Map([
				['u1', 'a@example.test'],
				['u2', 'b@example.test'],
				['u3', 'c@example.test'],
			]),
		}),
	},
});
mock.module('@/core/infra/observability', { namedExports: { logApiError() {} } });
mock.module('@/core/mail/transport', { namedExports: { SINGLE_SEND_GAP_MS: 5 } });
mock.module('@/core/mail/unsubscribe', { namedExports: { unsubscribeUrl: () => 'u' } });
mock.module('@/core/mail/templates', {
	namedExports: { renderDigestMail: () => ({ subject: 's', html: 'h', text: 't' }) },
});
mock.module('@/core/mail/send-mail', {
	namedExports: {
		sendMail: async ({ dedupeKey }: { dedupeKey: string }) => {
			harness.sends.push(dedupeKey);
			return harness.results.shift() ?? 'sent';
		},
	},
});
mock.module('@/features/events/events', { namedExports: { expandRecurrence: () => [] } });

const { runDailyDigest } = (await import('../src/composition/daily-digest.ts')) as unknown as {
	runDailyDigest: (now?: Date) => Promise<Record<string, unknown>>;
};

function script() {
	const member = (id: string, authUserId: string) => ({
		id,
		authUserId,
		notifyChores: true,
		notifyExpenses: true,
		notifyEvents: true,
		notifyInventory: true,
		wgId: 'wg-1',
		wgName: 'WG',
		shareCode: 'ABCD2345',
	});
	harness.selects = [
		[member('m1', 'u1'), member('m2', 'u2'), member('m3', 'u3')],
		[{ wgId: 'wg-1', title: 'Bad putzen', assignee: null, dueAt: new Date() }],
		[],
		[],
		[],
	];
	harness.sends = [];
}

test('digest stops at the first quota refusal and counts it as deferred, not failed', async () => {
	script();
	harness.results = ['sent', 'deferred', 'sent'];
	const summary = await runDailyDigest(new Date('2026-10-12T05:00:00Z'));
	assert.equal(harness.sends.length, 2);
	assert.equal(summary.sent, 1);
	assert.equal(summary.deferred, 1);
	assert.equal(summary.failed, 0);
});

test('digest sends with a gap between provider calls', async () => {
	script();
	harness.results = [];
	const started = Date.now();
	const summary = await runDailyDigest(new Date('2026-10-12T05:00:00Z'));
	assert.equal(summary.sent, 3);
	assert.ok(Date.now() - started >= 3 * 5 - 2);
});
