import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../tests/support/drizzle-mock';
import { mockObservability, request } from '../../../../tests/support/route-harness';
import { TransactionAbort } from '../../../core/db/transaction-abort';

const userId = '12d54242-a3ba-47b9-9254-f152f1e44eb0';
const accountDeletions = { authUserId: 'authUserId', completedAt: 'completedAt' };
const auditEvents = { id: 'id' };

type Outcome = 'commit-then-throw' | 'rollback';

const state = {
	outcome: 'commit-then-throw' as Outcome,
	statusReadFails: false,
	fenceCommitted: false,
	completedAt: null as Date | null,
	statusReads: 0,
	authCompletionAttempts: 0,
};

function given(
	options: { outcome?: Outcome; completedAt?: Date | null; statusReadFails?: boolean } = {},
) {
	state.outcome = options.outcome ?? 'commit-then-throw';
	state.statusReadFails = options.statusReadFails ?? false;
	state.fenceCommitted = false;
	state.completedAt = options.completedAt ?? null;
	state.statusReads = 0;
	state.authCompletionAttempts = 0;
}

const tx = {
	select() {
		let table: unknown;
		const query = {
			from(value: unknown) {
				table = value;
				return query;
			},
			where() {
				return query;
			},
			limit: async () => {
				assert.equal(table, accountDeletions);
				return state.fenceCommitted ? [{ completedAt: state.completedAt }] : [];
			},
		};
		return query;
	},
	insert(table: unknown) {
		return {
			values: async () => {
				assert.equal(table, auditEvents);
			},
		};
	},
};

mockDrizzle();
mockObservability();
mockDb({ accountDeletions, auditEvents });
mock.module('@/core/auth/delete-user', {
	namedExports: {
		deleteAuthUser: async () => {
			state.authCompletionAttempts += 1;
			return true;
		},
	},
});
mock.module('@/core/auth/supabase-env', {
	namedExports: {
		getSupabaseEnv: () => ({ url: 'https://auth.example.test' }),
		hasSupabaseEnv: () => true,
	},
});
mock.module('@/core/auth/server', {
	namedExports: { getAuthenticatedUser: async () => ({ id: userId }) },
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		tryCompleteAccountDeletion: async () => {
			state.authCompletionAttempts += 1;
			return false;
		},
		readAccountDeletionStatusWithFreshConnection: async (authUserId: string) => {
			assert.equal(authUserId, userId);
			state.statusReads += 1;
			if (state.statusReadFails) throw new Error('status read unavailable');
			return state.fenceCommitted ? { completedAt: state.completedAt } : null;
		},
	},
});
mock.module('@/core/db/delete-account', {
	namedExports: {
		removeAccountFromWgs: async () => {
			state.fenceCommitted = true;
			return { left: [], deletedWgIds: [] };
		},
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		// Every transaction here ends in an error: a lost COMMIT acknowledgement or a rollback.
		withTransaction: async (operation: (handle: typeof tx) => Promise<unknown>): Promise<never> => {
			await operation(tx);
			if (state.outcome === 'commit-then-throw') {
				throw new Error('connection lost after the server committed');
			}
			state.fenceCommitted = false;
			throw new Error('transaction rolled back');
		},
	},
});

process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key';
const { DELETE } = await import('./route');

async function deleteAccount() {
	const response = await DELETE(
		request('/api/account', {
			method: 'DELETE',
			headers: { cookie: 'sb-test-auth-token=stale-cookie' },
		}),
	);
	const cleared = response.headers
		.getSetCookie()
		.filter((cookie) => cookie.startsWith('sb-test-auth-token=;'));
	return { response, cleared };
}

test('committed fence followed by a lost COMMIT acknowledgement returns accepted pending', async () => {
	given();
	const { response, cleared } = await deleteAccount();
	assert.equal(response.status, 202);
	assert.deepEqual(await response.json(), { status: 'pending' });
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(cleared.length, 1);
});

test('completed fence followed by a lost COMMIT acknowledgement returns completed', async () => {
	given({ completedAt: new Date('2026-09-25T00:00:00.000Z') });
	const { response, cleared } = await deleteAccount();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { status: 'completed' });
	assert.equal(state.statusReads, 1);
	assert.equal(cleared.length, 1);
});

test('confirmed rollback with no fence returns failure and does not attempt Auth deletion', async () => {
	given({ outcome: 'rollback' });
	const { response, cleared } = await deleteAccount();
	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'account_deletion_failed' });
	assert.equal(state.fenceCommitted, false);
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(cleared.length, 0);
});

test('unavailable fence status check returns an explicit unconfirmed outcome', async () => {
	given({ statusReadFails: true });
	const { response, cleared } = await deleteAccount();
	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), {
		status: 'unknown',
		error: 'account_deletion_outcome_unconfirmed',
	});
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(cleared.length, 0);
});
