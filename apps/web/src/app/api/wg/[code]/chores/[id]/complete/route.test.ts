import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '@/core/db/transaction-abort';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@/core/offline/replay-retention';

const choreId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberA = '33333333-3333-4333-8333-333333333333';
const memberB = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const originalDueAt = new Date('2026-09-27T10:00:00.000Z');

type Json = Record<string, unknown>;
interface Chore {
	id: string;
	wgId: string;
	intervalDays: number;
	recurrenceType: string;
	title: string;
	assignedMemberId: string | null;
	nextDueAt: Date;
	anchorAt: Date;
}
interface State {
	chore: Chore;
	completions: unknown[];
	claim: Json | null;
	claimExpiresAt: Date | null;
	audits: number;
	failReplayWrite: boolean;
	absenceCheckedAt?: number;
}

const tables = {
	announcements: {
		wgId: 'announcements.wg_id',
		status: 'announcements.status',
		source: 'announcements.source',
		sourcePath: 'announcements.source_path',
	},
	choreCompletions: {
		id: 'chore_completions.id',
		choreId: 'chore_completions.chore_id',
		completedByMemberId: 'chore_completions.completed_by_member_id',
		completedAt: 'chore_completions.completed_at',
	},
	chores: {
		id: 'chores.id',
		wgId: 'chores.wg_id',
		intervalDays: 'chores.interval_days',
		recurrenceType: 'chores.recurrence_type',
		title: 'chores.title',
		assignedMemberId: 'chores.assigned_member_id',
		nextDueAt: 'chores.next_due_at',
		anchorAt: 'chores.anchor_at',
	},
	idempotencyResponses: {
		scope: 'idempotency_responses.scope',
		key: 'idempotency_responses.key',
		responseBody: 'idempotency_responses.response_body',
		expiresAt: 'idempotency_responses.expires_at',
	},
	memberAbsences: {
		wgId: 'member_absences.wg_id',
		memberId: 'member_absences.member_id',
		startDate: 'member_absences.start_date',
		endDate: 'member_absences.end_date',
	},
	wgMembers: {
		id: 'wg_members.id',
		wgId: 'wg_members.wg_id',
		name: 'wg_members.name',
		createdAt: 'wg_members.created_at',
		deactivatedAt: 'wg_members.deactivated_at',
	},
};

function makeState(overrides: Partial<State> = {}): State {
	return {
		chore: {
			id: choreId,
			wgId,
			intervalDays: 7,
			recurrenceType: 'days',
			title: 'Bad putzen',
			assignedMemberId: memberA,
			nextDueAt: new Date(originalDueAt),
			anchorAt: new Date(originalDueAt),
		},
		completions: [],
		claim: null,
		claimExpiresAt: null,
		audits: 0,
		failReplayWrite: false,
		...overrides,
	};
}
let state = makeState();

const rowsFor = (table: unknown, projection: Json | undefined, draft: State = state) => {
	if (table === tables.chores) {
		return projection?.intervalDays
			? [{ ...draft.chore }]
			: [{ assignedMemberId: draft.chore.assignedMemberId, nextDueAt: draft.chore.nextDueAt }];
	}
	if (table === tables.idempotencyResponses) {
		return draft.claim ? [{ body: draft.claim, expiresAt: draft.claimExpiresAt }] : [];
	}
	if (table === tables.wgMembers) {
		return [
			{ id: memberA, name: 'Alex' },
			{ id: memberB, name: 'Bela' },
		];
	}
	return [];
};
const query = (rows: unknown[]) =>
	Object.assign(Promise.resolve(rows), {
		limit: () => {
			const limited = rows.slice(0, 1);
			return Object.assign(limited, { for: async () => limited });
		},
		orderBy: async () => rows,
	});
