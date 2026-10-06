import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// The browser names the member a tab was rendered for; the server checks it only after the
// cookie session resolved a membership.

const guardState = { authenticated: false, membershipResolved: false };

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			guardState.authenticated = true;
			return { id: 'user-a' };
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			query: {
				wgMembers: {
					findFirst: async () => {
						guardState.membershipResolved = true;
						return { id: 'member-a', name: 'A', deactivatedAt: null };
					},
				},
			},
		},
		wgMembers: {},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException() {}, logApiError() {} },
});
mock.module('drizzle-orm', {
	namedExports: { and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args },
});

const { apiFetch } = await import('@/core/infra/api-client');
const { requireMember } = await import('@/core/guards/api-auth');

test('API client sends only the expected member header, never a member id or token', async (t) => {
	let sentHeaders = new Headers();
	let sentSignal: AbortSignal | null | undefined;
	t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
		sentHeaders = new Headers(init.headers);
		sentSignal = init.signal;
		return new Response(null, { status: 204 });
	});
	const controller = new AbortController();
	await apiFetch('/api/wg/TEST1234/announcements', {
		method: 'POST',
		memberId: 'member-a',
		body: '{}',
		signal: controller.signal,
	});
	assert.equal(sentHeaders.get('x-manawg-expected-member-id'), 'member-a');
	assert.equal(sentHeaders.has('x-manawg-member-id'), false);
	assert.equal(sentHeaders.has('x-manawg-member-token'), false);
	assert.notEqual(sentSignal, controller.signal);
	controller.abort();
	assert.equal(sentSignal?.aborted, true);
});

test('server guard rejects a stale expected member only after cookie membership lookup', async () => {
	const request = (expectedMemberId: string) =>
		new Request('https://app.test/api/wg/TEST1234', {
			method: 'POST',
			headers: { 'x-manawg-expected-member-id': expectedMemberId },
		}) as never;
	const result = await requireMember(request('member-b'), 'wg-1');
	assert.equal(guardState.authenticated, true);
	assert.equal(guardState.membershipResolved, true);
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'member_context_changed');
	assert.equal(result.response.status, 409);
	assert.deepEqual(await result.response.json(), {
		error: 'member_context_changed',
		code: 'member_context_changed',
	});
	const matching = await requireMember(request('member-a'), 'wg-1');
	assert.ok(matching.ok);
	assert.equal(matching.member.memberId, 'member-a');
});
