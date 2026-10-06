import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../tests/support/db-mock';
import { mockDrizzle, rowMatches } from '../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

// The route and the template writes run for real, so the edit is exercised with its actual
// validation; only the database, the guards and the audit log are stand-ins.

const templateId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const creatorId = '33333333-3333-4333-8333-333333333333';
const otherMemberId = '44444444-4444-4444-8444-444444444444';
const currentDueAt = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-09-25T12:00:00.000Z');

const recurringExpenses = { id: 'id', wgId: 'wgId', nextDueAt: 'nextDueAt', pausedAt: 'pausedAt' };
const wgMembers = { id: 'wgMembers.id' };

type Template = Record<string, unknown> & { nextDueAt: Date; anchorAt: Date; description: string };

function freshTemplate(): Template {
	return {
		id: templateId,
		wgId,
		createdByMemberId: creatorId,
		paidByMemberId: creatorId,
		description: 'Miete',
		amountCents: 500,
		currency: 'EUR',
		intervalMonths: 1,
		nextDueAt: currentDueAt,
		anchorAt: currentDueAt,
		lastCreatedAt: null,
		pausedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		splitsJson: JSON.stringify([{ debtorMemberId: creatorId, amountCents: 500 }]),
	};
}

const state = {
	template: freshTemplate(),
	updates: [] as Record<string, unknown>[],
};

mockDrizzle();
mockObservability();
mockRateLimit();
const member = mockWgMember({ wg: { id: wgId }, member: { memberId: otherMemberId, name: 'Kim' } });
mockDb({
	recurringExpenses,
	wgMembers,
	db: {
		select() {
			let table: unknown;
			const query = {
				from(selected: unknown) {
					table = selected;
					return query;
				},
				where(condition: unknown) {
					const rows =
						table === wgMembers
							? [{ id: creatorId }]
							: rowMatches(state.template, condition)
								? [{ ...state.template }]
								: [];
					return Object.assign(Promise.resolve(rows), { limit: async () => rows });
				},
			};
			return query;
		},
		update() {
			let values: Record<string, unknown> = {};
			const update = {
				set(next: Record<string, unknown>) {
					values = next;
					return update;
				},
				where(condition: unknown) {
					return {
						returning: async () => {
							if (!rowMatches(state.template, condition)) return [];
							state.updates.push(values);
							state.template = { ...state.template, ...values };
							return [{ ...state.template }];
						},
					};
				},
			};
			return update;
		},
	},
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/guards/admin', {
	namedExports: {
		isWgAdmin: async () => false,
		requireOwnerOrAdmin: async (_wgId: string, caller: { memberId: string }, ownerId: string) =>
			caller.memberId === ownerId
				? null
				: Response.json({ error: 'forbidden' }, { status: 403 }),
	},
});

const { PATCH } = await import('./route');

function given(callerId: string): void {
	state.template = freshTemplate();
	state.updates = [];
	member.member = { memberId: callerId, name: 'Kim' };
}

const patch = (body: Record<string, unknown>) =>
	PATCH(
		request('/api/wg/MTE8PZAT/recurring-expenses', {
			method: 'PATCH',
			body: { id: templateId, ...body },
		}),
		routeCtx(),
	);

test('PATCH rejects moving nextDueAt out of the catch-up range', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given(creatorId);
	for (const nextDueAt of ['2000-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z']) {
		const response = await patch({ description: 'Miete', nextDueAt });
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: 'due_date_invalid' });
	}
	assert.deepEqual(state.updates, []);

	const moved = await patch({ nextDueAt: '2026-11-01T00:00:00.000Z' });
	assert.equal(moved.status, 200);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('any member may advance a template after booking it, but only the owner may edit it', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given(otherMemberId);

	const edit = await patch({ description: 'Strom' });
	assert.equal(edit.status, 403);
	assert.equal(state.template.description, 'Miete');

	const advanced = await patch({ expectedNextDueAt: currentDueAt.toISOString() });
	assert.equal(advanced.status, 200);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');

	// The expectedNextDueAt check still rejects a stale or replayed advance.
	const replay = await patch({ expectedNextDueAt: currentDueAt.toISOString() });
	assert.equal(replay.status, 409);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('PATCH resending the unchanged due date keeps the cadence anchor', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given(creatorId);
	// A "31st" template whose due date was clamped to the 28th after February.
	const anchorAt = new Date('2026-01-31T11:00:00.000Z');
	const clampedDueAt = new Date('2026-10-28T11:00:00.000Z');
	state.template.anchorAt = anchorAt;
	state.template.nextDueAt = clampedDueAt;

	const edit = await patch({ description: 'Miete neu', nextDueAt: '2026-10-28T10:00:00.000Z' });
	assert.equal(edit.status, 200);
	assert.equal(state.template.anchorAt.toISOString(), anchorAt.toISOString());
	assert.equal(state.template.nextDueAt.toISOString(), clampedDueAt.toISOString());

	const moved = await patch({ nextDueAt: '2026-11-15T11:00:00.000Z' });
	assert.equal(moved.status, 200);
	assert.equal(state.template.anchorAt.toISOString(), '2026-11-15T11:00:00.000Z');
});

test('PATCH from an editor that loaded an older due date is refused, not written back', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given(creatorId);
	const loadedDueAt = state.template.nextDueAt.toISOString();
	// A booking (cron or "Erfassen") moved the template on after the form was opened.
	state.template.nextDueAt = new Date('2026-11-01T11:00:00.000Z');

	const stale = await patch({
		description: 'Miete neu',
		nextDueAt: loadedDueAt,
		expectedNextDueAt: loadedDueAt,
	});
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), {
		error: 'recurring_expense_changed',
		code: 'recurring_expense_changed',
	});
	assert.equal(state.updates.length, 0);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T11:00:00.000Z');

	const fresh = await patch({
		description: 'Miete neu',
		expectedNextDueAt: '2026-11-01T11:00:00.000Z',
	});
	assert.equal(fresh.status, 200);
	assert.equal(state.template.description, 'Miete neu');
});