const makeSelect = (draft?: State) => (projection?: Json) => ({
	from: (table: unknown) => ({
		where: () => query(rowsFor(table, projection, draft ?? state)),
	}),
});
const releaseClaim = (conditions: [unknown, unknown][]) => {
	const lease = conditions.find((part) => part[0] === tables.idempotencyResponses.expiresAt)?.[1];
	if (
		state.claim?._claimed !== true ||
		(lease as Date | undefined)?.getTime() !== state.claimExpiresAt?.getTime()
	) {
		return [];
	}
	state.claim = null;
	state.claimExpiresAt = null;
	return [{ scope: 'released' }];
};
const db = {
	select: (projection?: Json) => makeSelect()(projection),
	delete: (table: unknown) => ({
		where: (conditions: [unknown, unknown][]) => ({
			returning: async () =>
				table === tables.idempotencyResponses ? releaseClaim(conditions) : [],
		}),
	}),
};
const withTransaction = async <R>(operation: (tx: unknown) => Promise<R>): Promise<R> => {
	const draft: State = {
		...state,
		chore: { ...state.chore },
		completions: state.completions.slice(),
		claim: state.claim && { ...state.claim },
	};
	const tx = {
		select: makeSelect(draft),
		update: (table: unknown) => ({
			set: (values: Json) => ({
				where: () => ({
					returning: async () => {
						if (table === tables.chores) {
							draft.chore = { ...draft.chore, ...values } as Chore;
							return [{ ...draft.chore }];
						}
						if (table === tables.idempotencyResponses) {
							if (state.failReplayWrite) return [];
							draft.claim = values.responseBody as Json;
							draft.claimExpiresAt = values.expiresAt as Date;
							return [{ scope: 'claimed' }];
						}
						return [];
					},
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (value: unknown) => ({
				returning: async () => {
					assert.equal(table, tables.choreCompletions);
					draft.completions.push(value);
					return [{ id: `completion-${draft.completions.length}` }];
				},
			}),
		}),
	};
	const result = await operation(tx);
	state.chore = draft.chore;
	state.completions = draft.completions;
	state.claim = draft.claim;
	state.claimExpiresAt = draft.claimExpiresAt;
	return result;
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});
mock.module('@/core/db', { namedExports: { ...tables, db } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort, withTransaction } });
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			if (state.claim && state.claim._claimed !== true) return { won: false, cached: state.claim };
			state.claim = { _claimed: true };
			state.claimExpiresAt = new Date(Date.now() + 15 * 60_000);
			return { won: true };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: memberA, name: 'Alex' },
		}),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => null,
		getCachedResponse: async () =>
			state.claim && state.claim._claimed !== true ? state.claim : null,
		readIdempotencyKey: (request: Request) => request.headers.get('idempotency-key'),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/utils/berlin-day', {
	namedExports: { startOfBerlinDay: (date: Date) => new Date(date) },
});
mock.module('@/features/chores/absence', {
	namedExports: {
		getAbsentMemberIds: (_absences: unknown, at: number) => {
			state.absenceCheckedAt = at;
			return [];
		},
	},
});
mock.module('@/features/chores/chore-fairness', {
	namedExports: {
		computeOpenGapsByMember: () => new Map(),
		chooseNextAvailableMember: ({
			members,
			currentMemberId,
		}: { members: { id: string }[]; currentMemberId: string | null }) =>
			members.find((member) => member.id !== currentMemberId)?.id ?? currentMemberId,
	},
});
mock.module('@/features/chores/chore-recurrence', {
	namedExports: {
		computeNextDueAt: (previousDueAt: Date, intervalDays: number) =>
			new Date(previousDueAt.getTime() + intervalDays * 86_400_000),
		isLateCompletion: (previousDueAt: Date, completedAt: Date) =>
			completedAt.getTime() > previousDueAt.getTime(),
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...values: unknown[]) => values,
		eq: (...values: unknown[]) => values,
		gt: (...values: unknown[]) => values,
		gte: (...values: unknown[]) => values,
		isNull: (value: unknown) => [value, null],
		sql: () => 'sql-updated-at',
	},
});

const { POST } = await import('./route');

