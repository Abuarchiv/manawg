import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from './support/db-mock';
import { mockRateLimit, request, routeCtx } from './support/route-harness';

// Routes that call getAuthenticatedUser outside their own try/catch must turn a transient
// Supabase Auth outage into the same structured, retryable 503 that requireWgMember returns,
// never an unhandled 500 or a 401. Everything after authentication is real and would fail the
// test: the database stand-in throws on any access.

const state = { authCalls: 0, logged: [] as string[] };

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			state.authCalls += 1;
			throw Object.assign(new Error('Auth service unavailable'), { status: 503 });
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (label: string) => {
			state.logged.push(label);
		},
		withCronLogging: <T>(_name: string, handler: T) => handler,
	},
});
mock.module('@/core/auth/supabase-env', {
	namedExports: {
		hasSupabaseEnv: () => true,
		getSupabaseEnv: () => assert.fail('getSupabaseEnv must not run after an Auth outage'),
	},
});
const rateLimit = mockRateLimit();
mockDb({});

const uploadSign = await import('../src/app/api/upload/sign/route.ts');
const uploadRead = await import('../src/app/api/upload/read/route.ts');
const account = await import('../src/app/api/account/route.ts');
const wg = await import('../src/app/api/wg/[code]/route.ts');
const wgMine = await import('../src/app/api/wg/mine/route.ts');
const wgMembers = await import('../src/app/api/wg/[code]/members/route.ts');
const memberClaim = await import('../src/app/api/wg/[code]/members/[id]/claim/route.ts');
const wgCreate = await import('../src/app/api/wg/route.ts');

function reset(): void {
	state.authCalls = 0;
	state.logged = [];
	rateLimit.calls = [];
}

async function assertAuthOutage(response: Response): Promise<void> {
	assert.equal(state.authCalls, 1);
	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), { error: 'db_error' });
	assert.equal(state.logged.length, 1);
}

test('upload sign returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await uploadSign.POST(
		request('/api/upload/sign', {
			method: 'POST',
			body: { shareCode: 'MTE8PZAT', purpose: 'expense', mimeType: 'image/jpeg', fileSize: 1024 },
		}),
	);

	await assertAuthOutage(response);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(rateLimit.calls, []);
});

test('upload read returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const key =
		'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg';
	const response = await uploadRead.GET(request(`/api/upload/read?key=${encodeURIComponent(key)}`));

	await assertAuthOutage(response);
	assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('account DELETE returns a retryable 503 when Supabase Auth is unavailable', async (t) => {
	const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
	t.after(() => {
		if (previousServiceRoleKey === undefined) {
			Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
		} else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
	});
	reset();
	const response = await account.DELETE(request('/api/account', { method: 'DELETE' }));

	await assertAuthOutage(response);
});

test('WG GET returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await wg.GET(request('/api/wg/MTE8PZAT'), routeCtx());

	await assertAuthOutage(response);
});

test('WG mine returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await wgMine.GET(request('/api/wg/mine'));

	await assertAuthOutage(response);
});

test('WG join returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await wgMembers.POST(
		request('/api/wg/MTE8PZAT/members', { method: 'POST', body: { name: 'Mia' } }),
		routeCtx(),
	);

	await assertAuthOutage(response);
});

test('member claim returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await memberClaim.POST(
		request('/api/wg/MTE8PZAT/members/claim', { method: 'POST' }),
		routeCtx({ id: '11111111-1111-4111-8111-111111111111' }),
	);

	await assertAuthOutage(response);
});

test('WG create returns a retryable 503 when Supabase Auth is unavailable', async () => {
	reset();
	const response = await wgCreate.POST(
		request('/api/wg', { method: 'POST', body: { name: 'Sonnenallee', creatorName: 'Mia' } }),
	);

	await assertAuthOutage(response);
});
