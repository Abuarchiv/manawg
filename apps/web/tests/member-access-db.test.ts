import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NextRequest } from 'next/server';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';

// What a member who moved out can still reach, against a real PostgreSQL: the calendar feed link
// they subscribed to and the "my flats" recovery list. Opt-in like wg-invite-join.test.ts.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async (req: Request) => ({
			id: req.headers.get('x-test-user'),
			email: null,
		}),
		createSupabaseServerClient: () => {
			throw new Error('createSupabaseServerClient must not run');
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '127.0.0.1',
		wgReadLimiter: {},
		wgWriteLimiter: {},
		wgShareCodeMissLimiter: {},
	},
});

async function withFixture(
	run: (f: {
		feed: (subscriptionId: string, token: string) => Promise<Response>;
		mine: (user: string) => Promise<Response>;
		subscribe: (memberId: string, wgId: string) => Promise<{ id: string; token: string }>;
		moveOut: (memberId: string) => Promise<void>;
		wgCode: string;
		wgId: string;
		memberId: string;
		userId: string;
	}) => Promise<void>,
) {
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
	process.env.MEMBER_SESSION_SECRET = 'test-secret-for-calendar-feed-tokens-0123456789';
	const feedRoute = await import('../src/app/api/calendar/[id]/[token]/route.ts');
	const mineRoute = await import('../src/app/api/wg/mine/route.ts');
	const { createCalendarFeedSeed, deriveCalendarFeedToken } = await import(
		'../src/features/events/server/calendar-subscription.ts'
	);
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const wgCode = generateShareCode();
	const [wg] = await database
		.insert(schema.wgs)
		.values({ shareCode: wgCode, name: `Access ${randomUUID()}` })
		.returning({ id: schema.wgs.id });
	assert.ok(wg);
	const userId = randomUUID();
	const [member] = await database
		.insert(schema.wgMembers)
		.values({ wgId: wg.id, name: 'Leaver', role: 'member', authUserId: userId })
		.returning({ id: schema.wgMembers.id });
	assert.ok(member);
	await database
		.insert(schema.wgEvents)
		.values({ wgId: wg.id, title: 'Flat dinner', startsAt: new Date(Date.now() + 86_400_000) });
	try {
		await run({
			wgCode,
			wgId: wg.id,
			memberId: member.id,
			userId,
			feed: (subscriptionId, token) =>
				feedRoute.GET(new NextRequest(`http://localhost/api/calendar/${subscriptionId}/${token}`), {
					params: Promise.resolve({ id: subscriptionId, token }),
				}),
			mine: (user) =>
				mineRoute.GET(
					new NextRequest('http://localhost/api/wg/mine', { headers: { 'x-test-user': user } }),
				),
			subscribe: async (memberId, wgId) => {
				const tokenSeed = createCalendarFeedSeed();
				const [row] = await database
					.insert(schema.calendarSubscriptions)
					.values({ wgId, memberId, tokenSeed })
					.returning({ id: schema.calendarSubscriptions.id });
				assert.ok(row);
				const token = deriveCalendarFeedToken(row.id, tokenSeed);
				assert.ok(token);
				return { id: row.id, token };
			},
			moveOut: async (memberId) => {
				await database
					.update(schema.wgMembers)
					.set({ deactivatedAt: new Date() })
					.where(eq(schema.wgMembers.id, memberId));
			},
		});
	} finally {
		await database.delete(schema.wgs).where(eq(schema.wgs.id, wg.id));
		await pool.end();
	}
}

test('a calendar feed link stops working once its member moved out', { skip }, async () => {
	await withFixture(async (f) => {
		const link = await f.subscribe(f.memberId, f.wgId);
		const before = await f.feed(link.id, link.token);
		assert.equal(before.status, 200);
		assert.match(await before.text(), /Flat dinner/);

		await f.moveOut(f.memberId);
		const after = await f.feed(link.id, link.token);
		assert.equal(after.status, 404);
		assert.doesNotMatch(await after.text(), /Flat dinner/);
	});
});

test('the flats list drops a flat the account moved out of', { skip }, async () => {
	await withFixture(async (f) => {
		const before = await f.mine(f.userId);
		assert.deepEqual(
			((await before.json()) as { wgs: Array<{ code: string }> }).wgs.map((wg) => wg.code),
			[f.wgCode],
		);
		await f.moveOut(f.memberId);
		const after = await f.mine(f.userId);
		assert.deepEqual(((await after.json()) as { wgs: unknown[] }).wgs, []);
	});
});
