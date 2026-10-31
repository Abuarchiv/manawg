import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const otherMemberId = '3c0f2c8e-6b1d-4c53-9d0e-0a6f1f2b7a11';
const key = 'a597a363-9e4c-4df3-9946-a76375583cd4';
const nextId = '910a55a3-1a79-450d-9922-38a0de395daa';
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Row = Record<string, any>;

const tables = {
	chores: { name: 'chores' },
	choreCompletions: { name: 'choreCompletions' },
	memberAbsences: { name: 'memberAbsences' },
	idempotencyResponses: {
		name: 'idempotencyResponses',
		scope: 'scope',
		key: 'key',
		responseBody: 'responseBody',
		expiresAt: 'expiresAt',
	},
	wgMembers: {
		id: 'wgMembers.id',
		wgId: 'wgMembers.wgId',
		deactivatedAt: 'wgMembers.deactivatedAt',
	},
};

interface HarnessState {
	claim: Row | null;
	claimExpiresAt: Date | null;
	rows: Row[];
	audits: number;
	notifications: number;
	missReplayWrite: boolean;
	forceWon: boolean;
	rolloverOnRollback: boolean;
}

// The mocks below read the state of the harness currently in use.
let state: HarnessState;

const withTransaction = async (operation: (tx: unknown) => Promise<unknown>) => {
	let draftRow: Row | undefined;
	let draftClaim = state.claim;
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						const rows: Row[] & { for?: () => Promise<Row[]> } =
							table === tables.idempotencyResponses
								? [{ body: draftClaim, expiresAt: state.claimExpiresAt }]
								: [];
						rows.for = async () => rows;
						return rows;
					},
				}),
			}),
		}),
		insert: () => ({
			values: (value: Row) => ({
				returning: async () => {
					draftRow = { id: nextId, ...value, createdAt: new Date(), updatedAt: new Date() };
					return [draftRow];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (value: Row) => ({
				where: () => ({
					returning: async () => {
						assert.equal(table, tables.idempotencyResponses);
						if (state.missReplayWrite) return [];
						draftClaim = value.responseBody;
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
		execute: async () => undefined,
	};
	let result: unknown;
	try {
		result = await operation(tx);
	} catch (err) {
		if (state.rolloverOnRollback && state.claimExpiresAt) {
			state.claimExpiresAt = new Date(state.claimExpiresAt.getTime() + 60_000);
		}
		throw err;
	}
	if (draftRow) state.rows.push(draftRow);
	state.claim = draftClaim;
	return result;
};

const jsonError = (code: string, status: number) => Response.json({ error: code }, { status });

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		...tables,
		CHORE_RECURRENCE_TYPES: ['days', 'months'],
		db: {
			select: () => ({
				from: () => ({ where: () => ({ limit: async () => [{ id: memberId }] }) }),
			}),
			delete: (table: unknown) => ({
				where: (conditions: unknown[]) => ({
					returning: async () => {
						assert.equal(table, tables.idempotencyResponses);
						assert.deepEqual(state.claim, { _claimed: true });
						const expiry = conditions.find(
							(part) => Array.isArray(part) && part[0] === tables.idempotencyResponses.expiresAt,
						) as unknown[] | undefined;
						const lease = expiry?.[1];
						assert.ok(lease instanceof Date);
						if (lease.getTime() !== state.claimExpiresAt?.getTime()) return [];
						state.claim = null;
						return [{ scope: 'released' }];
					},
				}),
			}),
		},
	},
});
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort, withTransaction } });
mock.module('@/core/http/api-errors', {
	namedExports: {
		badRequest: (code: string) => jsonError(code, 400),
		conflict: (code: string) => jsonError(code, 409),
		forbidden: (code: string) => jsonError(code, 403),
		payloadTooLarge: () => jsonError('payload_too_large', 413),
		serverError: (code: string) => jsonError(code, 500),
		tooMany: () => jsonError('too_many', 429),
		rateLimitResponse: (result: { success: boolean }) =>
			result.success ? null : jsonError('too_many', 429),
	},
});
mock.module('@/core/guards/admin', {
	namedExports: {
		requireOwnerOrAdmin: async (_wgId: string, member: { memberId: string }, ownerId: string) =>
			ownerId === member.memberId ? null : jsonError('not_owner', 403),
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			if (state.forceWon) return { won: true };
			if (state.claim === null) {
				state.claim = { _claimed: true };
				state.claimExpiresAt = new Date(Date.now() + 60_000);
				return { won: true };
			}
			if ('_claimed' in state.claim) throw new Error('claim_still_held');
			return { won: false, cached: state.claim };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, shareCode: 'MTE8PZAT' },
			member: { memberId, name: 'Mina' },
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_label: string, handler: (req: Request, params: unknown) => Promise<Response>) =>
			async (req: Request, params: unknown) => {
				try {
					return await handler(req, params);
				} catch {
					return jsonError('server_error', 500);
				}
			},
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => true,
		getCachedResponse: async () => null,
		readIdempotencyKey: () => key,
		setReplayWarning: () => undefined,
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			state.notifications += 1;
			return { warning: null };
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/utils/berlin-day', {
	namedExports: {
		berlinDayKey: (date: Date) => date.toISOString().slice(0, 10),
		startOfBerlinDay: (date: Date) => date,
		endOfBerlinDay: (date: Date) => date,
	},
});
mock.module('@/features/chores/chore-fairness', {
	namedExports: { computeOpenGapsByMember: () => new Map() },
});
mock.module('@/features/chores/chore-recurrence', {
	namedExports: { computeNextDueAt: () => new Date() },
});
const parts = (...args: unknown[]) => args;
mock.module('drizzle-orm', {
	namedExports: {
		and: parts,
		asc: (value: unknown) => value,
		desc: (value: unknown) => value,
		eq: parts,
		gt: parts,
		gte: parts,
		inArray: parts,
		isNull: (value: unknown) => value,
		lte: parts,
		sql: () => null,
	},
});

const routes = {
	chore: await import('../src/app/api/wg/[code]/chores/route.ts'),
	absence: await import('../src/app/api/wg/[code]/absences/route.ts'),
};

function harness(kind: 'chore' | 'absence', bodyOverride?: Row) {
	const own: HarnessState = {
		claim: null,
		claimExpiresAt: null,
		rows: [],
		audits: 0,
		notifications: 0,
		missReplayWrite: false,
		forceWon: false,
		rolloverOnRollback: false,
	};
	state = own;
	const body =
		kind === 'chore'
			? {
					title: 'Bad putzen',
					intervalDays: 7,
					recurrenceType: 'days',
					assignedMemberId: otherMemberId,
					nextDueAt: new Date(Date.now() + 1_000).toISOString(),
				}
			: { memberId, startDate: '2026-09-24T00:00:00+02:00', endDate: '2026-09-24T23:59:59+02:00' };
	const request = () =>
		new Request('http://localhost/api/wg/MTE8PZAT/entries', {
			method: 'POST',
			headers: { 'idempotency-key': key, 'content-type': 'application/json' },
			body: JSON.stringify(bodyOverride ?? body),
		});
	const post = (req: Request, ctx: unknown) => {
		state = own;
		return routes[kind].POST(req as never, ctx as never);
	};
	return { post, request, state: own };
}

for (const kind of ['chore', 'absence'] as const) {
	test(`${kind} create rolls back on replay write miss, then replays one committed response`, async () => {
		const { post, request, state } = harness(kind);
		state.missReplayWrite = true;
		const failed = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(failed.status, 500);
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
		assert.equal(state.notifications, 0);
		assert.equal(state.claim, null);

		state.missReplayWrite = false;
		const first = await post(request(), { code: 'MTE8PZAT' });
		const replay = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(first.status, 200);
		assert.equal(replay.status, 200);
		const firstBody = await first.json();
		assert.deepEqual(await replay.json(), firstBody);
		state.forceWon = true;
		const lockedReplay = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(lockedReplay.status, 200);
		assert.deepEqual(await lockedReplay.json(), firstBody);
		assert.equal(state.rows.length, 1);
		assert.equal(state.audits, 1);
		assert.equal(state.notifications, kind === 'chore' ? 1 : 0);
	});

	test(`${kind} create rejects a claim with extra fields before inserting`, async () => {
		const { post, request, state } = harness(kind);
		state.claim = { _claimed: true, extra: true };
		state.claimExpiresAt = new Date(Date.now() + 60_000);
		state.forceWon = true;
		const response = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(response.status, 500);
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
	});

	test(`${kind} rollback release preserves a replacement claim with a new lease`, async () => {
		const { post, request, state } = harness(kind);
		state.missReplayWrite = true;
		state.rolloverOnRollback = true;
		const response = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(response.status, 500);
		assert.deepEqual(state.claim, { _claimed: true });
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
	});
}

test('chore create assigned to the creator sends no push', async () => {
	const { post, request, state } = harness('chore', {
		title: 'Bad putzen',
		assignedMemberId: memberId,
		nextDueAt: new Date(Date.now() + 1_000).toISOString(),
	});
	const response = await post(request(), { code: 'MTE8PZAT' });
	assert.equal(response.status, 200);
	assert.equal(state.rows.length, 1);
	assert.equal(state.notifications, 0);
});

test('absence create rejects an end before the start on the same Berlin day', async () => {
	const { post, request, state } = harness('absence', {
		memberId,
		startDate: '2026-09-24T18:00:00+02:00',
		endDate: '2026-09-24T09:00:00+02:00',
	});
	const response = await post(request(), { code: 'MTE8PZAT' });
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'date_range_invalid' });
	assert.equal(state.rows.length, 0);
	assert.equal(state.audits, 0);
});

for (const [startDate, endDate] of [
	['0050-01-01T00:00:00Z', '0050-01-02T00:00:00Z'],
	['2026-09-24T00:00:00Z', '9999-12-31T23:30:00Z'],
]) {
	test(`absence create rejects dates outside the supported years (${startDate})`, async () => {
		const { post, request, state } = harness('absence', { memberId, startDate, endDate });
		const response = await post(request(), { code: 'MTE8PZAT' });
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: 'date_range_invalid' });
		assert.equal(state.rows.length, 0);
	});
}

test('absence create for another member is refused before inserting', async () => {
	const { post, request, state } = harness('absence', {
		memberId: otherMemberId,
		startDate: '2026-09-24T00:00:00+02:00',
		endDate: '2026-09-24T23:59:59+02:00',
	});
	const response = await post(request(), { code: 'MTE8PZAT' });
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_owner' });
	assert.equal(state.rows.length, 0);
	assert.equal(state.audits, 0);
});
