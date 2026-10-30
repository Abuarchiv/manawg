import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';

interface Target {
	id: string;
	name: string;
	role: string;
	deactivatedAt: Date | null;
}

const state = {
	actorRole: 'member',
	target: null as Target | null,
	activeCount: 1,
	updates: [] as Record<string, unknown>[],
	deletes: 0,
	releasedChores: 0,
	audits: [] as { eventType: string }[],
};

const wgMembers = {
	id: 'id',
	name: 'name',
	role: 'role',
	wgId: 'wgId',
	deactivatedAt: 'deactivatedAt',
};
const wgs = { id: 'id' };
const pushSubscriptions = { memberId: 'memberId' };

const savepoint = {
	update: () => ({
		set: (values: Record<string, unknown>) => ({
			where: () => ({
				returning: async () => {
					state.updates.push(values);
					return [{ ...state.target, ...values }];
				},
			}),
		}),
	}),
};
const tx = {
	select: () => ({
		from: (table: unknown) => ({
			// Row locks answer with the rows; the plain count query is awaited directly.
			where: () =>
				Object.assign(Promise.resolve([{ active: state.activeCount }]), {
					for: async () => (table === wgMembers && state.target ? [state.target] : []),
				}),
		}),
	}),
	delete: () => ({
		where: async () => {
			state.deletes += 1;
		},
	}),
	transaction: (work: (sp: typeof savepoint) => unknown) => work(savepoint),
};

mock.module('@/core/audit', {
	namedExports: { recordAuditEvent: async (e: { eventType: string }) => state.audits.push(e) },
});
mock.module('@/core/db', { namedExports: { db: {}, pushSubscriptions, wgMembers, wgs } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () => ({ id: actorId, role: state.actorRole }),
	},
});
mock.module('@/core/db/member-departure', {
	namedExports: {
		releaseMemberChores: async () => {
			state.releasedChores += 1;
		},
	},
});
mock.module('@/core/db/member-names', {
	namedExports: {
		availableMemberName: async (_tx: unknown, _wgId: string, name: string) => `${name} 2`,
		releaseMemberName: async () => true,
	},
});
mock.module('@/core/db/schema', { namedExports: { LIMITS: { NAME_MAX: 40 } } });
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: actorId, name: 'Ada' },
			authUserId: 'auth-1',
		}),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/features/expenses/debts', { namedExports: { computeBalances: () => [] } });
mock.module('@/features/expenses/server/expense-ledger', {
	namedExports: { loadExpensesWithSplits: async () => [] },
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		loadCompletedExpensePayments: async () => [],
		withExpensePaymentLock: async (_id: string, fn: (tx: unknown) => unknown) => fn(tx),
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...p: unknown[]) => p,
		count: () => 'count',
		eq: (...p: unknown[]) => p,
		isNull: (p: unknown) => p,
	},
});

const { PATCH } = await import('./route');

function harness({
	actorRole = 'member',
	targetId: id = targetId,
	target = {},
	activeCount = 1,
}: {
	actorRole?: string;
	targetId?: string;
	target?: Partial<Target>;
	activeCount?: number;
} = {}) {
	state.actorRole = actorRole;
	state.target = { id, name: 'Mira', role: 'member', deactivatedAt: null, ...target };
	state.activeCount = activeCount;
	state.updates = [];
	state.deletes = 0;
	state.releasedChores = 0;
	state.audits = [];
	const patch = (body: Record<string, unknown>) =>
		PATCH(
			new Request('https://example.invalid/x', {
				method: 'PATCH',
				body: JSON.stringify(body),
			}) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT', id }) } as never,
		);
	return { patch, state };
}

async function assertRefused(
	res: Response,
	status: number,
	error: string,
	s: typeof state,
): Promise<void> {
	assert.equal(res.status, status);
	assert.equal(((await res.json()) as { error: string }).error, error);
	assert.equal(s.updates.length, 0);
	assert.equal(s.deletes, 0);
	assert.equal(s.audits.length, 0);
}

test('a non-admin cannot move another member out', async () => {
	const { patch, state } = harness();
	await assertRefused(await patch({ active: false }), 403, 'not_owner', state);
});

test('a non-admin cannot rename another member', async () => {
	const { patch, state } = harness();
	await assertRefused(await patch({ name: 'Lena' }), 403, 'not_owner', state);
});

test('an admin cannot move an admin out', async () => {
	const { patch, state } = harness({ actorRole: 'admin', target: { role: 'admin' } });
	await assertRefused(await patch({ active: false }), 403, 'admin_required', state);
});

test('an admin moves a member out, which drops push subscriptions and releases chores', async () => {
	const { patch, state } = harness({ actorRole: 'admin' });
	const res = await patch({ active: false });
	assert.equal(res.status, 200);
	assert.equal(state.updates[0]?.pushOptIn, false);
	assert.ok(state.updates[0]?.deactivatedAt instanceof Date);
	assert.equal(state.deletes, 1);
	assert.equal(state.releasedChores, 1);
	assert.equal(state.audits[0]?.eventType, 'member.deactivated');
});

test('a member renames themselves', async () => {
	const { patch, state } = harness({ targetId: actorId });
	const res = await patch({ name: 'Lena' });
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { member: { id: actorId, name: 'Lena', active: true } });
	assert.equal(state.audits[0]?.eventType, 'member.renamed');
});

test('a stale expectedName is refused with name_changed', async () => {
	const { patch, state } = harness({ targetId: actorId });
	await assertRefused(
		await patch({ name: 'Lena', expectedName: 'Old' }),
		409,
		'name_changed',
		state,
	);
});

test('a moved-out member cannot return into a full flat', async () => {
	const { patch, state } = harness({
		actorRole: 'admin',
		target: { deactivatedAt: new Date() },
		activeCount: 20,
	});
	await assertRefused(await patch({ active: true }), 409, 'member_limit_reached', state);
});

test('a moved-out member returns while the flat has room', async () => {
	const { patch, state } = harness({
		actorRole: 'admin',
		target: { deactivatedAt: new Date() },
		activeCount: 19,
	});
	const res = await patch({ active: true });
	assert.equal(res.status, 200);
	assert.equal(state.updates[0]?.deactivatedAt, null);
	assert.equal(state.audits[0]?.eventType, 'member.reactivated');
});
