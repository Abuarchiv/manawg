import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NextRequest } from 'next/server';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';

// Roster, move-out, rename and admin hand-over against a real PostgreSQL, so the WG scope of every
// lookup and the role rules are checked by the SQL itself. Opt-in like wg-invite-join.test.ts.
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

type Json = Record<string, unknown>;

async function withFixture(
	run: (f: {
		database: ReturnType<typeof drizzle<typeof schema>>;
		a: Wg;
		b: Wg;
		list: (user: string, code: string) => Promise<Response>;
		patch: (user: string, code: string, id: string, body: Json) => Promise<Response>;
		transfer: (user: string, code: string, id: string) => Promise<Response>;
		row: (id: string) => Promise<typeof schema.wgMembers.$inferSelect>;
	}) => Promise<void>,
) {
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
	const listRoute = await import('../src/app/api/wg/[code]/members/route.ts');
	const memberRoute = await import('../src/app/api/wg/[code]/members/[id]/route.ts');
	const adminRoute = await import('../src/app/api/wg/[code]/members/[id]/admin/route.ts');
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const wgIds: string[] = [];
	const seedWg = async (label: string): Promise<Wg> => {
		const code = generateShareCode();
		const [wg] = await database
			.insert(schema.wgs)
			.values({ shareCode: code, name: `Members ${label} ${randomUUID()}` })
			.returning({ id: schema.wgs.id });
		assert.ok(wg);
		wgIds.push(wg.id);
		const seed = async (name: string, role: 'admin' | 'member', gone = false) => {
			const authUserId = randomUUID();
			const [row] = await database
				.insert(schema.wgMembers)
				.values({
					wgId: wg.id,
					name,
					role,
					authUserId,
					deactivatedAt: gone ? new Date() : null,
				})
				.returning({ id: schema.wgMembers.id });
			assert.ok(row);
			return { id: row.id, userId: authUserId };
		};
		return {
			id: wg.id,
			code,
			admin: await seed(`Admin ${label}`, 'admin'),
			member: await seed(`Member ${label}`, 'member'),
			goneMember: await seed(`Gone ${label}`, 'member', true),
		};
	};
	const request = (user: string, path: string, method: string, body?: Json) =>
		new NextRequest(`http://localhost${path}`, {
			method,
			headers: { 'content-type': 'application/json', 'x-test-user': user },
			body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : null,
		});
	try {
		const a = await seedWg('A');
		const b = await seedWg('B');
		await run({
			database,
			a,
			b,
			list: (user, code) =>
				listRoute.GET(request(user, `/api/wg/${code}/members`, 'GET'), {
					params: Promise.resolve({ code }),
				}),
			patch: (user, code, id, body) =>
				memberRoute.PATCH(request(user, `/api/wg/${code}/members/${id}`, 'PATCH', body), {
					params: Promise.resolve({ code, id }),
				}),
			transfer: (user, code, id) =>
				adminRoute.POST(request(user, `/api/wg/${code}/members/${id}/admin`, 'POST'), {
					params: Promise.resolve({ code, id }),
				}),
			row: async (id) => {
				const [found] = await database
					.select()
					.from(schema.wgMembers)
					.where(eq(schema.wgMembers.id, id));
				assert.ok(found);
				return found;
			},
		});
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
}

interface Wg {
	id: string;
	code: string;
	admin: { id: string; userId: string };
	member: { id: string; userId: string };
	goneMember: { id: string; userId: string };
}

test('the roster lists this WG only, with a matching total', { skip }, async () => {
	await withFixture(async (f) => {
		const response = await f.list(f.a.member.userId, f.a.code);
		assert.equal(response.status, 200);
		const body = (await response.json()) as {
			members: Array<{ id: string }>;
			pagination: { total: number };
		};
		assert.deepEqual(
			body.members.map((m) => m.id).sort(),
			[f.a.admin.id, f.a.member.id, f.a.goneMember.id].sort(),
		);
		assert.equal(body.pagination.total, 3);
	});
});

test('an admin cannot move out, rename or hand over to a member of another WG', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		const out = await f.patch(f.a.admin.userId, f.a.code, f.b.member.id, { active: false });
		assert.equal(out.status, 404);
		const rename = await f.patch(f.a.admin.userId, f.a.code, f.b.member.id, { name: 'Hijacked' });
		assert.equal(rename.status, 404);
		const handOver = await f.transfer(f.a.admin.userId, f.a.code, f.b.member.id);
		assert.equal(handOver.status, 404);
		const untouched = await f.row(f.b.member.id);
		assert.equal(untouched.deactivatedAt, null);
		assert.equal(untouched.name, 'Member B');
		assert.equal((await f.row(f.a.admin.id)).role, 'admin');
		assert.equal((await f.row(f.b.admin.id)).role, 'admin');
	});
});

test('a plain member moves themselves out, but nobody else', { skip }, async () => {
	await withFixture(async (f) => {
		const other = await f.patch(f.a.member.userId, f.a.code, f.a.admin.id, { active: false });
		assert.equal(other.status, 403);
		const own = await f.patch(f.a.member.userId, f.a.code, f.a.member.id, { active: false });
		assert.equal(own.status, 200);
		assert.ok((await f.row(f.a.member.id)).deactivatedAt);
		const again = await f.list(f.a.member.userId, f.a.code);
		assert.equal(again.status, 401);
	});
});

test('an admin cannot rename a moved-out member, and a rename cannot take an active name', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		const gone = await f.patch(f.a.admin.userId, f.a.code, f.a.goneMember.id, { name: 'New name' });
		assert.equal(gone.status, 409);
		assert.equal((await f.row(f.a.goneMember.id)).name, 'Gone A');
		const taken = await f.patch(f.a.member.userId, f.a.code, f.a.member.id, { name: 'admin a' });
		assert.equal(taken.status, 409);
		assert.equal((await f.row(f.a.member.id)).name, 'Member A');
	});
});

test('handing over the admin role keeps exactly one admin and refuses moved-out targets', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		const inactive = await f.transfer(f.a.admin.userId, f.a.code, f.a.goneMember.id);
		assert.equal(inactive.status, 409);
		const byMember = await f.transfer(f.a.member.userId, f.a.code, f.a.admin.id);
		assert.equal(byMember.status, 403);
		assert.equal((await f.row(f.a.admin.id)).role, 'admin');

		const ok = await f.transfer(f.a.admin.userId, f.a.code, f.a.member.id);
		assert.equal(ok.status, 200);
		assert.equal((await f.row(f.a.admin.id)).role, 'member');
		assert.equal((await f.row(f.a.member.id)).role, 'admin');
		const roles = await f.database
			.select({ role: schema.wgMembers.role })
			.from(schema.wgMembers)
			.where(eq(schema.wgMembers.wgId, f.a.id));
		assert.equal(roles.filter((r) => r.role === 'admin').length, 1);
	});
});

test('the admin cannot be moved out, so the WG never ends up without one', { skip }, async () => {
	await withFixture(async (f) => {
		const self = await f.patch(f.a.admin.userId, f.a.code, f.a.admin.id, { active: false });
		assert.equal(self.status, 403);
		assert.equal((await f.row(f.a.admin.id)).deactivatedAt, null);
	});
});
