import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { request } from '../../../../../tests/support/route-harness';

const keys = [
	'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
	'manawg/11111111-1111-4111-8111-111111111111/expense/33333333-3333-4333-8333-333333333333.jpg',
	'manawg/11111111-1111-4111-8111-111111111111/announcement/44444444-4444-4444-8444-444444444444.png',
];

const state = {
	keys: [] as string[],
	referenced: new Set<string>(),
	pending: 0,
	removeError: null as Error | null,
	removed: [] as string[],
	marked: [] as string[],
	events: [] as string[],
};

mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (message: string) => {
			state.events.push(`log:${message}`);
		},
		withCronLogging: <T>(_name: string, handler: T) => handler,
	},
});
mock.module('@/core/auth/delete-user', { namedExports: { deleteAuthUser: async () => true } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		retryPendingAccountDeletions: async (deleteAuthUser: unknown) => {
			assert.equal(deleteAuthUser, null);
			return { attempted: 0, completed: 0, failed: 0, pending: 0 };
		},
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		claimPrivateImageCleanupBatch: async () => {
			state.events.push('claim');
			return state.keys;
		},
		findLivePrivateImageReferenceKeys: async (objectKeys: string[]) => {
			state.events.push('references');
			assert.deepEqual(objectKeys, state.keys);
			return state.referenced;
		},
		markPrivateImageStorageDeleted: async (objectKeys: string[]) => {
			state.events.push('mark');
			state.marked = objectKeys;
		},
		countPendingPrivateImageDeletions: async () => {
			state.events.push('pending');
			return state.pending;
		},
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { purgeExpiredIdempotencyResponses: async () => 0 },
});
mock.module('@/core/infra/paypal', { namedExports: { isPayPalConfigured: () => false } });
mock.module('@/features/expenses/server/paypal-reconcile', {
	namedExports: { reconcileStaleCapturingPayments: async () => null },
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		removeSupabaseImages: async (objectKeys: string[]) => {
			state.events.push('remove');
			state.removed = objectKeys;
			if (state.removeError) throw state.removeError;
		},
	},
});

const { GET } = await import('./route');

const get = () =>
	GET(request('/api/cron/maintenance', { headers: { authorization: 'Bearer test' } }));

test('maintenance reports reference violations and provider failures while keeping grace-period backlog healthy', async () => {
	const previous = {
		secret: process.env.CRON_SECRET,
		serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
	};
	process.env.CRON_SECRET = 'test';
	Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
	try {
		state.pending = 7;
		const idle = await get();
		assert.equal(idle.status, 200);
		assert.equal((await idle.json()).ok, true, 'not-yet-eligible rows do not fail maintenance');

		state.keys = keys;
		state.referenced = new Set([keys[1] as string]);
		state.pending = 9;
		state.removeError = new Error('provider unavailable');
		const response = await get();
		const body = await response.json();
		assert.equal(response.status, 503);
		assert.deepEqual(state.removed, [keys[0], keys[2]]);
		assert.deepEqual(state.marked, []);
		assert.deepEqual(body.privateImageCleanup, {
			attempted: 3,
			completed: 0,
			failed: 2,
			skippedReferenced: 1,
			pending: 9,
			error: 'storage_remove_failed',
		});
		assert.ok(state.events.indexOf('claim') < state.events.indexOf('remove'));

		state.keys = [keys[0] as string, keys[2] as string];
		state.referenced = new Set();
		state.pending = 0;
		state.removeError = null;
		state.marked = [];
		state.events = [];
		const completed = await get();
		const completedBody = await completed.json();
		assert.equal(completed.status, 200);
		assert.equal(completedBody.privateImageCleanup.completed, 2);
		assert.deepEqual(state.marked, [keys[0], keys[2]]);
		assert.ok(state.events.indexOf('remove') < state.events.indexOf('mark'));
	} finally {
		if (previous.secret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previous.secret;
		if (previous.serviceRole !== undefined) {
			process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRole;
		}
	}
});
