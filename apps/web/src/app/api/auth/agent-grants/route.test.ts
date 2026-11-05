import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { GET } = await import('./route');
const { POST: revoke } = await import('./revoke/route');

// biome-ignore lint/suspicious/noExplicitAny: the fake replaces the oauth namespace of the client
const oauth = (methods: Record<string, unknown>) => ((kit.auth as any).oauth = methods);
const authError = (status: number) =>
	Object.assign(new Error('x'), { status, code: 'unexpected_failure', __isAuthError: true });
const CLIENT = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

test('lists the connected agents and passes a failure on', async () => {
	oauth({
		listGrants: async () => ({
			data: [{ client: { id: CLIENT, name: '' }, granted_at: '2026-11-04T10:00:00Z' }],
			error: null,
		}),
	});
	assert.deepEqual((await call(GET, '/api/auth/agent-grants')).json, {
		agents: [{ clientId: CLIENT, name: null, grantedAt: '2026-11-04T10:00:00Z' }],
	});
	oauth({ listGrants: async () => ({ data: null, error: authError(500) }) });
	assert.equal((await call(GET, '/api/auth/agent-grants')).status, 500);
});

test('disconnecting revokes that client; 404 counts as done, other failures do not', async () => {
	let revoked: unknown;
	oauth({
		revokeGrant: async (args: unknown) => {
			revoked = args;
			return { data: {}, error: null };
		},
	});
	const ok = await call(revoke, '/api/auth/agent-grants/revoke', { clientId: CLIENT });
	assert.deepEqual([ok.json, revoked], [{ ok: true }, { clientId: CLIENT }]);

	oauth({ revokeGrant: async () => ({ data: null, error: authError(404) }) });
	assert.equal(
		(await call(revoke, '/api/auth/agent-grants/revoke', { clientId: CLIENT })).status,
		200,
	);
	oauth({ revokeGrant: async () => ({ data: null, error: authError(500) }) });
	assert.equal(
		(await call(revoke, '/api/auth/agent-grants/revoke', { clientId: CLIENT })).status,
		500,
	);
	assert.equal(
		(await call(revoke, '/api/auth/agent-grants/revoke', { clientId: 'all' })).status,
		400,
	);
});
