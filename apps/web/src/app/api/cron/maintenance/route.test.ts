import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { withEnv } from '../../../../../tests/support/env';

const keys = [
	'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
	'manawg/11111111-1111-4111-8111-111111111111/expense/33333333-3333-4333-8333-333333333333.jpg',
	'manawg/11111111-1111-4111-8111-111111111111/announcement/44444444-4444-4444-8444-444444444444.png',
] as [string, string, string];

const state = {
	keys: [] as string[],
	referenced: new Set<string>(),
	pending: 0,
	removeError: null as Error | null,
	removed: [] as string[],
	marked: [] as string[],
	dequeued: [] as string[],
	events: [] as string[],
};

mock.module('@/core/auth/delete-user', { namedExports: { deleteAuthUser: async () => true } });
mock.module('@/core/auth/supabase-env', {
	namedExports: { getSupabaseEnv: () => null, hasSupabaseEnv: () => false },
});
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
		dequeueImageDeletions: async (objectKeys: string[]) => {
			state.events.push('dequeue');
			state.dequeued = objectKeys;
		},
		markPrivateImageStorageDeleted: async (objectKeys: string[]) => {
			state.events.push('mark');
			state.marked = objectKeys;
		},
		countPendingPrivateImageDeletions: async () => {
			state.events.push('pending');
			return state.pending;
		},
		purgeFinishedPrivateImageDeletions: async () => 0,
	},
});
mock.module('@/core/mail/mail-retention', {
	namedExports: { purgeOldDigestMailLog: async () => 0 },
});
mock.module('@/core/idempotency-store', {
	namedExports: { purgeExpiredIdempotencyResponses: async () => 0 },
});
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: {
		logApiError: (message: string) => state.events.push(`log:${message}`),
		withCronLogging: (_name: string, handler: unknown) => handler,
	},
});
mock.module('@/core/infra/paypal', { namedExports: { isPayPalConfigured: () => false } });
mock.module('@/features/expenses/server/paypal-reconcile', {
	namedExports: { reconcileStaleCapturingPayments: async () => null },
});
mock.module('@/core/db/orphan-uploads', {
	namedExports: { sweepOrphanUploads: async () => ({ wgsChecked: 0, queued: 0 }) },
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		getImageStorageProvider: () => 'aws',
		removeSupabaseImages: async (objectKeys: string[]) => {
			state.events.push('remove');
			state.removed = objectKeys;
			if (state.removeError) throw state.removeError;
		},
	},
});

const { GET } = await import('./route');

function harness() {
	Object.assign(state, {
		keys: [],
		referenced: new Set<string>(),
		pending: 0,
		removeError: null,
		removed: [],
		marked: [],
		dequeued: [],
		events: [],
	});
	return {
		state,
		get: () =>
			GET(
				new Request('https://app.example/api/cron/maintenance', {
					headers: { authorization: 'Bearer test' },
				}) as never,
			),
	};
}

test('maintenance reports reference violations and provider failures while keeping grace-period backlog healthy', async () => {
	await withEnv({ CRON_SECRET: 'test' }, async () => {
		const { state, get } = harness();
		state.pending = 7;
		const idle = await get();
		assert.equal(idle.status, 200);
		assert.equal((await idle.json()).ok, true, 'not-yet-eligible rows do not fail maintenance');

		state.keys = keys;
		state.referenced = new Set([keys[1]]);
		state.pending = 9;
		state.removeError = new Error('provider unavailable');
		const response = await get();
		const body = await response.json();
		assert.equal(response.status, 503);
		assert.deepEqual(state.removed, [keys[0], keys[2]]);
		assert.deepEqual(state.marked, []);
		assert.deepEqual(state.dequeued, [keys[1]]);
		assert.deepEqual(body.privateImageCleanup, {
			attempted: 3,
			completed: 0,
			failed: 2,
			skippedReferenced: 1,
			rescued: 1,
			pending: 9,
			error: 'storage_remove_failed',
		});
		assert.ok(state.events.indexOf('claim') < state.events.indexOf('remove'));

		state.keys = [keys[0], keys[2]];
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

		state.keys = [keys[1]];
		state.referenced = new Set([keys[1]]);
		state.dequeued = [];
		const rescuedOnly = await get();
		const rescuedBody = await rescuedOnly.json();
		assert.equal(rescuedOnly.status, 200, 'a successful rescue is not a maintenance failure');
		assert.equal(rescuedBody.ok, true);
		assert.equal(rescuedBody.privateImageCleanup.rescued, 1);
		assert.deepEqual(state.dequeued, [keys[1]]);
	});
});
