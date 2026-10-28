import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { NextRequest, NextResponse } from 'next/server';

const state = {
	signedIn: true,
	updates: [] as Record<string, unknown>[],
	metadata: [] as unknown[],
	metadataFails: false,
	dbFails: false,
};

mock.module('@/core/auth/server', {
	namedExports: {
		createSupabaseServerClient: () => ({
			auth: {
				updateUser: async (args: unknown) => {
					state.metadata.push(args);
					return { error: state.metadataFails ? new Error('auth down') : null };
				},
			},
		}),
	},
});
mock.module('@/core/auth/supabase-env', { namedExports: { hasSupabaseEnv: () => true } });
mock.module('@/core/db', {
	namedExports: {
		db: {
			update: () => ({
				set: (row: Record<string, unknown>) => ({
					where: async () => {
						if (state.dbFails) throw new Error('db down');
						state.updates.push(row);
					},
				}),
			}),
		},
		wgMembers: { authUserId: 'authUserId' },
	},
});
mock.module('@/core/guards/require-account', {
	namedExports: {
		requireAccount: async () =>
			state.signedIn
				? { ok: true, user: { id: 'user-1' } }
				: { ok: false, response: NextResponse.json({ error: 'auth_required' }, { status: 401 }) },
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('drizzle-orm', { namedExports: { eq: (...parts: unknown[]) => ({ parts }) } });

const { PATCH } = await import('./locale-patch');

const patch = (body: unknown) =>
	PATCH(
		new NextRequest('https://app.example.test/api/account', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);

beforeEach(() => {
	Object.assign(state, {
		signedIn: true,
		updates: [],
		metadata: [],
		metadataFails: false,
		dbFails: false,
	});
});

test('stores the locale on every membership row and in the account metadata', async () => {
	const res = await patch({ locale: 'en' });
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { locale: 'en' });
	assert.deepEqual(state.updates, [{ locale: 'en' }]);
	assert.deepEqual(state.metadata, [{ data: { locale: 'en' } }]);
});

test('an unsupported locale is a 400 with a code and writes nothing', async () => {
	const res = await patch({ locale: 'fr' });
	assert.equal(res.status, 400);
	assert.equal(((await res.json()) as { error: string }).error, 'locale_invalid');
	assert.deepEqual(state.updates, []);
});

test('without a session the answer is 401 and nothing is written', async () => {
	state.signedIn = false;
	const res = await patch({ locale: 'en' });
	assert.equal(res.status, 401);
	assert.deepEqual(state.updates, []);
});

test('a failing metadata write keeps the saved choice', async () => {
	state.metadataFails = true;
	const res = await patch({ locale: 'de' });
	assert.equal(res.status, 200);
	assert.deepEqual(state.updates, [{ locale: 'de' }]);
});

test('a failing membership update answers 500', async () => {
	state.dbFails = true;
	const res = await patch({ locale: 'en' });
	assert.equal(res.status, 500);
	assert.deepEqual(state.metadata, []);
});
