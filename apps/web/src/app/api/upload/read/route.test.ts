import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextResponse } from 'next/server';
import { mockObservability, request } from '../../../../../tests/support/route-harness';

const wgId = '11111111-1111-4111-8111-111111111111';
const key = `manawg/${wgId}/expense/22222222-2222-4222-8222-222222222222.jpg`;

const state = {
	revoked: true,
	revocationError: null as Error | null,
	user: { id: 'user-id' } as { id: string } | null,
	authError: null as Error | null,
	memberResponse: null as NextResponse | null,
	events: [] as string[],
	memberCalls: [] as { wgId: string; userId: string }[],
	downloads: [] as string[],
};

class ImageStorageConfigurationError extends Error {}
class ImageStorageObjectNotFoundError extends Error {}

mockObservability();
mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			state.events.push('user');
			if (state.authError) throw state.authError;
			return state.user;
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		requireMember: async (_req: unknown, memberWgId: string, user: { id: string }) => {
			state.events.push('member');
			state.memberCalls.push({ wgId: memberWgId, userId: user.id });
			if (state.memberResponse) return { ok: false, response: state.memberResponse };
			return { ok: true, member: { memberId: 'member-id' } };
		},
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		isPrivateImageKeyRevoked: async () => {
			state.events.push('revocation');
			if (state.revocationError) throw state.revocationError;
			return state.revoked;
		},
	},
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError,
		ImageStorageObjectNotFoundError,
		downloadSupabaseImage: async (downloadKey: string) => {
			state.events.push('download');
			state.downloads.push(downloadKey);
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('image-bytes'));
						controller.close();
					},
				}),
				contentType: 'image/jpeg',
				contentLength: 11,
			};
		},
	},
});

const { GET } = await import('./route');

function reset(): void {
	state.revoked = false;
	state.revocationError = null;
	state.user = { id: 'user-id' };
	state.authError = null;
	state.memberResponse = null;
	state.events = [];
	state.memberCalls = [];
	state.downloads = [];
}

function get(rawKey: string | null = key) {
	state.events = [];
	const query = rawKey === null ? '' : `?key=${encodeURIComponent(rawKey)}`;
	return GET(request(`/api/upload/read${query}`));
}

test('revoked image reads stop after membership authorization and return no-store 404', async () => {
	reset();
	state.revoked = true;
	const response = await get();
	assert.equal(response.status, 404);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user', 'member', 'revocation']);
});

test('a revocation lookup failure fails closed before provider download', async () => {
	reset();
	state.revocationError = new Error('database unavailable');
	const response = await get();
	assert.equal(response.status, 500);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user', 'member', 'revocation']);
});

test('a missing or malformed key is rejected before any auth or storage lookup', async () => {
	for (const rawKey of [
		null,
		'../outside.png',
		'manawg/not-a-uuid/expense/image.png',
		`https://images.example/${key}`,
	]) {
		reset();
		const response = await get(rawKey);
		assert.equal(response.status, 400, String(rawKey));
		assert.deepEqual(await response.json(), { error: 'invalid_image_key' });
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.deepEqual(state.events, []);
	}
});

test('an anonymous read answers 401 auth_required without a membership or storage lookup', async () => {
	reset();
	state.user = null;
	const response = await get();
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), { error: 'auth_required', code: 'auth_required' });
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user']);
});

test('an Auth outage is a retryable 503, not an anonymous caller', async () => {
	reset();
	state.authError = new Error('auth unavailable');
	const response = await get();
	assert.equal(response.status, 503);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user']);
});

test('a key of a foreign WG is authorized against that WG and denied before streaming', async () => {
	reset();
	state.memberResponse = NextResponse.json({ error: 'not_a_member' }, { status: 403 });
	const response = await get();
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_a_member' });
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.memberCalls, [{ wgId, userId: 'user-id' }]);
	assert.deepEqual(state.events, ['user', 'member']);
	assert.deepEqual(state.downloads, []);
});

test('a member read streams the private bytes through the server instead of redirecting', async () => {
	reset();
	const response = await get();
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('location'), null);
	assert.equal(response.headers.get('cache-control'), 'private, no-store');
	assert.equal(response.headers.get('content-type'), 'image/jpeg');
	assert.equal(response.headers.get('content-length'), '11');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(await response.text(), 'image-bytes');
	assert.deepEqual(state.events, ['user', 'member', 'revocation', 'download']);
	assert.deepEqual(state.downloads, [key]);
});
