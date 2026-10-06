import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mock, test } from 'node:test';

// The guards are tested against their real modules; only the Supabase user,
// the database rows and the rate limiter are stand-ins.

const WG = { id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT', joiningEnabled: true };

interface MemberRow {
	id: string;
	name: string;
	deactivatedAt: Date | null;
}

const state = {
	user: { id: 'user-1' } as { id: string } | null,
	authError: null as Error | null,
	wg: WG as typeof WG | null,
	member: { id: 'member-1', name: 'Mina', deactivatedAt: null } as MemberRow | null,
	memberError: null as Error | null,
	adminId: null as string | null,
	shareCodeMisses: 0,
	missBudgetSpent: false,
	writeLimited: false,
	events: [] as string[],
	memberLookups: [] as unknown[],
};

function reset(): void {
	state.user = { id: 'user-1' };
	state.authError = null;
	state.wg = WG;
	state.member = { id: 'member-1', name: 'Mina', deactivatedAt: null };
	state.memberError = null;
	state.adminId = null;
	state.shareCodeMisses = 0;
	state.missBudgetSpent = false;
	state.writeLimited = false;
	state.events = [];
	state.memberLookups = [];
}

const wgsTable = { name: 'wgs' };
const membersTable = {
	name: 'wg_members',
	wgId: 'wg_members.wg_id',
	authUserId: 'wg_members.auth_user_id',
};
const missLimiter = { name: 'miss' };
const writeLimiter = { name: 'write' };

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			state.events.push('user');
			if (state.authError) throw state.authError;
			return state.user;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		wgs: wgsTable,
		wgMembers: membersTable,
		db: {
			query: {
				wgMembers: {
					findFirst: async (query: unknown) => {
						state.events.push('member');
						state.memberLookups.push(query);
						if (state.memberError) throw state.memberError;
						return state.member ?? undefined;
					},
				},
				wgs: { findFirst: async () => state.wg ?? undefined },
			},
			select: () => ({
				from: (table: unknown) => ({
					where: () => ({
						limit: async () => {
							if (table === wgsTable) return state.wg ? [state.wg] : [];
							return state.adminId ? [{ id: state.adminId }] : [];
						},
					}),
				}),
			}),
		},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...args: unknown[]) => args,
		eq: (...args: unknown[]) => args,
		isNull: (...args: unknown[]) => args,
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		wgShareCodeMissLimiter: missLimiter,
		wgWriteLimiter: writeLimiter,
		checkRateLimit: async (limiter: unknown) => {
			if (limiter === missLimiter) {
				state.shareCodeMisses += 1;
				return { success: !state.missBudgetSpent };
			}
			return { success: !state.writeLimited };
		},
	},
});

const { requireMember } = await import('../src/core/guards/api-auth.ts');
const { requireWgMember, requireWgMembership } = await import(
	'../src/core/guards/require-wg-member.ts'
);
const { requireWgAdmin } = await import('../src/core/guards/require-wg-admin.ts');
const { requireOwnerOrAdmin } = await import('../src/core/guards/admin.ts');

function request(expectedMemberId?: string, extraHeaders: Record<string, string> = {}) {
	const headers = new Headers(extraHeaders);
	if (expectedMemberId) headers.set('x-manawg-expected-member-id', expectedMemberId);
	return new Request('https://app.test/api/wg/MTE8PZAT', { headers }) as never;
}

async function failure(result: { ok: boolean; response?: Response }) {
	assert.equal(result.ok, false);
	const response = result.response as Response;
	return { status: response.status, body: await response.json() };
}

test('requireMember accepts an authenticated active member without any token', async () => {
	reset();
	const result = await requireMember(request(), WG.id);
	assert.deepEqual(result, { ok: true, member: { memberId: 'member-1', name: 'Mina' } });
});

test('requireMember resolves the member from the Supabase user alone; legacy claim proofs grant nothing', async () => {
	reset();
	await requireMember(request(), WG.id);
	assert.deepEqual(state.memberLookups, [
		{
			where: [
				['wg_members.wg_id', WG.id],
				['wg_members.auth_user_id', 'user-1'],
			],
			columns: { id: true, name: true, deactivatedAt: true },
		},
	]);

	const previousSecret = process.env.MEMBER_SESSION_SECRET;
	process.env.MEMBER_SESSION_SECRET = 'guard-test-secret';
	try {
		const proof = createHmac('sha256', 'guard-test-secret')
			.update(`${WG.id}:member-1`)
			.digest('hex');
		const legacyHeaders = { 'x-manawg-member-id': 'member-1', 'x-manawg-member-token': proof };

		reset();
		state.member = null;
		const stranger = await requireMember(request(undefined, legacyHeaders), WG.id);
		assert.equal(stranger.ok, false);
		if (!stranger.ok) assert.equal(stranger.reason, 'not_a_member');

		reset();
		state.user = null;
		const anonymous = await requireMember(request(undefined, legacyHeaders), WG.id);
		assert.equal(anonymous.ok, false);
		if (!anonymous.ok) assert.equal(anonymous.reason, 'auth_required');
		assert.deepEqual(state.memberLookups, []);
	} finally {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
		else process.env.MEMBER_SESSION_SECRET = previousSecret;
	}
});

