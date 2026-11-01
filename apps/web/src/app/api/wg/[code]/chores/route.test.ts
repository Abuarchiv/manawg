import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '@/core/db/transaction-abort';

const wgId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';

const inserts: Record<string, unknown>[] = [];
// False when the assignee moved out; the in-transaction member lock then finds no row.
let memberActive = true;
let lockedMemberIds: string[] = [];

const chores = { name: 'chores' };
const tx = {
	insert: () => ({
		values: (values: Record<string, unknown>) => ({
			returning: async () => {
				inserts.push(values);
				return [{ id: 'chore-1', title: values.title, ...values }];
			},
		}),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: {
		CHORE_RECURRENCE_TYPES: ['days', 'months'],
		choreCompletions: {},
		chores,
		db: {},
		wgMembers: {},
	},
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		bodyCodec: () => ({}),
		// The write's outcome carries the rejection the route answers with.
		rejectWrite: (response: { status: number }) => ({
			status: response.status,
			body: null,
			context: { rejected: response },
		}),
		withIdempotentWrite: async (
			options: { prepare?: () => Promise<{ stop: unknown } | { input: unknown }> },
			write: (
				tx: unknown,
				input: unknown,
			) => Promise<{ status: number; body: unknown; context: unknown }>,
		) => {
			const prepared = await options.prepare?.();
			if (prepared && 'stop' in prepared) return { kind: 'stopped', response: prepared.stop };
			const outcome = await write(tx, undefined);
			return { kind: 'written', ...outcome };
		},
	},
});
mock.module('@/core/db/member-departure', {
	namedExports: {
		lockActiveMember: async (_tx: unknown, _wgId: string, memberId: string) => {
			lockedMemberIds.push(memberId);
			return memberActive;
		},
	},
});
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort } });
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId: actorId, name: 'Alex' },
		}),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: () => null, setReplayWarning: async () => true },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});

const { POST } = await import('./route');

function post(body: unknown) {
	inserts.length = 0;
	lockedMemberIds = [];
	return POST(
		new Request('https://example.invalid/x', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
}

test('POST creates a chore for an active assignee under a member lock', async () => {
	memberActive = true;
	const response = await post({ title: 'Bad putzen', assignedMemberId: otherId });
	assert.equal(response.status, 200);
	assert.deepEqual(lockedMemberIds, [otherId]);
	assert.equal(inserts.length, 1);
	assert.equal(inserts[0]?.assignedMemberId, otherId);
});

test('POST without an assignee takes no member lock', async () => {
	memberActive = true;
	const response = await post({ title: 'Bad putzen' });
	assert.equal(response.status, 200);
	assert.deepEqual(lockedMemberIds, []);
	assert.equal(inserts.length, 1);
});

test('POST for a member who moved out is rejected without an insert', async () => {
	memberActive = false;
	const response = await post({ title: 'Bad putzen', assignedMemberId: otherId });
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'member_not_in_wg' });
	assert.equal(inserts.length, 0);
});
