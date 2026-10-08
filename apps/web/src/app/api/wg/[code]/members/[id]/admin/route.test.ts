import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';

interface Target {
	id: string;
	name: string;
	deactivatedAt: Date | null;
	authUserId?: string | null;
}

const state = {
	actorRole: 'admin',
	target: null as Target | null,
	updates: [] as { id: string; role: string }[],
	audits: [] as { eventType: string }[],
};

const wgMembers = {
	id: 'id',
	name: 'name',
	wgId: 'wgId',
	deactivatedAt: 'deactivatedAt',
	role: 'role',
};
const tx = {
	select: () => ({
		from: () => ({
			where: () => ({ for: async () => (state.target ? [state.target] : []) }),
		}),
	}),
	update: () => ({
		set: (values: { role: string }) => ({
			where: async ([, id]: [unknown, string]) => {
				state.updates.push({ id, role: values.role });
			},
		}),
	}),
};

mock.module('@/core/audit', {
	namedExports: { recordAuditEvent: async (e: { eventType: string }) => state.audits.push(e) },
});
mock.module('@/core/db', { namedExports: { wgMembers } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () => ({ id: adminId, role: state.actorRole }),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/require-wg-admin', {
	namedExports: {
		requireWgAdmin: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: adminId, name: 'Ada' },
			authUserId: 'auth-1',
		}),
	},
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		withExpensePaymentLock: async (_id: string, fn: (tx: unknown) => unknown) => fn(tx),
	},
});
mock.module('drizzle-orm', {
	namedExports: { and: (...p: unknown[]) => p, eq: (...p: unknown[]) => p },
});

const { POST } = await import('./route');

function harness({
	actorRole = 'admin',
	target = { id: targetId, name: 'Mira', deactivatedAt: null, authUserId: 'auth-2' },
}: { actorRole?: string; target?: Target | null } = {}) {
	state.actorRole = actorRole;
	state.target = target;
	state.updates = [];
	state.audits = [];
	const post = (id: string, body = '{}') =>
		POST(
			new Request('https://example.invalid/x', { method: 'POST', body }) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT', id }) } as never,
		);
	return { post, state };
}

test('hands the admin role to an active member and audits it', async () => {
	const { post, state } = harness();
	const res = await post(targetId);
	assert.equal(res.status, 200);
	assert.deepEqual(state.updates, [
		{ id: adminId, role: 'member' },
		{ id: targetId, role: 'admin' },
	]);
	assert.equal(state.audits[0]?.eventType, 'member.admin_transferred');
});

test('rejects inactive, unlinked, missing, self and non-admin-actor targets without writes', async () => {
	const cases: [Parameters<typeof harness>[0], string, number][] = [
		[{ target: { id: targetId, name: 'M', deactivatedAt: new Date() } }, targetId, 409],
		[{ target: { id: targetId, name: 'M', deactivatedAt: null, authUserId: null } }, targetId, 409],
		[{ target: null }, targetId, 404],
		[{}, adminId, 400],
		[{ actorRole: 'member' }, targetId, 403],
	];
	for (const [opts, id, status] of cases) {
		const { post, state } = harness(opts);
		assert.equal((await post(id)).status, status);
		assert.equal(state.updates.length, 0);
	}
});

test('oversized body is rejected', async () => {
	const { post } = harness();
	assert.equal((await post(targetId, JSON.stringify({ x: 'a'.repeat(2000) }))).status, 413);
});
