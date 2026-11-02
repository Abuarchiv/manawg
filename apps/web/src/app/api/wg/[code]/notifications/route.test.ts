import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '@/core/db/transaction-abort';

const key = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';

const state = {
	activeMember: true,
	replay: false,
	updates: [] as Record<string, unknown>[],
	audits: [] as Record<string, unknown>[],
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: Record<string, unknown>) => state.audits.push(event),
	},
});
mock.module('@/core/db', { namedExports: { db: {}, wgMembers: {} } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () => (state.activeMember ? { id: memberId } : null),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({}),
	},
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		rejectWrite: (response: { status: number }) => ({
			status: response.status,
			body: null,
			context: { rejected: response },
		}),
		withIdempotentWrite: async (
			options: { beforeReplay?: () => Promise<unknown> },
			write: (tx: unknown) => Promise<{ status: number; body: unknown; context?: unknown }>,
		) => {
			if (state.replay) {
				const blocked = await options.beforeReplay?.();
				if (blocked) return { kind: 'stopped', response: blocked };
				return { kind: 'replayed', status: 200, body: { ok: true } };
			}
			const outcome = await write({});
			return { kind: 'written', ...outcome };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId, name: 'Member' },
			authUserId: 'auth-1',
		}),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: () => key },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotification: async () => undefined, NoPushSubscriptionError: Error },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		notifTestLimiter: {},
		wgWriteLimiter: {},
		checkRateLimit: async () => ({ success: true }),
	},
});
mock.module('./notification-writes', {
	namedExports: {
		subscribePush: async () => ({ name: 'Member' }),
		unsubscribePush: async () => ({ name: 'Member', pushOptIn: false, endpointInUse: false }),
		updateNotificationSettings: async (
			_tx: unknown,
			_writer: unknown,
			update: Record<string, unknown>,
		) => {
			state.updates.push(update);
			return { name: 'Member', changed: Object.keys(update) };
		},
	},
});

const { PATCH } = await import('./route');

function reset() {
	state.activeMember = true;
	state.replay = false;
	state.updates = [];
	state.audits = [];
}

function patch(body: unknown) {
	return PATCH(
		new Request('https://example.invalid', {
			method: 'PATCH',
			headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
}

test('quiet hours outside 0-23 or not whole hours are answered with quiet_hours_invalid', async () => {
	reset();
	for (const body of [
		{ quietStartHour: 24 },
		{ quietEndHour: -1 },
		{ quietStartHour: 1.5 },
		{ quietEndHour: 99 },
		{ quietEndHour: 6.5 },
	]) {
		const response = await patch(body);
		assert.equal(response.status, 400, JSON.stringify(body));
		assert.deepEqual(await response.json(), { error: 'quiet_hours_invalid' });
		assert.deepEqual(state.updates, []);
	}
});

test('quiet hours within 0-23 and null are passed on together with the toggles', async () => {
	reset();
	const response = await patch({ quietStartHour: 22, quietEndHour: 7, notifyChat: false });
	assert.equal(response.status, 200);
	assert.deepEqual(state.updates, [{ notifyChat: false, quietStartHour: 22, quietEndHour: 7 }]);
	reset();
	await patch({ quietStartHour: 0, quietEndHour: null });
	assert.deepEqual(state.updates, [{ quietStartHour: 0, quietEndHour: null }]);
});

test('a replayed save from a moved-out member is refused instead of answered from the cache', async () => {
	reset();
	state.activeMember = false;
	state.replay = true;
	const response = await patch({ notifyChat: false });
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), {
		error: 'member_deactivated',
		code: 'member_deactivated',
	});
	assert.deepEqual(state.updates, []);
});
