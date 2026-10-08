import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const key =
	'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg';

class ImageStorageConfigurationError extends Error {}
class ImageStorageObjectNotFoundError extends Error {}

const state = {
	revoked: true,
	revocationError: null as Error | null,
	events: [] as string[],
};

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			state.events.push('user');
			return { id: 'user-id' };
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		requireMember: async () => {
			state.events.push('member');
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
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError,
		ImageStorageObjectNotFoundError,
		downloadSupabaseImage: async () => {
			state.events.push('download');
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
mock.module('@/core/validators/image-url', {
	namedExports: {
		parsePrivateImageKey: (value: string) =>
			value === key ? { wgId: '11111111-1111-4111-8111-111111111111' } : null,
	},
});

const { GET } = await import('./route');

function harness() {
	state.revoked = true;
	state.revocationError = null;
	state.events = [];
	return {
		state,
		get: () => {
			const req = new Request(`https://app.example/api/upload/read?key=${encodeURIComponent(key)}`);
			Object.assign(req, { nextUrl: new URL(req.url) });
			return GET(req as never);
		},
	};
}

test('revoked image reads stop after membership authorization and return no-store 404', async () => {
	const { state, get } = harness();
	const response = await get();
	assert.equal(response.status, 404);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user', 'member', 'revocation']);
});

test('a revocation lookup failure fails closed before provider download', async () => {
	const { state, get } = harness();
	state.revocationError = new Error('database unavailable');
	const response = await get();
	assert.equal(response.status, 500);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(state.events, ['user', 'member', 'revocation']);
});