/** Makes `s` the state the mocked modules read, and returns the handler with request helpers. */
function makeRoute(s: State) {
	state = s;
	return {
		state,
		post: POST,
		request: (
			body: unknown = {
				expectedNextDueAt: originalDueAt.toISOString(),
				expectedAssignedMemberId: memberA,
			},
		) =>
			new Request(`https://example.invalid/api/wg/MTE8PZAT/chores/${choreId}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
				body: JSON.stringify(body),
			}) as never,
		context: { params: Promise.resolve({ code: 'MTE8PZAT', id: choreId }) } as never,
	};
}

test('chore replay-write failure rolls back completion and lets retry commit exactly once', async () => {
	const state = makeState({ failReplayWrite: true });
	let route = makeRoute(state);
	const failed = await route.post(route.request(), route.context);
	assert.equal(failed.status, 500);
	assert.equal(state.completions.length, 0);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime());
	assert.equal(state.claim, null);

	state.failReplayWrite = false;
	route = makeRoute(state);
	const first = await route.post(route.request(), route.context);
	assert.equal(first.status, 200);
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + 7 * 86_400_000);

	route = makeRoute(state);
	const retry = await route.post(route.request(), route.context);
	assert.equal(retry.status, 200);
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + 7 * 86_400_000);
});

test('stale and legacy chore completion payloads conflict without advancing the next occurrence', async () => {
	const state = makeState({
		chore: {
			id: choreId,
			wgId,
			intervalDays: 7,
			recurrenceType: 'days',
			title: 'Bad putzen',
			assignedMemberId: memberB,
			nextDueAt: new Date(originalDueAt.getTime() + 7 * 86_400_000),
			anchorAt: new Date(originalDueAt),
		},
		completions: [{ choreId, completedByMemberId: memberB }],
	});
	const route = makeRoute(state);
	const stale = await route.post(route.request(), route.context);
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), { error: 'chore_occurrence_changed' });
	const legacy = await route.post(route.request({}), route.context);
	assert.equal(legacy.status, 409);
	assert.deepEqual(await legacy.json(), { error: 'chore_occurrence_changed' });
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + 7 * 86_400_000);
});

test('rotation checks absences on the next due day, not at completion time', async () => {
	const state = makeState();
	const route = makeRoute(state);
	const response = await route.post(route.request(), route.context);
	assert.equal(response.status, 200);
	assert.equal(state.absenceCheckedAt, originalDueAt.getTime() + 7 * 86_400_000);
});

test('completion bumps the chore version so a stale expectedUpdatedAt edit conflicts', async () => {
	const state = makeState();
	const route = makeRoute(state);
	const response = await route.post(route.request(), route.context);
	assert.equal(response.status, 200);
	assert.equal((state.chore as Chore & { updatedAt?: unknown }).updatedAt, 'sql-updated-at');
});

test('a queued completion keeps its tap time, clamped to the replay window', async () => {
	const tapAt = new Date(Date.now() - 60 * 60_000);
	const state = makeState();
	let route = makeRoute(state);
	const body = (completedAt: unknown) => ({
		expectedNextDueAt: originalDueAt.toISOString(),
		expectedAssignedMemberId: memberA,
		completedAt,
	});
	const tapped = await route.post(route.request(body(tapAt.toISOString())), route.context);
	assert.equal(tapped.status, 200);
	const [tappedRow] = state.completions as { completedAt: Date }[];
	assert.equal(tappedRow?.completedAt.getTime(), tapAt.getTime());

	// A device clock in the future never lands after the server's now.
	const future = makeState();
	route = makeRoute(future);
	const before = Date.now();
	await route.post(route.request(body(new Date(before + 86_400_000).toISOString())), route.context);
	const [futureRow] = future.completions as { completedAt: Date }[];
	assert.ok(futureRow && futureRow.completedAt.getTime() <= Date.now());

	// Older than the replay window is pulled up to its edge.
	const ancient = makeState();
	route = makeRoute(ancient);
	await route.post(route.request(body('2001-01-01T00:00:00.000Z')), route.context);
	const [ancientRow] = ancient.completions as { completedAt: Date }[];
	assert.ok(
		ancientRow &&
			ancientRow.completedAt.getTime() >= Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 5_000,
	);

	route = makeRoute(makeState());
	const invalid = await route.post(route.request(body('not-a-date')), route.context);
	assert.equal(invalid.status, 400);
});
