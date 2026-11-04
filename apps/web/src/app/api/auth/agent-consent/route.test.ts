import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { GET, POST } = await import('./route');

// biome-ignore lint/suspicious/noExplicitAny: the fake replaces the oauth namespace of the client
const oauth = (methods: Record<string, unknown>) => ((kit.auth as any).oauth = methods);

test('shows who asks for consent, without the redirect target', async () => {
	oauth({
		getAuthorizationDetails: async (id: string) => ({
			data: {
				authorization_id: id,
				redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
				client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai/', logo_uri: '' },
				user: { id: 'u1', email: 'mina@example.test' },
				scope: 'email',
			},
			error: null,
		}),
	});
	const res = await call(GET, '/api/auth/agent-consent?authorization_id=abc-123');
	assert.deepEqual(res.json, {
		status: 'consent',
		authorizationId: 'abc-123',
		clientName: 'Claude',
		clientHost: 'claude.ai',
		email: 'mina@example.test',
	});
});

test('returns a decision as the redirect back to the agent, and refuses script URLs', async () => {
	let approved = '';
	oauth({
		approveAuthorization: async (id: string, options: { skipBrowserRedirect?: boolean }) => {
			approved = `${id}:${options.skipBrowserRedirect}`;
			return {
				data: { redirect_url: 'http://localhost:33418/callback?code=x&state=y' },
				error: null,
			};
		},
		denyAuthorization: async () => ({ data: { redirect_url: 'javascript:alert(1)' }, error: null }),
	});
	const approve = await call(POST, '/api/auth/agent-consent', {
		authorizationId: 'abc-123',
		approve: true,
	});
	assert.equal(approved, 'abc-123:true');
	assert.deepEqual(approve.json, {
		status: 'redirect',
		redirectUrl: 'http://localhost:33418/callback?code=x&state=y',
	});

	const deny = await call(POST, '/api/auth/agent-consent', {
		authorizationId: 'abc-123',
		approve: false,
	});
	assert.deepEqual(deny.json, { status: 'invalid' });
});

test('an expired request is invalid, a missing session is 401', async () => {
	const gone = Object.assign(new Error('gone'), {
		status: 404,
		code: 'not_found',
		__isAuthError: true,
	});
	oauth({ getAuthorizationDetails: async () => ({ data: null, error: gone }) });
	const expired = await call(GET, '/api/auth/agent-consent?authorization_id=abc-123');
	assert.deepEqual(expired.json, { status: 'invalid' });

	const malformed = await call(GET, '/api/auth/agent-consent?authorization_id=../x');
	assert.deepEqual(malformed.json, { status: 'invalid' });

	oauth({
		getAuthorizationDetails: async () => ({ data: null, error: new AuthSessionMissingError() }),
	});
	const signedOut = await call(GET, '/api/auth/agent-consent?authorization_id=abc-123');
	assert.equal(signedOut.status, 401);
});
