import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NextRequest } from 'next/server';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';
import { WG_NAME_MAX_LENGTH } from '../src/shared/lib/limits.ts';

// WG rename and delete against a real PostgreSQL, so the single-WG scope of the write, the
// locked admin re-check and the audit entry are checked by the SQL itself. Opt-in like
// wg-member-routes.test.ts.
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
// The first-stage admin guard always passes, so every 403 below comes from the admin re-check
// that runs under the row lock inside the write transaction.
mock.module('@/core/guards/admin', {
	namedExports: {
		isWgAdmin: async () => true,
		requireOwnerOrAdmin: () => {
			throw new Error('requireOwnerOrAdmin must not run');
		},
	},
});

type Json = Record<string, unknown>;

interface Wg {
	id: string;
	code: string;
	name: string;
	admin: { id: string; userId: string };
	member: { id: string; userId: string };
}

async function withFixture(
	run: (f: {
		database: ReturnType<typeof drizzle<typeof schema>>;
		a: Wg;
		b: Wg;
		patch: (user: string, code: string, body: Json) => Promise<Response>;
		remove: (user: string, code: string) => Promise<Response>;
		nameOf: (id: string) => Promise<string | undefined>;
	}) => Promise<void>,
) {
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
	const route = await import('../src/app/api/wg/[code]/route.ts');
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const wgIds: string[] = [];
	const seedWg = async (label: string): Promise<Wg> => {
		const code = generateShareCode();
		const name = `Settings ${label} ${randomUUID()}`;
		const [wg] = await database
			.insert(schema.wgs)
			.values({ shareCode: code, name })
			.returning({ id: schema.wgs.id });
		assert.ok(wg);
		wgIds.push(wg.id);
		const seed = async (memberName: string, role: 'admin' | 'member') => {
			const authUserId = randomUUID();
			const [row] = await database
				.insert(schema.wgMembers)
				.values({ wgId: wg.id, name: memberName, role, authUserId })
				.returning({ id: schema.wgMembers.id });
			assert.ok(row);
			return { id: row.id, userId: authUserId };
		};
		return {
			id: wg.id,
			code,
			name,
			admin: await seed(`Admin ${label}`, 'admin'),
			member: await seed(`Member ${label}`, 'member'),
		};
	};
	const request = (user: string, code: string, method: string, body?: Json) =>
		new NextRequest(`http://localhost/api/wg/${code}`, {
			method,
			headers: { 'content-type': 'application/json', 'x-test-user': user },
			body: body ? JSON.stringify(body) : null,
		});
	try {
		const a = await seedWg('A');
		const b = await seedWg('B');
		await run({
			database,
			a,
			b,
			patch: (user, code, body) =>
				route.PATCH(request(user, code, 'PATCH', body), { params: Promise.resolve({ code }) }),
			remove: (user, code) =>
				route.DELETE(request(user, code, 'DELETE'), { params: Promise.resolve({ code }) }),
			nameOf: async (id) => {
				const [found] = await database
					.select({ name: schema.wgs.name })
					.from(schema.wgs)
					.where(eq(schema.wgs.id, id));
				return found?.name;
			},
		});
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
}

test('an admin rename trims the name and changes only this WG', { skip }, async () => {
	await withFixture(async (f) => {
		const response = await f.patch(f.a.admin.userId, f.a.code, { name: '  Neu  ' });
		assert.equal(response.status, 200);
		const body = (await response.json()) as { wg: { id: string; name: string } };
		assert.equal(body.wg.id, f.a.id);
		assert.equal(body.wg.name, 'Neu');
		assert.equal(await f.nameOf(f.a.id), 'Neu');
		assert.equal(await f.nameOf(f.b.id), f.b.name);
	});
});

test('an empty, blank or over-long name is rejected and nothing is written', { skip }, async () => {
	await withFixture(async (f) => {
		for (const name of ['', '   ', 'x'.repeat(WG_NAME_MAX_LENGTH + 1)]) {
			const response = await f.patch(f.a.admin.userId, f.a.code, { name });
			assert.equal(response.status, 400);
			assert.equal(((await response.json()) as { error: string }).error, 'wg_update_invalid');
		}
		assert.equal(await f.nameOf(f.a.id), f.a.name);
		const longest = 'x'.repeat(WG_NAME_MAX_LENGTH);
		const ok = await f.patch(f.a.admin.userId, f.a.code, { name: longest });
		assert.equal(ok.status, 200);
		assert.equal(await f.nameOf(f.a.id), longest);
	});
});

test('a plain member cannot rename the WG', { skip }, async () => {
	await withFixture(async (f) => {
		const response = await f.patch(f.a.member.userId, f.a.code, { name: 'Hijacked' });
		assert.equal(response.status, 403);
		assert.equal(((await response.json()) as { error: string }).error, 'not_admin');
		assert.equal(await f.nameOf(f.a.id), f.a.name);
	});
});

test('an admin of another WG cannot rename this WG', { skip }, async () => {
	await withFixture(async (f) => {
		const response = await f.patch(f.b.admin.userId, f.a.code, { name: 'Hijacked' });
		assert.notEqual(response.status, 200);
		assert.equal(await f.nameOf(f.a.id), f.a.name);
		assert.equal(await f.nameOf(f.b.id), f.b.name);
	});
});

test('a demoted admin is refused by the locked re-check on rename and delete', {
	skip,
}, async () => {
	await withFixture(async (f) => {
		await f.database
			.update(schema.wgMembers)
			.set({ role: 'member' })
			.where(eq(schema.wgMembers.id, f.a.admin.id));
		const renamed = await f.patch(f.a.admin.userId, f.a.code, { name: 'Late rename' });
		assert.equal(renamed.status, 403);
		assert.equal(((await renamed.json()) as { error: string }).error, 'not_admin');
		assert.equal(await f.nameOf(f.a.id), f.a.name);
		const deleted = await f.remove(f.a.admin.userId, f.a.code);
		assert.equal(deleted.status, 403);
		assert.equal(((await deleted.json()) as { error: string }).error, 'not_admin');
		assert.equal(await f.nameOf(f.a.id), f.a.name);
	});
});

test('a rename writes one wg.updated audit entry with the old and new name', { skip }, async () => {
	await withFixture(async (f) => {
		const response = await f.patch(f.a.admin.userId, f.a.code, { name: 'Audited' });
		assert.equal(response.status, 200);
		const rows = await f.database
			.select()
			.from(schema.auditEvents)
			.where(eq(schema.auditEvents.wgId, f.a.id));
		assert.equal(rows.length, 1);
		const [row] = rows;
		assert.ok(row);
		assert.equal(row.eventType, 'wg.updated');
		assert.equal(row.entityType, 'wg');
		assert.equal(row.entityId, f.a.id);
		assert.equal(row.memberId, f.a.admin.id);
		assert.deepEqual(JSON.parse(row.metadataJson ?? 'null'), {
			nameBefore: f.a.name,
			nameAfter: 'Audited',
		});
	});
});

test('a plain member cannot delete the WG, an admin deletes only this WG', { skip }, async () => {
	await withFixture(async (f) => {
		const refused = await f.remove(f.a.member.userId, f.a.code);
		assert.equal(refused.status, 403);
		assert.equal(((await refused.json()) as { error: string }).error, 'not_admin');
		assert.equal(await f.nameOf(f.a.id), f.a.name);

		const response = await f.remove(f.a.admin.userId, f.a.code);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { deleted: true });
		assert.equal(await f.nameOf(f.a.id), undefined);
		assert.equal(await f.nameOf(f.b.id), f.b.name);
	});
});
