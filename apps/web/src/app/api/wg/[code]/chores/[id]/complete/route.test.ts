import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	type ClaimRow,
	ClaimTable,
	idempotencyResponses,
	mockIdempotencyStore,
} from '../../../../../../../../tests/support/claim-table';
import { mockDb } from '../../../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../../tests/support/route-harness';

// The route, the claim protocol, the recurrence and the rotation run for real against an
// in-memory chore, its completions and the claim table.

const choreId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberA = '33333333-3333-4333-8333-333333333333';
const memberB = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const originalDueAt = new Date('2026-09-27T10:00:00.000Z');
const WEEK_MS = 7 * 86_400_000;
// One day before the due date: an early completion keeps the weekly cadence.
const NOW = new Date('2026-09-26T12:00:00.000Z');

const announcements = { wgId: 'announcements.wg_id', status: 'announcements.status' };
const choreCompletions = { id: 'chore_completions.id', choreId: 'chore_completions.chore_id' };
const chores = { id: 'chores.id', wgId: 'chores.wg_id', intervalDays: 'chores.interval_days' };
const memberAbsences = { wgId: 'member_absences.wg_id', endDate: 'member_absences.end_date' };
const wgMembers = { id: 'wg_members.id', wgId: 'wg_members.wg_id' };

interface Chore {
	id: string;
	wgId: string;
	intervalDays: number;
	recurrenceType: string;
	title: string;
	assignedMemberId: string;
	nextDueAt: Date;
	anchorAt: Date;
}
interface Absence {
	memberId: string;
	startDate: Date;
	endDate: Date;
}

function initialChore(): Chore {
	return {
		id: choreId,
		wgId,
		intervalDays: 7,
		recurrenceType: 'days',
		title: 'Bad putzen',
		assignedMemberId: memberA,
		nextDueAt: new Date(originalDueAt),
		anchorAt: new Date(originalDueAt),
	};
}

const table = new ClaimTable();
const state = {
	chore: initialChore(),
	completions: [] as unknown[],
	absences: [] as Absence[],
	audits: 0,
	failReplayWrite: false,
};

function given(overrides: Partial<Omit<typeof state, 'audits'>> = {}): void {
	state.chore = overrides.chore ?? initialChore();
	state.completions = overrides.completions ?? [];
	state.absences = overrides.absences ?? [];
	state.failReplayWrite = overrides.failReplayWrite ?? false;
	state.audits = 0;
	table.rows = [];
}

function rowsFor(selected: unknown, projection: Record<string, unknown>, chore: Chore) {
	if (selected === chores) {
		return 'intervalDays' in projection
			? [{ ...chore }]
			: [{ assignedMemberId: chore.assignedMemberId, nextDueAt: chore.nextDueAt }];
	}
	if (selected === wgMembers) {
		return [
			{ id: memberA, name: 'Alex' },
			{ id: memberB, name: 'Bela' },
		];
	}
	if (selected === memberAbsences) return state.absences;
	return [];
}

function query(rows: Record<string, unknown>[]) {
	return Object.assign(Promise.resolve(rows), {
		limit: async () => rows.slice(0, 1),
		orderBy: async () => rows,
	});
}

/** A transaction works on a draft of the chore, its completions and the claim table. */
async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const draft = { chore: { ...state.chore }, completions: [...state.completions] };
	const claims: ClaimRow[] = table.snapshot();
	const tx = {
		select: (projection: Record<string, unknown>) => ({
			from: (selected: unknown) =>
				selected === idempotencyResponses
					? table.select(projection).from()
					: { where: () => query(rowsFor(selected, projection, draft.chore)) },
		}),
		update: (selected: unknown) => {
			if (selected === idempotencyResponses) {
				return state.failReplayWrite
					? { set: () => ({ where: () => ({ returning: async () => [] }) }) }
					: table.update();
			}
			return {
				set: (values: Partial<Chore>) => ({
					where: () => ({
						returning: async () => {
							if (selected !== chores) return [];
							draft.chore = { ...draft.chore, ...values };
							return [{ ...draft.chore }];
						},
					}),
				}),
			};
		},
		delete: () => table.delete(),
		insert: (selected: unknown) => ({
			values: (value: unknown) => ({
				returning: async () => {
					assert.equal(selected, choreCompletions);
					draft.completions.push(value);
					return [{ id: `completion-${draft.completions.length}` }];
				},
			}),
		}),
	};
	try {
		const result = await operation(tx);
		state.chore = draft.chore;
		state.completions = draft.completions;
		return result;
	} catch (err) {
		table.restore(claims);
		throw err;
	}
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId: memberA, name: 'Alex' } });
mockIdempotencyStore(table);
mockDb({
	announcements,
	choreCompletions,
	chores,
	idempotencyResponses,
	memberAbsences,
	wgMembers,
	withTransaction,
	db: {
		select: (projection: Record<string, unknown>) => ({
			from: (selected: unknown) => ({
				where: () => query(rowsFor(selected, projection, state.chore)),
			}),
		}),
		delete: () => table.delete(),
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});

const { POST } = await import('./route');

const post = (
	body: Record<string, unknown> = {
		expectedNextDueAt: originalDueAt.toISOString(),
		expectedAssignedMemberId: memberA,
	},
) =>
	POST(
		request(`/api/wg/MTE8PZAT/chores/${choreId}/complete`, {
			method: 'POST',
			headers: { 'idempotency-key': idempotencyKey },
			body,
		}),
		routeCtx({ id: choreId }),
	);

test('chore replay-write failure rolls back completion and lets retry commit exactly once', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given({ failReplayWrite: true });
	const failed = await post();
	assert.equal(failed.status, 500);
	assert.deepEqual(await failed.json(), { error: 'idempotency_response_write_failed' });
	assert.equal(state.completions.length, 0);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime());
	assert.equal(table.slot, undefined);

	state.failReplayWrite = false;
	const first = await post();
	assert.equal(first.status, 200);
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + WEEK_MS);

	const retry = await post();
	assert.equal(retry.status, 200);
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + WEEK_MS);
});

test('stale and legacy chore completion payloads conflict without advancing the next occurrence', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given({
		chore: {
			...initialChore(),
			assignedMemberId: memberB,
			nextDueAt: new Date(originalDueAt.getTime() + WEEK_MS),
		},
		completions: [{ choreId, completedByMemberId: memberB }],
	});
	const stale = await post();
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), { error: 'chore_occurrence_changed' });
	const legacy = await post({});
	assert.equal(legacy.status, 409);
	assert.deepEqual(await legacy.json(), { error: 'chore_occurrence_changed' });
	assert.equal(state.completions.length, 1);
	assert.equal(state.chore.nextDueAt.getTime(), originalDueAt.getTime() + WEEK_MS);
});

test('rotation checks absences on the next due day, not at completion time', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const nextDueAt = new Date(originalDueAt.getTime() + WEEK_MS);

	// Away on the next due day: the rotation skips Bela.
	given({ absences: [{ memberId: memberB, startDate: nextDueAt, endDate: nextDueAt }] });
	assert.equal((await post()).status, 200);
	assert.equal(state.chore.nextDueAt.getTime(), nextDueAt.getTime());
	assert.equal(state.chore.assignedMemberId, memberA);

	// Away only on the completion day: Bela takes the next occurrence.
	given({ absences: [{ memberId: memberB, startDate: NOW, endDate: NOW }] });
	assert.equal((await post()).status, 200);
	assert.equal(state.chore.assignedMemberId, memberB);
});
