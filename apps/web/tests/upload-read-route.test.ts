import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest, NextResponse } from 'next/server';

// Private reads stream from Supabase Storage whatever the configured upload provider is, and only
// after the caller is authenticated and still a member of the key's WG.

const PRIVATE_KEY =
	'manawg/989ac820-58b7-431f-9c65-28721264f333/expense/550e8400-e29b-41d4-a716-446655440000.png';

const state = {
	authenticatedUser: { id: 'user-1' } as { id: string } | null,
	authOutage: false,
	membership: 'active' as 'active' | 'foreign' | 'revoked',
	membershipCalls: 0,
	downloadCalls: 0,
	downloadedKeys: [] as string[],
};

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			if (state.authOutage) throw new Error('AuthRetryableFetchError');
			return state.authenticatedUser;
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: { isPrivateImageKeyRevoked: async () => false },
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		requireMember: async () => {
			state.membershipCalls += 1;
			return state.membership === 'active'
				? { ok: true, member: { memberId: 'member-1', name: 'Member' } }
				: {
						ok: false,
						response: NextResponse.json(
							{ error: state.membership === 'revoked' ? 'member_deactivated' : 'not_a_member' },
							{ status: 401 },
						),
					};
		},
	},
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError: class extends Error {},
		ImageStorageObjectNotFoundError: class extends Error {},
		downloadSupabaseImage: async (key: string) => {
			state.downloadCalls += 1;
			state.downloadedKeys.push(key);
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3]));
						controller.close();
					},
				}),
				contentType: 'image/png',
				contentLength: 3,
			};
		},
	},
});

const route = await import('../src/app/api/upload/read/route');

test('private reads use Supabase after an AWS rollback and re-check membership', async () => {
	const originalProvider = process.env.IMAGE_STORAGE_PROVIDER;
	const originalFetch = globalThis.fetch;
	let awsFetches = 0;
	globalThis.fetch = (async () => {
		awsFetches += 1;
		throw new Error('AWS private read must not fetch');
	}) as typeof fetch;
	process.env.IMAGE_STORAGE_PROVIDER = 'aws';
	const request = new NextRequest(
		`https://app.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
	);

	try {
		// A transient Auth outage is retryable: 503, no-store, and no membership
		// lookup or storage read before the caller is known.
		state.authOutage = true;
		const outage = await route.GET(request);
		assert.equal(outage.status, 503);
		assert.deepEqual(await outage.json(), { error: 'db_error' });
		assert.equal(outage.headers.get('cache-control'), 'no-store');
		assert.equal(state.membershipCalls, 0);
		assert.equal(state.downloadCalls, 0);
		state.authOutage = false;

		state.authenticatedUser = null;
		const guest = await route.GET(request);
		assert.equal(guest.status, 401);
		assert.equal(state.downloadCalls, 0);

		state.authenticatedUser = { id: 'user-1' };
		state.membership = 'foreign';
		const foreign = await route.GET(request);
		assert.equal(foreign.status, 401);
		assert.equal(state.downloadCalls, 0);

		state.membership = 'active';
		const response = await route.GET(request);
		assert.equal(response.status, 200);
		assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
		assert.equal(response.headers.get('cache-control'), 'private, no-store');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(response.headers.get('location'), null);
		assert.deepEqual(state.downloadedKeys, [PRIVATE_KEY]);

		state.membership = 'revoked';
		const revoked = await route.GET(request);
		assert.equal(revoked.status, 401);
		assert.equal(state.downloadCalls, 1);
		assert.equal(awsFetches, 0);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalProvider === undefined)
			Reflect.deleteProperty(process.env, 'IMAGE_STORAGE_PROVIDER');
		else process.env.IMAGE_STORAGE_PROVIDER = originalProvider;
	}
});
