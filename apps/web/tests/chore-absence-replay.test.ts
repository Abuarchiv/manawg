import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import { mockDb } from './support/db-mock';
import { conditionArg, mockDrizzle } from './support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from './support/route-harness';

// The chore and absence create routes with the real claim protocol and their real date and
// recurrence helpers; one claim slot and the created rows live in memory.

const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const key = 'a597a363-9e4c-4df3-9946-a76375583cd4';
const nextId = '910a55a3-1a79-450d-9922-38a0de395daa';

const idempotencyResponses = {
	name: 'idempotencyResponses',
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
};
const wgMembers = {
	id: 'wgMembers.id',
	wgId: 'wgMembers.wgId',
	deactivatedAt: 'wgMembers.deactivatedAt',
};

type Claim = Record<string, unknown> & { _claimed?: boolean };

function createState() {
	return {
		claim: null as Claim | null,
		claimExpiresAt: null as Date | null,
		rows: [] as Record<string, unknown>[],
		audits: 0,
		notifications: 0,
		missReplayWrite: false,
		forceWon: false,
		rolloverOnRollback: false,
	};
}

let state = createState();

async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	let draftRow: Record<string, unknown> | undefined;
	let draftClaim = state.claim;
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						const rows =
							table === idempotencyResponses
								? [{ body: draftClaim, expiresAt: state.claimExpiresAt }]
								: [];
						return Object.assign(rows, { for: async () => rows });
					},
				}),
			}),
		}),
		insert: () => ({
			values: (value: Record<string, unknown>) => ({
				returning: async () => {
					draftRow = { id: nextId, ...value, createdAt: new Date(), updatedAt: new Date() };
					return [draftRow];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (value: { responseBody: Claim }) => ({
				where: () => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						if (state.missReplayWrite) return [];
						draftClaim = value.responseBody;
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
		execute: async () => undefined,
	};
	let result: T;
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
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId, shareCode: 'MTE8PZAT' }, member: { memberId, name: 'Mina' } });
mockDb({
	chores: { name: 'chores' },
	memberAbsences: { name: 'memberAbsences' },
	idempotencyResponses,
	wgMembers,
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => [{ id: memberId }] }) }),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => ({
				returning: async () => {
					assert.equal(table, idempotencyResponses);
					assert.deepEqual(state.claim, { _claimed: true });
					const expiry = conditionArg(condition, 'eq', idempotencyResponses.expiresAt);
					assert.ok(expiry instanceof Date);
					if (expiry.getTime() !== state.claimExpiresAt?.getTime()) return [];
					state.claim = null;
					return [{ scope: 'released' }];
				},
			}),
		}),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort, withTransaction, lockExpensePayments: async () => undefined },
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});
mock.module('@/core/guards/admin', {
	namedExports: {
		isWgAdmin: async () => false,
		requireOwnerOrAdmin: async (_wgId: string, caller: { memberId: string }, ownerId: string) =>
			ownerId === caller.memberId ? null : Response.json({ error: 'not_owner' }, { status: 403 }),
	},
});
// A live placeholder is still held; a completed claim is replayed.
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
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey: () => key,
		claimResponseSlot: async () => assert.fail('claims go through the replay slot'),
		getCachedResponse: async () => null,
		setReplayWarning: async () => false,
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			state.notifications += 1;
			return { warning: null };
		},
	},
});

const routes = {
	chore: await import('../src/app/api/wg/[code]/chores/route.ts'),
	absence: await import('../src/app/api/wg/[code]/absences/route.ts'),
};
type Kind = keyof typeof routes;

function harness(kind: Kind, bodyOverride?: Record<string, unknown>) {
	state = createState();
	const body =
		kind === 'chore'
			? {
					title: 'Bad putzen',
					intervalDays: 7,
					recurrenceType: 'days',
					assignedMemberId: memberId,
					nextDueAt: new Date(Date.now() + 1_000).toISOString(),
				}
			: { memberId, startDate: '2026-09-24T00:00:00+02:00', endDate: '2026-09-24T23:59:59+02:00' };
	const path = kind === 'chore' ? 'chores' : 'absences';
	const post = () =>
		routes[kind].POST(
			request(`/api/wg/MTE8PZAT/${path}`, {
				method: 'POST',
				headers: { 'idempotency-key': key },
				body: bodyOverride ?? body,
			}),
			routeCtx(),
		);
	return { post, state };
}

for (const kind of ['chore', 'absence'] as const) {
	test(`${kind} create rolls back on replay write miss, then replays one committed response`, async () => {
		const { post } = harness(kind);
		state.missReplayWrite = true;
		const failed = await post();
		assert.equal(failed.status, 500);
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
		assert.equal(state.notifications, 0);
		assert.equal(state.claim, null);

		state.missReplayWrite = false;
		const first = await post();
		const replay = await post();
		assert.equal(first.status, 200);
		assert.equal(replay.status, 200);
		const firstBody = await first.json();
		assert.deepEqual(await replay.json(), firstBody);
		state.forceWon = true;
		const lockedReplay = await post();
		assert.equal(lockedReplay.status, 200);
		assert.deepEqual(await lockedReplay.json(), firstBody);
		assert.equal(state.rows.length, 1);
		assert.equal(state.audits, 1);
		assert.equal(state.notifications, kind === 'chore' ? 1 : 0);
	});

	test(`${kind} create rejects a claim with extra fields before inserting`, async () => {
		const { post } = harness(kind);
		state.claim = { _claimed: true, extra: true };
		state.claimExpiresAt = new Date(Date.now() + 60_000);
		state.forceWon = true;
		const response = await post();
		assert.equal(response.status, 500);
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
	});

	test(`${kind} rollback release preserves a replacement claim with a new lease`, async () => {
		const { post } = harness(kind);
		state.missReplayWrite = true;
		state.rolloverOnRollback = true;
		const response = await post();
		assert.equal(response.status, 500);
		assert.deepEqual(state.claim, { _claimed: true });
		assert.equal(state.rows.length, 0);
		assert.equal(state.audits, 0);
	});
}

test('absence create rejects an end before the start on the same Berlin day', async () => {
	const { post } = harness('absence', {
		memberId,
		startDate: '2026-09-24T18:00:00+02:00',
		endDate: '2026-09-24T09:00:00+02:00',
	});
	const response = await post();
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'date_range_invalid' });
	assert.equal(state.rows.length, 0);
	assert.equal(state.audits, 0);
});
