import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

const state = {
	rows: [] as Record<string, unknown>[],
	selected: [] as Record<string, unknown>[],
	allowed: true,
	unavailable: false,
	dbFails: false,
	rateKeys: [] as string[],
};

const table = (name: string, columns: string[]) =>
	Object.fromEntries(columns.map((column) => [column, `${name}.${column}`]));

const db = {
	select: (shape: Record<string, unknown>) => {
		state.selected.push(shape);
		const chain = {
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			limit: async () => {
				if (state.dbFails) throw new Error('connection refused: postgres://secret-host');
				return state.rows;
			},
		};
		return chain;
	},
};

mock.module('@/core/db', {
	namedExports: {
		db,
		withTransaction: async () => undefined,
		wgInvites: table('wg_invites', ['token', 'wgId', 'createdByMemberId']),
		wgMembers: table('wg_members', ['id', 'name', 'deactivatedAt']),
		wgs: table('wgs', ['id', 'name', 'shareCode']),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async (_limiter: unknown, key: string) => {
			state.rateKeys.push(key);
			return state.allowed
				? { success: true, remaining: 1, reset: 0 }
				: {
						success: false,
						remaining: 0,
						reset: Date.now() + 30_000,
						limiterUnavailable: state.unavailable,
					};
		},
		clientIpKey: () => '203.0.113.7',
		invitePreviewLimiter: {},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const { GET } = await import('./route');

const call = (token = TOKEN) =>
	GET(new NextRequest(`https://app.manawg.test/api/wg/invites/${token}/preview`), {
		params: Promise.resolve({ token }),
	});

const row = (over: Record<string, unknown> = {}) => ({
	wgName: 'Lindenstraße',
	inviterName: 'Mika Muster',
	inviterDeactivatedAt: null,
	expiresAt: future,
	revokedAt: null,
	useCount: 0,
	maxUses: 10,
	...over,
});

function reset(): void {
	state.rows = [];
	state.selected = [];
	state.allowed = true;
	state.unavailable = false;
	state.dbFails = false;
	state.rateKeys = [];
}

test('names the WG and the first name of the inviter, and nothing else', async () => {
	reset();
	state.rows = [row()];
	const res = await call();
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { wgName: 'Lindenstraße', inviterName: 'Mika' });
	assert.equal(res.headers.get('cache-control'), 'no-store');
	// The query asks for no share code, no ids and no member list.
	const columns = Object.keys(state.selected[0] ?? {});
	assert.ok(!columns.some((name) => /id$|shareCode|token/i.test(name)), columns.join(','));
});

test('leaves the inviter out when they are gone or have moved out', async () => {
	reset();
	state.rows = [row({ inviterName: null })];
	assert.deepEqual(await (await call()).json(), { wgName: 'Lindenstraße', inviterName: null });
	state.rows = [row({ inviterDeactivatedAt: past })];
	assert.deepEqual(await (await call()).json(), { wgName: 'Lindenstraße', inviterName: null });
});

test('keeps a title or an initial out of the inviter name', async () => {
	for (const inviterName of ['Dr. Mika', 'M. Muster']) {
		reset();
		state.rows = [row({ inviterName })];
		assert.deepEqual(await (await call()).json(), { wgName: 'Lindenstraße', inviterName: null });
	}
	reset();
	state.rows = [row({ inviterName: 'Anna-Lena Müller' })];
	assert.deepEqual(await (await call()).json(), {
		wgName: 'Lindenstraße',
		inviterName: 'Anna-Lena',
	});
});

test('every token that cannot be used gets the same bare 404', async () => {
	const unusable: [string, Record<string, unknown>[], string?][] = [
		['unknown', []],
		['expired', [row({ expiresAt: past })]],
		['revoked', [row({ revokedAt: past })]],
		['used up', [row({ useCount: 10 })]],
		['malformed', [row()], 'not-a-token'],
	];
	const bodies = new Set<string>();
	for (const [label, rows, token] of unusable) {
		reset();
		state.rows = rows;
		const res = await call(token);
		assert.equal(res.status, 404, label);
		bodies.add(JSON.stringify(await res.json()));
	}
	assert.equal(bodies.size, 1, 'the answer must not tell the reasons apart');
	assert.ok(![...bodies][0]?.includes('Lindenstraße'));
});

test('is limited per client address and says nothing about the token once the budget is spent', async () => {
	reset();
	state.rows = [row()];
	state.allowed = false;
	const res = await call();
	assert.equal(res.status, 429);
	assert.deepEqual(state.rateKeys, ['203.0.113.7']);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.ok(!JSON.stringify(await res.json()).includes('Lindenstraße'));
	// The limit comes first: no lookup happens for a limited caller.
	assert.equal(state.selected.length, 0);
});

test('answers 503 without lookup or details when the limiter is unavailable', async () => {
	reset();
	state.rows = [row()];
	state.allowed = false;
	state.unavailable = true;
	const res = await call();
	assert.equal(res.status, 503);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.ok(!JSON.stringify(await res.json()).includes('Lindenstraße'));
	assert.equal(state.selected.length, 0);
});

test('answers 500 without leaking the database error', async () => {
	reset();
	state.dbFails = true;
	const res = await call();
	assert.equal(res.status, 500);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	const body = JSON.stringify(await res.json());
	assert.ok(!body.includes('postgres') && !body.includes('secret-host'), body);
});
