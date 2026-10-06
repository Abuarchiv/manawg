import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../tests/support/db-mock';
import {
	mockObservability,
	mockRateLimit,
	request,
	routeCtx,
} from '../../../../../tests/support/route-harness';

const state = {
	user: null as { id: string } | null,
	events: [] as string[],
	wgLookups: [] as unknown[],
};

mockObservability();
mockRateLimit();
mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			state.events.push('user');
			return state.user;
		},
	},
});
mockDb({
	db: {
		query: {
			wgs: {
				findFirst: async (query: unknown) => {
					state.events.push('wg');
					state.wgLookups.push(query);
					return undefined;
				},
			},
		},
	},
});

const { GET } = await import('./route');

function get(code: string) {
	state.events = [];
	state.wgLookups = [];
	return GET(request(`/api/wg/${code}`), routeCtx({ code }));
}

test('the WG root rejects a malformed share code before it authenticates or looks anything up', async () => {
	state.user = { id: 'user-1' };
	const response = await get('not-a-code');
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'invalid_share_code' });
	assert.deepEqual(state.events, []);
});

test('the WG root authenticates before it looks up a live share code', async () => {
	state.user = null;
	const anonymous = await get('MTE8PZAT');
	assert.equal(anonymous.status, 401);
	assert.deepEqual(state.events, ['user']);
	assert.deepEqual(state.wgLookups, []);

	state.user = { id: 'user-1' };
	const unknown = await get('MTE8PZAT');
	assert.equal(unknown.status, 404);
	assert.deepEqual(await unknown.json(), { error: 'wg_not_found' });
	assert.deepEqual(state.events, ['user', 'wg']);
});
