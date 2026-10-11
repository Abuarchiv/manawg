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
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: adminId, name: 'Ada' },
			authUserId: 'auth-1',
		}),
	},
});
// Minimal stand-in for the replay protocol: a stored 2xx response of the same scope and key is
// replayed before the write runs; other outcomes are not stored.
const replayStore = new Map<string, { status: number; body: unknown }>();
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		rejectWrite: (response: { status: number }) => ({
			status: response.status,
			body: null,
			context: { rejected: response },
		}),
		withIdempotentWrite: async (
			options: {
				scope: string;
				key: string | null;
				inTransaction: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
				prepare: () => Promise<{ stop: unknown } | { input: unknown }>;
			},
			write: (tx: unknown) => Promise<{ status: number; body: unknown; context?: unknown }>,
		) => {
			const id = `${options.scope}:${options.key}`;
			const stored = options.key ? replayStore.get(id) : undefined;
			if (stored) return { kind: 'replayed', ...stored };
			const prepared = await options.prepare();
			if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
			const outcome = (await options.inTransaction(write)) as {
				status: number;
				body: unknown;
				context?: unknown;
			};
			if (options.key && outcome.status < 300) {
				replayStore.set(id, { status: outcome.status, body: outcome.body });
			}
			return { kind: 'written', ...outcome };
		},
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key') },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/features/expenses/server/expense-payments', {
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
	replayStore.clear();
	const post = (id: string, body = '{}', headers: Record<string, string> = {}) =>
		POST(
			new Request('https://example.invalid/x', { method: 'POST', body, headers }) as never,
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

test('a retry with the same key replays the applied transfer instead of answering 403', async () => {
	const { post, state } = harness();
	const headers = { 'idempotency-key': '55555555-5555-4555-8555-555555555555' };
	const first = await post(targetId, '{}', headers);
	assert.equal(first.status, 200);
	// The caller has already been demoted when the retry arrives.
	state.actorRole = 'member';
	state.updates = [];
	state.audits = [];
	const retry = await post(targetId, '{}', headers);
	assert.equal(retry.status, 200);
	assert.deepEqual(await retry.json(), await first.json());
	assert.equal(state.updates.length, 0);
	assert.equal(state.audits.length, 0);
	// Without a key the same request is still refused.
	assert.equal((await post(targetId)).status, 403);
});

test('oversized body is rejected', async () => {
	const { post } = harness();
	assert.equal((await post(targetId, JSON.stringify({ x: 'a'.repeat(2000) }))).status, 413);
});