test('requireMember reports a typed reason for every rejection', async () => {
	const cases = [
		{
			setup: () => {
				state.user = null;
			},
			reason: 'auth_required',
			status: 401,
		},
		{
			setup: () => {
				state.member = null;
			},
			reason: 'not_a_member',
			status: 401,
		},
		{
			setup: () => {
				state.member = { id: 'member-1', name: 'Mina', deactivatedAt: new Date() };
			},
			reason: 'member_deactivated',
			status: 401,
		},
		{ setup: () => undefined, expected: 'member-2', reason: 'member_context_changed', status: 409 },
	];
	for (const { setup, expected, reason, status } of cases) {
		reset();
		setup();
		const result = await requireMember(request(expected), WG.id);
		assert.equal(result.ok, false);
		if (result.ok) continue;
		assert.equal(result.reason, reason);
		assert.equal(result.response.status, status);
		assert.deepEqual(await result.response.json(), { error: reason, code: reason });
	}

	reset();
	state.memberError = new Error('connection lost');
	const dbFailure = await requireMember(request(), WG.id);
	assert.equal(dbFailure.ok, false);
	if (!dbFailure.ok) {
		assert.equal(dbFailure.reason, 'db_error');
		assert.equal(dbFailure.response.status, 503);
		assert.deepEqual(await dbFailure.response.json(), { error: 'db_error' });
	}
});

test('requireWgMember counts unknown and foreign WGs against the miss budget only', async () => {
	reset();
	const ok = await requireWgMember(request(), WG.shareCode);
	assert.equal(ok.ok, true);
	assert.equal(state.shareCodeMisses, 0);

	reset();
	state.member = null;
	assert.deepEqual(await failure(await requireWgMember(request(), WG.shareCode)), {
		status: 401,
		body: { error: 'not_a_member', code: 'not_a_member' },
	});
	assert.equal(state.shareCodeMisses, 1);

	reset();
	state.wg = null;
	assert.deepEqual(await failure(await requireWgMember(request(), WG.shareCode)), {
		status: 404,
		body: { error: 'wg_not_found' },
	});
	assert.equal(state.shareCodeMisses, 1);

	reset();
	state.member = { id: 'member-1', name: 'Mina', deactivatedAt: new Date() };
	assert.equal((await failure(await requireWgMember(request(), WG.shareCode))).status, 401);
	assert.equal(state.shareCodeMisses, 0, 'a deactivated member is not a share-code miss');

	reset();
	state.member = null;
	state.missBudgetSpent = true;
	assert.equal((await failure(await requireWgMember(request(), WG.shareCode))).status, 429);
});

test('requireWgMembership authenticates before the WG lookup, then checks membership in that WG', async () => {
	const lookups: string[] = [];
	const loadWg = async (code: string) => {
		state.events.push('wg');
		lookups.push(code);
		return state.wg;
	};

	reset();
	state.user = null;
	const anonymous = await requireWgMembership(request(), WG.shareCode, 'test', loadWg);
	assert.equal((await failure(anonymous)).status, 401);
	assert.deepEqual(
		state.events,
		['user'],
		'an anonymous caller never learns whether a code exists',
	);
	assert.deepEqual(lookups, []);

	reset();
	const ok = await requireWgMembership(request(), WG.shareCode, 'test', loadWg);
	assert.equal(ok.ok, true);
	assert.deepEqual(state.events, ['user', 'wg', 'member']);
	assert.deepEqual(lookups, [WG.shareCode]);
	assert.deepEqual((state.memberLookups[0] as { where: unknown }).where, [
		['wg_members.wg_id', WG.id],
		['wg_members.auth_user_id', 'user-1'],
	]);
});

test('requireWgMember answers a retryable 503 on an Auth outage', async () => {
	reset();
	state.authError = new Error('auth down');
	assert.deepEqual(await failure(await requireWgMember(request(), WG.shareCode)), {
		status: 503,
		body: { error: 'db_error' },
	});
});

test('requireWgAdmin admits only the active admin and rate-limits the write', async () => {
	reset();
	state.adminId = 'member-1';
	const ok = await requireWgAdmin(request(), WG.shareCode, 'wg-settings');
	assert.equal(ok.ok, true);
	if (ok.ok) assert.deepEqual(ok.wg, WG);

	reset();
	state.adminId = 'member-2';
	assert.deepEqual(await failure(await requireWgAdmin(request(), WG.shareCode, 'wg-settings')), {
		status: 403,
		body: { error: 'not_admin', code: 'not_admin' },
	});

	reset();
	state.adminId = 'member-1';
	state.member = null;
	assert.equal((await failure(await requireWgAdmin(request(), WG.shareCode, 'x'))).status, 401);

	reset();
	state.adminId = 'member-1';
	state.writeLimited = true;
	assert.equal((await failure(await requireWgAdmin(request(), WG.shareCode, 'x'))).status, 429);
});

test('requireOwnerOrAdmin lets the owner or the admin through and forbids everyone else', async () => {
	reset();
	const member = { memberId: 'member-1' };
	assert.equal(await requireOwnerOrAdmin(WG.id, member, 'member-1'), null);

	state.adminId = 'member-1';
	assert.equal(await requireOwnerOrAdmin(WG.id, member, 'member-2'), null);

	state.adminId = 'member-2';
	const denied = await requireOwnerOrAdmin(WG.id, member, 'member-2', 'not_author');
	assert.ok(denied);
	assert.equal(denied.status, 403);
	assert.deepEqual(await denied.json(), { error: 'not_author', code: 'not_author' });
	assert.equal((await requireOwnerOrAdmin(WG.id, member, null))?.status, 403);
});
