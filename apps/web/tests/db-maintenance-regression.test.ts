import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from './support/db-mock';
import { request } from './support/route-harness';

// The maintenance cron with the real idempotency purge and the real redacting error log; the
// purge's database, account recovery and image cleanup are stand-ins.

const CRON_SECRET = 'test-secret';

const state = {
	deleteError: new Error('database unavailable') as Error | null,
	imageCleanupRuns: 0,
	recoveryCalls: [] as unknown[],
	recoveryResult: { attempted: 1, completed: 0, failed: 1, pending: 1 },
};

mockDb({
	db: {
		delete: () => ({
			where: () => ({
				returning: async () => {
					if (state.deleteError) throw state.deleteError;
					return [{ key: 'expired' }];
				},
			}),
		}),
	},
});
mock.module('@/core/infra/sentry', {
	namedExports: {
		captureSentryException: () => undefined,
		logSentryApiError: () => undefined,
		initializeSentry: () => undefined,
	},
});
mock.module('@/core/auth/supabase-env', {
	namedExports: { hasSupabaseEnv: () => false, getSupabaseEnv: () => null },
});
mock.module('@/core/auth/delete-user', { namedExports: { deleteAuthUser: async () => false } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		retryPendingAccountDeletions: async (deleteAuth: unknown) => {
			state.recoveryCalls.push(deleteAuth);
			return state.recoveryResult;
		},
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		claimPrivateImageCleanupBatch: async () => {
			state.imageCleanupRuns++;
			return [];
		},
		countPendingPrivateImageDeletions: async () => 0,
		findLivePrivateImageReferenceKeys: async () => new Set(),
		markPrivateImageStorageDeleted: async () => undefined,
	},
});
mock.module('@/core/infra/paypal', { namedExports: { isPayPalConfigured: () => false } });
mock.module('@/features/expenses/paypal-reconcile', {
	namedExports: { reconcileStaleCapturingPayments: async () => null },
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: { removeSupabaseImages: async () => undefined },
});

const { GET } = await import('../src/app/api/cron/maintenance/route.ts');

const noImageCleanup = {
	attempted: 0,
	completed: 0,
	failed: 0,
	skippedReferenced: 0,
	pending: 0,
	error: null,
};

test('maintenance attempts deletion recovery when idempotency cleanup fails', async (t) => {
	const previousSecret = process.env.CRON_SECRET;
	process.env.CRON_SECRET = CRON_SECRET;
	t.after(() => {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previousSecret;
	});
	const logs: unknown[][] = [];
	t.mock.method(console, 'error', (...args: unknown[]) => {
		logs.push(args);
	});
	const get = () =>
		GET(request('/api/cron/maintenance', { headers: { authorization: `Bearer ${CRON_SECRET}` } }));

	const failedCleanup = await get();
	assert.equal(failedCleanup.status, 503);
	assert.deepEqual(await failedCleanup.json(), {
		ok: false,
		purgedIdempotencyRows: null,
		paypalReconcile: null,
		accountDeletions: { ...state.recoveryResult, authAdminAvailable: false },
		privateImageCleanup: noImageCleanup,
	});
	assert.equal(state.recoveryCalls.length, 1);
	assert.equal(state.recoveryCalls[0], null);
	assert.equal(state.imageCleanupRuns, 1);
	assert.deepEqual(logs.at(-1), ['[maintenance] idempotency cleanup failed', 'Error']);

	state.deleteError = null;
	state.recoveryResult = { attempted: 1, completed: 1, failed: 0, pending: 0 };
	const response = await get();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		ok: true,
		purgedIdempotencyRows: 1,
		paypalReconcile: null,
		accountDeletions: { ...state.recoveryResult, authAdminAvailable: false },
		privateImageCleanup: noImageCleanup,
	});
	assert.equal(state.recoveryCalls.length, 2);
	assert.equal(state.imageCleanupRuns, 2);
});
