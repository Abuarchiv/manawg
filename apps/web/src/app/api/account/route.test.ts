import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '@/core/db/transaction-abort';

const userId = '12d54242-a3ba-47b9-9254-f152f1e44eb0';
const accountDeletions = { authUserId: 'authUserId', completedAt: 'completedAt' };
const auditEvents = { id: 'id' };

const state = {
	outcome: 'commit-then-throw',
	completedAt: null as Date | null,
	statusReadFails: false,
	fenceCommitted: false,
	statusReads: 0,
	authCompletionAttempts: 0,
	left: [] as unknown[],
	audits: [] as Array<Record<string, unknown>>,
};

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
			values: async (row: Record<string, unknown>) => {
				assert.equal(table, auditEvents);
				state.audits.push(row);
			},
		};
	},
};

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
	namedExports: {
		createSupabaseServerClient: () => undefined,
		getAuthenticatedUser: async () => ({ id: userId }),
	},
});
mock.module('@/core/db', {
	namedExports: { accountDeletions, auditEvents, db: {}, wgMembers: {} },
});
mock.module('@/core/mail/account-deleted', {
	namedExports: {
		confirmedEmailOf: async () => null,
		sendAccountDeletedMail: async () => undefined,
	},
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
			return { left: state.left, deletedWgIds: [] };
		},
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction: async (operation: (tx: unknown) => Promise<unknown>) => {
			const result = await operation(tx);
			if (state.outcome === 'commit-then-throw') {
				throw new Error('connection lost after the server committed');
			}
			if (state.outcome === 'rollback') {
				state.fenceCommitted = false;
				throw new Error('transaction rolled back');
			}
			return result;
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('drizzle-orm', { namedExports: { eq: (...parts: unknown[]) => ({ parts }) } });

const { DELETE } = await import('./route');

function harness({
	outcome = 'commit-then-throw',
	completedAt = null as Date | null,
	statusReadFails = false,
} = {}) {
	Object.assign(state, {
		outcome,
		completedAt,
		statusReadFails,
		fenceCommitted: false,
		statusReads: 0,
		authCompletionAttempts: 0,
		left: [],
		audits: [],
	});
	process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key';
	const request = new Request('https://example.test/api/account', { method: 'DELETE' });
	Object.defineProperty(request, 'cookies', {
		value: { getAll: () => [{ name: 'sb-test-auth-token', value: 'stale-cookie' }] },
	});
	return {
		state,
		deleteAccount: async () => {
			const response = await DELETE(request as never);
			return Object.assign(response, { clearedCookies: response.headers.getSetCookie() });
		},
	};
}

test('committed fence followed by a lost COMMIT acknowledgement returns accepted pending', async () => {
	const { state, deleteAccount } = harness();
	const response = await deleteAccount();
	assert.equal(response.status, 202);
	assert.deepEqual(await response.json(), { status: 'pending' });
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(response.clearedCookies.length, 2);
});

test('completed fence followed by a lost COMMIT acknowledgement returns completed', async () => {
	const { state, deleteAccount } = harness({ completedAt: new Date('2026-09-25T00:00:00.000Z') });
	const response = await deleteAccount();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { status: 'completed' });
	assert.equal(state.statusReads, 1);
	assert.equal(response.clearedCookies.length, 2);
});

test('confirmed rollback with no fence returns failure and does not attempt Auth deletion', async () => {
	const { state, deleteAccount } = harness({ outcome: 'rollback' });
	const response = await deleteAccount();
	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'account_deletion_failed' });
	assert.equal(state.fenceCommitted, false);
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(response.clearedCookies.length, 0);
});

test('unavailable fence status check returns an explicit unconfirmed outcome', async () => {
	const { state, deleteAccount } = harness({ statusReadFails: true });
	const response = await deleteAccount();
	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), {
		status: 'unknown',
		error: 'account_deletion_outcome_unconfirmed',
	});
	assert.equal(state.statusReads, 1);
	assert.equal(state.authCompletionAttempts, 0);
	assert.equal(response.clearedCookies.length, 0);
});

test('the audit entry names the member who takes over as admin', async () => {
	const { state, deleteAccount } = harness();
	state.left = [
		{ wgId: 'wg-1', memberId: 'm1', name: 'Jonas', newAdminId: 'm2', newAdminName: 'Lena' },
		{ wgId: 'wg-2', memberId: 'm3', name: 'Jonas', newAdminId: null, newAdminName: null },
	];
	await deleteAccount();
	assert.equal(
		state.audits[0]?.summary,
		'Jonas hat die Kontolöschung angefragt und ist ausgezogen. Lena ist jetzt Admin.',
	);
	assert.equal(
		state.audits[1]?.summary,
		'Jonas hat die Kontolöschung angefragt und ist ausgezogen.',
	);
	assert.match(String(state.audits[0]?.metadataJson), /"newAdminId":"m2"/);
});
