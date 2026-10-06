import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../../tests/support/db-mock';
import { type SqlNode, mockDrizzle } from '../../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	request,
	routeCtx,
} from '../../../../../../../../tests/support/route-harness';

const wgId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';

interface Target {
	id: string;
	name: string;
	deactivatedAt: Date | null;
	authUserId?: string | null;
}

const ACTIVE_TARGET: Target = { id: targetId, name: 'Mira', deactivatedAt: null, authUserId: 'auth-2' };

const state = {
	actorRole: 'admin',
	target: ACTIVE_TARGET as Target | null,
	updates: [] as { id: unknown; role: string }[],
	audits: [] as { eventType: string }[],
};

function given(options: { actorRole?: string; target?: Target | null } = {}): void {
	state.actorRole = options.actorRole ?? 'admin';
	state.target = options.target === undefined ? ACTIVE_TARGET : options.target;
	state.updates = [];
	state.audits = [];
}

const wgMembers = { id: 'id', name: 'name', wgId: 'wgId', deactivatedAt: 'deactivatedAt', role: 'role' };
const tx = {
	select: () => ({
		from: () => ({ where: () => ({ for: async () => (state.target ? [state.target] : []) }) }),
	}),
	update: () => ({
		set: (values: { role: string }) => ({
			where: async (condition: SqlNode) => {
				state.updates.push({ id: condition.args[1], role: values.role });
			},
		}),
	}),
};

mockDrizzle();
mockObservability();
mockDb({ wgMembers });
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: { eventType: string }) => {
			state.audits.push(event);
		},
	},
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () => ({ id: adminId, role: state.actorRole }),
	},
});
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
		withExpensePaymentLock: async (_wgId: string, work: (handle: typeof tx) => unknown) =>
			work(tx),
	},
});

const { POST } = await import('./route');

const post = (id: string, body = '{}') =>
	POST(request('/api/wg/MTE8PZAT/members/x/admin', { method: 'POST', body }), routeCtx({ id }));

test('hands the admin role to an active member and audits it', async () => {
	given();
	const res = await post(targetId);
	assert.equal(res.status, 200);
	assert.deepEqual(state.updates, [
		{ id: adminId, role: 'member' },
		{ id: targetId, role: 'admin' },
	]);
	assert.equal(state.audits[0]?.eventType, 'member.admin_transferred');
});

test('rejects inactive, unlinked, missing, self and non-admin-actor targets without writes', async () => {
	const cases: [Parameters<typeof given>[0], string, number][] = [
		[{ target: { id: targetId, name: 'M', deactivatedAt: new Date() } }, targetId, 409],
		[{ target: { id: targetId, name: 'M', deactivatedAt: null, authUserId: null } }, targetId, 409],
		[{ target: null }, targetId, 404],
		[{}, adminId, 400],
		[{ actorRole: 'member' }, targetId, 403],
	];
	for (const [options, id, status] of cases) {
		given(options);
		assert.equal((await post(id)).status, status);
		assert.equal(state.updates.length, 0);
	}
});

test('oversized body is rejected', async () => {
	given();
	assert.equal((await post(targetId, JSON.stringify({ x: 'a'.repeat(2000) }))).status, 413);
});
