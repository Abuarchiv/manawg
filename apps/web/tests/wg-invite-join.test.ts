import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NextRequest } from 'next/server';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { wgInvites } from '../src/core/db/schema-invites.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';
import { MAX_MEMBERS_PER_WG } from '../src/shared/lib/limits.ts';

// Invite join, preview and revoke against a real PostgreSQL: the real route handlers run, only
// the signed-in account and the rate limiter are replaced. Opt-in: TEST_DATABASE_URL must name
// a disposable loopback database with all migrations applied (`pnpm test:db`).
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
		wgWriteLimiter: {},
		wgShareCodeMissLimiter: {},
	},
});

type Database = ReturnType<typeof drizzle<typeof schema>>;
type Json = Record<string, unknown>;

interface Fixture {
	database: Database;
	a: { id: string; code: string; memberUserId: string; memberId: string };
	b: { id: string; code: string; memberUserId: string; memberId: string };
	joinTokenOf: (wg: 'a' | 'b') => Promise<{ id: string; token: string }>;
	join: (userId: string, code: string, inviteToken: string, name?: string) => Promise<Response>;
	preview: (userId: string, token: string) => Promise<Response>;
	revoke: (userId: string, code: string, inviteId: string) => Promise<Response>;
	memberCount: (wgId: string) => Promise<number>;
	invite: (id: string) => Promise<typeof wgInvites.$inferSelect>;
	list: (userId: string, code: string) => Promise<Response>;
	create: (userId: string, code: string) => Promise<Response>;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
	const membersRoute = await import('../src/app/api/wg/[code]/members/route.ts');
	const previewRoute = await import('../src/app/api/wg/invites/[token]/route.ts');
	const revokeRoute = await import('../src/app/api/wg/[code]/invites/[id]/route.ts');
	const { createWgInvite } = await import('../src/core/db/wg-invites.ts');
	const listRoute = await import('../src/app/api/wg/[code]/invites/route.ts');

	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const wgIds: string[] = [];
	const seedWg = async (label: string) => {
		const code = generateShareCode();
		const [wg] = await database
			.insert(schema.wgs)
			.values({ shareCode: code, name: `Invite ${label} ${randomUUID()}` })
			.returning({ id: schema.wgs.id });
		assert.ok(wg);
		wgIds.push(wg.id);
		const memberUserId = randomUUID();
		const [member] = await database
			.insert(schema.wgMembers)
			.values({ wgId: wg.id, name: 'Founder', role: 'admin', authUserId: memberUserId })
			.returning({ id: schema.wgMembers.id });
		assert.ok(member);
		return { id: wg.id, code, memberUserId, memberId: member.id };
	};
	const request = (userId: string, path: string, method: string, body?: Json) =>
		new NextRequest(`http://localhost${path}`, {
			method,
			headers: { 'content-type': 'application/json', 'x-test-user': userId },
			body: body ? JSON.stringify(body) : null,
		});
	try {
		const a = await seedWg('A');
		const b = await seedWg('B');
		await run({
			database,
			a,
			b,
			joinTokenOf: async (wg) => {
				const target = wg === 'a' ? a : b;
				const created = await createWgInvite(target.id, target.memberId);
				assert.ok(created);
				return { id: created.id, token: created.token };
			},
			join: (userId, code, inviteToken, name = `Joiner ${userId.slice(0, 8)}`) => {
				return membersRoute.POST(
					request(userId, `/api/wg/${code}/members`, 'POST', { name, inviteToken }),
					{ params: Promise.resolve({ code }) },
				);
			},
			preview: (userId, token) => {
				return previewRoute.GET(request(userId, `/api/wg/invites/${token}`, 'GET'), {
					params: Promise.resolve({ token }),
				});
			},
			revoke: (userId, code, inviteId) => {
				return revokeRoute.DELETE(
					request(userId, `/api/wg/${code}/invites/${inviteId}`, 'DELETE'),
					{
						params: Promise.resolve({ code, id: inviteId }),
					},
				);
			},
			list: (userId, code) =>
				listRoute.GET(request(userId, `/api/wg/${code}/invites`, 'GET'), {
					params: Promise.resolve({ code }),
				}),
			create: (userId, code) =>
				listRoute.POST(request(userId, `/api/wg/${code}/invites`, 'POST'), {
					params: Promise.resolve({ code }),
				}),
			memberCount: async (wgId) =>
				(await database.select().from(schema.wgMembers).where(eq(schema.wgMembers.wgId, wgId)))
					.length,
			invite: async (id) => {
				const [row] = await database.select().from(wgInvites).where(eq(wgInvites.id, id));
				assert.ok(row);
				return row;
			},
		});
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
}

async function codeOf(response: Response): Promise<unknown> {
	return ((await response.json()) as Json).code;
}

const unusable: Array<[string, Partial<typeof wgInvites.$inferInsert>]> = [
	['revoked', { revokedAt: new Date() }],
	['expired', { expiresAt: new Date(Date.now() - 1000) }],
	['used up', { maxUses: 1, useCount: 1 }],
];

for (const [label, patch] of unusable) {
	test(`a ${label} invite is gone on preview and cannot join`, { skip }, async () => {
		await withFixture(async (f) => {
			const { id, token } = await f.joinTokenOf('a');
			await f.database.update(wgInvites).set(patch).where(eq(wgInvites.id, id));
			const visitor = randomUUID();

			const preview = await f.preview(visitor, token);
			assert.equal(preview.status, 410);
			assert.equal(await codeOf(preview), 'invite_expired');

			const joined = await f.join(visitor, f.a.code, token);
			assert.equal(joined.status, 410);
			assert.equal(await codeOf(joined), 'invite_expired');
			assert.equal(await f.memberCount(f.a.id), 1);
		});
	});
}

test('a valid invite previews the WG and joins as a plain member', { skip }, async () => {
	await withFixture(async (f) => {
		const { id, token } = await f.joinTokenOf('a');
		const visitor = randomUUID();

		const preview = await f.preview(visitor, token);
		assert.equal(preview.status, 200);
		assert.equal(((await preview.json()) as { wg: Json }).wg.shareCode, f.a.code);

		const joined = await f.join(visitor, f.a.code, token);
		assert.equal(joined.status, 200);
		assert.equal(((await joined.json()) as { member: Json }).member.role, 'member');
		assert.equal(await f.memberCount(f.a.id), 2);
		assert.equal((await f.invite(id)).useCount, 1);

		const again = await f.preview(visitor, token);
		assert.equal(again.status, 409);
		assert.equal(await codeOf(again), 'already_member');
	});
});

test('an unknown or malformed token is not found on preview', { skip }, async () => {
	await withFixture(async (f) => {
		for (const token of ['short', 'A'.repeat(22)]) {
			const preview = await f.preview(randomUUID(), token);
			assert.equal(preview.status, 404);
			assert.equal(await codeOf(preview), 'invite_invalid');
		}
	});
});

test('an invite of another WG does not open this WG', { skip }, async () => {
	await withFixture(async (f) => {
		const { token } = await f.joinTokenOf('b');
		const joined = await f.join(randomUUID(), f.a.code, token);
		assert.equal(joined.status, 403);
		assert.equal(await codeOf(joined), 'invite_required');
		assert.equal(await f.memberCount(f.a.id), 1);
		assert.equal(await f.memberCount(f.b.id), 1);
	});
});

test('joining without a well-formed token is refused', { skip }, async () => {
	await withFixture(async (f) => {
		const joined = await f.join(randomUUID(), f.a.code, '');
		assert.equal(joined.status, 403);
		assert.equal(await codeOf(joined), 'invite_required');
		assert.equal(await f.memberCount(f.a.id), 1);
	});
});

test('a moved-out member cannot rejoin through an invite', { skip }, async () => {
	await withFixture(async (f) => {
		const { id, token } = await f.joinTokenOf('a');
		const leaver = randomUUID();
		await f.database
			.insert(schema.wgMembers)
			.values({ wgId: f.a.id, name: 'Leaver', authUserId: leaver, deactivatedAt: new Date() });
		const joined = await f.join(leaver, f.a.code, token);
		assert.equal(joined.status, 403);
		assert.equal(await codeOf(joined), 'member_deactivated');
		assert.equal(await f.memberCount(f.a.id), 2);
		assert.equal((await f.invite(id)).useCount, 0);
	});
});

test('a full WG refuses new members, moved-out rows do not count', { skip }, async () => {
	await withFixture(async (f) => {
		const { token } = await f.joinTokenOf('a');
		const filler = (n: number, deactivatedAt: Date | null) => ({
			wgId: f.a.id,
			name: `Filler ${n}`,
			deactivatedAt,
		});
		const movedOut = Array.from({ length: 3 }, (_, n) => filler(100 + n, new Date()));
		const active = Array.from({ length: MAX_MEMBERS_PER_WG - 2 }, (_, n) => filler(n, null));
		await f.database.insert(schema.wgMembers).values([...movedOut, ...active]);

		const last = await f.join(randomUUID(), f.a.code, token);
		assert.equal(last.status, 200);

		const refused = await f.join(randomUUID(), f.a.code, token);
		assert.equal(refused.status, 409);
		assert.equal(await codeOf(refused), 'member_limit_reached');
		assert.equal(await f.memberCount(f.a.id), 3 + MAX_MEMBERS_PER_WG);
	});
});

test('two parallel joins on a single-use invite admit exactly one', { skip }, async () => {
	await withFixture(async (f) => {
		const { id, token } = await f.joinTokenOf('a');
		await f.database.update(wgInvites).set({ maxUses: 1 }).where(eq(wgInvites.id, id));
		const responses = await Promise.all([
			f.join(randomUUID(), f.a.code, token, 'Racer one'),
			f.join(randomUUID(), f.a.code, token, 'Racer two'),
		]);
		const statuses = responses.map((response) => response.status).sort();
		assert.deepEqual(statuses, [200, 410]);
		assert.equal(await f.memberCount(f.a.id), 2);
		assert.equal((await f.invite(id)).useCount, 1);
	});
});

test('revoking needs the WG and the invite to match, and stops the link', { skip }, async () => {
	await withFixture(async (f) => {
		const own = await f.joinTokenOf('a');
		const foreign = await f.joinTokenOf('b');

		const crossWg = await f.revoke(f.a.memberUserId, f.a.code, foreign.id);
		assert.equal(crossWg.status, 404);
		assert.equal((await f.invite(foreign.id)).revokedAt, null);

		const stranger = await f.revoke(randomUUID(), f.a.code, own.id);
		assert.equal(stranger.status, 401);
		assert.equal((await f.invite(own.id)).revokedAt, null);

		const malformed = await f.revoke(f.a.memberUserId, f.a.code, 'not-a-uuid');
		assert.equal(malformed.status, 400);

		const revoked = await f.revoke(f.a.memberUserId, f.a.code, own.id);
		assert.equal(revoked.status, 200);
		assert.ok((await f.invite(own.id)).revokedAt);

		const repeat = await f.revoke(f.a.memberUserId, f.a.code, own.id);
		assert.equal(repeat.status, 404);

		const joined = await f.join(randomUUID(), f.a.code, own.token);
		assert.equal(joined.status, 410);
		assert.equal(await f.memberCount(f.a.id), 1);
	});
});

test("the invite list shows only this WG's active invites", { skip }, async () => {
	await withFixture(async (f) => {
		const own = await f.joinTokenOf('a');
		await f.joinTokenOf('b');
		for (const [, patch] of unusable) {
			const spent = await f.joinTokenOf('a');
			await f.database.update(wgInvites).set(patch).where(eq(wgInvites.id, spent.id));
		}
		const listed = await f.list(f.a.memberUserId, f.a.code);
		assert.equal(listed.status, 200);
		const { invites } = (await listed.json()) as { invites: Array<{ id: string }> };
		assert.deepEqual(
			invites.map((invite) => invite.id),
			[own.id],
		);
	});
});

test('expired, revoked and used-up invites do not count against the cap of 20', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		const spent: string[] = [];
		for (let n = 0; n < 5; n += 1) {
			const made = await f.joinTokenOf('a');
			spent.push(made.id);
			await f.database
				.update(wgInvites)
				.set(unusable[n % unusable.length]?.[1] ?? {})
				.where(eq(wgInvites.id, made.id));
		}
		for (let n = 0; n < 19; n += 1) await f.joinTokenOf('a');
		// 19 active + 5 spent: one more fits, the next one hits the cap.
		assert.equal((await f.create(f.a.memberUserId, f.a.code)).status, 200);
		const capped = await f.create(f.a.memberUserId, f.a.code);
		assert.equal(capped.status, 409);
		assert.equal(await codeOf(capped), 'invite_limit_reached');
		// Another WG is not affected by this WG's invites.
		assert.equal((await f.create(f.b.memberUserId, f.b.code)).status, 200);
	});
});

test('a member of another WG still gets a preview, not already_member', { skip }, async () => {
	await withFixture(async (f) => {
		const { token } = await f.joinTokenOf('a');
		const preview = await f.preview(f.b.memberUserId, token);
		assert.equal(preview.status, 200);
		assert.equal(((await preview.json()) as { wg: Json }).wg.shareCode, f.a.code);
	});
});

test('an active member cannot join again and burns no invite use', { skip }, async () => {
	await withFixture(async (f) => {
		const { id, token } = await f.joinTokenOf('a');
		const again = await f.join(f.a.memberUserId, f.a.code, token, 'Founder two');
		assert.equal(again.status, 409);
		assert.equal(await codeOf(again), 'already_joined');
		assert.equal(await f.memberCount(f.a.id), 1);
		assert.equal((await f.invite(id)).useCount, 0);
	});
});

test('an account whose deletion is pending cannot join', { skip }, async () => {
	await withFixture(async (f) => {
		const { id, token } = await f.joinTokenOf('a');
		const leaving = randomUUID();
		await f.database.insert(schema.accountDeletions).values({ authUserId: leaving });
		try {
			const joined = await f.join(leaving, f.a.code, token);
			assert.equal(joined.status, 409);
			assert.equal(await codeOf(joined), 'account_deletion_pending');
			assert.equal(await f.memberCount(f.a.id), 1);
			assert.equal((await f.invite(id)).useCount, 0);
		} finally {
			await f.database
				.delete(schema.accountDeletions)
				.where(eq(schema.accountDeletions.authUserId, leaving));
		}
	});
});

test('a new member may take the name of someone who moved out, who is renamed aside', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		const { token } = await f.joinTokenOf('a');
		await f.database
			.insert(schema.wgMembers)
			.values({ wgId: f.a.id, name: 'Anna', deactivatedAt: new Date() });
		const joined = await f.join(randomUUID(), f.a.code, token, 'anna');
		assert.equal(joined.status, 200);
		const rows = await f.database
			.select({ name: schema.wgMembers.name, gone: schema.wgMembers.deactivatedAt })
			.from(schema.wgMembers)
			.where(eq(schema.wgMembers.wgId, f.a.id));
		assert.deepEqual(
			rows.filter((row) => row.gone).map((row) => row.name),
			['Anna (2)'],
		);
		assert.ok(rows.some((row) => !row.gone && row.name === 'anna'));
	});
});

test('two active members cannot share a name, even in another case', { skip }, async () => {
	await withFixture(async (f) => {
		const { token } = await f.joinTokenOf('a');
		const clash = await f.join(randomUUID(), f.a.code, token, 'FOUNDER');
		assert.equal(clash.status, 409);
		assert.equal(await codeOf(clash), 'name_taken');
	});
});
