import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';

// Both recurring PATCH routes (collection and item) share editRecurringTemplate. The edit form
// resends the unchanged due date on every save; only a due date on another calendar day may
// re-anchor the cadence, or a clamped 28.02. would replace the 31st as the anchor day.

const schema = await import('../src/core/db/schema.ts');
const dialect = new PgDialect();

const MEMBER = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 86_400_000;
const dueAt = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + 10 * DAY_MS);
const anchorAt = new Date(dueAt.getTime() - 40 * DAY_MS);

function template(overrides: Record<string, unknown> = {}) {
	return {
		id: 'template-1',
		wgId: 'wg-1',
		createdByMemberId: MEMBER,
		paidByMemberId: MEMBER,
		description: 'Internet',
		amountCents: 1000,
		intervalMonths: 1,
		nextDueAt: dueAt,
		anchorAt,
		pausedAt: null,
		lastCreatedAt: null,
		createdAt: anchorAt,
		splitsJson: JSON.stringify([{ debtorMemberId: MEMBER, amountCents: 1000 }]),
		...overrides,
	};
}

const state = {
	sets: [] as Array<Record<string, unknown>>,
	memberWhere: [] as string[],
	updateWhere: [] as string[],
	currentTemplate: null as Record<string, unknown> | null,
};

mock.module('@/core/db', {
	namedExports: {
		...schema,
		db: {
			select: () => ({
				from: (table: unknown) =>
					table === schema.wgMembers
						? {
								where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
									state.memberWhere.push(dialect.sqlToQuery(condition).sql);
									return [{ id: MEMBER }];
								},
							}
						: {
								where: () => ({
									limit: async () => (state.currentTemplate ? [{ ...state.currentTemplate }] : []),
								}),
							},
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => ({
						returning: async () => {
							const query = dialect.sqlToQuery(condition);
							state.updateWhere.push(query.sql);
							if (!state.currentTemplate) {
								state.sets.push(values);
								return [
									{
										...template(),
										...values,
										updatedAt: values.updatedAt instanceof Date ? values.updatedAt : new Date(),
									},
								];
							}
							const dateParams = query.params.filter(
								(param): param is Date => param instanceof Date,
							);
							const expectedVersion = dateParams.at(-1);
							if (
								expectedVersion &&
								expectedVersion.getTime() !== (state.currentTemplate.updatedAt as Date).getTime()
							) {
								return [];
							}
							const previousUpdatedAt = state.currentTemplate.updatedAt as Date;
							const nextUpdatedAt =
								values.updatedAt instanceof Date
									? values.updatedAt
									: new Date(Math.max(Date.now(), previousUpdatedAt.getTime() + 1));
							const updated = { ...state.currentTemplate, ...values, updatedAt: nextUpdatedAt };
							state.currentTemplate = updated;
							state.sets.push(values);
							return [updated];
						},
					}),
				}),
			}),
		},
	},
});
const audits: Array<{ eventType: string; memberId: string | null }> = [];
mock.module('@/core/audit', {
	namedExports: { recordAuditEvent: async (e: (typeof audits)[number]) => void audits.push(e) },
});
mock.module('@/core/guards/admin', { namedExports: { requireOwnerOrAdmin: async () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const { editRecurringTemplate } = await import(
	'../src/features/expenses/server/recurring-template-writes.ts'
);
const caller = { wgId: 'wg-1', member: { memberId: MEMBER, name: 'Mina' } };

test('a resent due date on the same day keeps the anchor and the due date', async () => {
	state.sets = [];
	const sameDayOtherTime = new Date(dueAt.getTime() + 12 * 3_600_000).toISOString();
	const response = await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		description: 'Glasfaser',
		nextDueAt: sameDayOtherTime,
	});
	assert.equal(response.status, 200);
	assert.equal(state.sets.length, 1);
	const [set] = state.sets;
	assert.ok(set);
	assert.equal((set.anchorAt as Date).getTime(), anchorAt.getTime());
	assert.equal((set.nextDueAt as Date).getTime(), dueAt.getTime());
});

test('a due date moved to another day re-anchors the cadence', async () => {
	state.sets = [];
	const moved = new Date(dueAt.getTime() + 2 * DAY_MS);
	const response = await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		nextDueAt: moved.toISOString(),
	});
	assert.equal(response.status, 200);
	const [set] = state.sets;
	assert.ok(set);
	assert.equal((set.anchorAt as Date).getTime(), moved.getTime());
	assert.equal((set.nextDueAt as Date).getTime(), moved.getTime());
});

test('pausing alone accepts departed members; editing finances does not', async () => {
	state.sets = [];
	state.memberWhere = [];
	const paused = await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		paused: true,
	});
	assert.equal(paused.status, 200);
	assert.ok(state.sets[0]?.pausedAt instanceof Date);
	assert.doesNotMatch(state.memberWhere[0] ?? '', /deactivated_at/);

	await editRecurringTemplate(caller, template() as never, { id: 'template-1', amountCents: 1000 });
	assert.match(state.memberWhere[1] ?? '', /"deactivated_at" is null/);
});

test('a split total that does not match the amount is refused before any write', async () => {
	state.sets = [];
	const response = await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		amountCents: 2000,
	});
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'splits_sum_mismatch' });
	assert.equal(state.sets.length, 0);
});

test('pause and resume compare the loaded due date like an edit', async () => {
	state.updateWhere = [];
	await editRecurringTemplate(caller, template() as never, { id: 'template-1', paused: true });
	await editRecurringTemplate(caller, template({ pausedAt: anchorAt }) as never, {
		id: 'template-1',
		paused: false,
	});
	assert.equal(state.updateWhere.length, 2);
	for (const where of state.updateWhere) assert.match(where, /"next_due_at" = \$/);
});

test('a stale version is a conflict unless the template already holds the edit', async () => {
	const updatedAt = new Date(anchorAt.getTime() + DAY_MS);
	const stale = { id: 'template-1', expectedUpdatedAt: anchorAt.toISOString() };
	state.sets = [];
	const changed = await editRecurringTemplate(caller, template({ updatedAt }) as never, {
		...stale,
		description: 'Strom',
	});
	assert.equal(changed.status, 409);
	// The retry of a save whose answer got lost finds its own values in place.
	const held = await editRecurringTemplate(caller, template({ updatedAt }) as never, {
		...stale,
		description: 'Internet',
		amountCents: 1000,
		nextDueAt: dueAt.toISOString(),
	});
	assert.equal(held.status, 200);
	assert.equal(state.sets.length, 0);
});

test('a second template edit with an old version conflicts in the same millisecond', async (t) => {
	const version = new Date('2026-10-30T10:00:00.000Z');
	const snapshot = template({ updatedAt: version });
	state.currentTemplate = { ...snapshot };
	state.sets = [];
	t.mock.timers.enable({ apis: ['Date'], now: version });
	try {
		const first = await editRecurringTemplate(caller, snapshot as never, {
			id: 'template-1',
			description: 'Strom',
			expectedUpdatedAt: version.toISOString(),
		});
		assert.equal(first.status, 200);

		const stale = await editRecurringTemplate(caller, snapshot as never, {
			id: 'template-1',
			description: 'Miete',
			expectedUpdatedAt: version.toISOString(),
		});
		assert.equal(stale.status, 409);
		assert.equal(state.currentTemplate?.description, 'Strom');

		const timestampSql = dialect.sqlToQuery(state.sets[0]?.updatedAt as never).sql;
		assert.match(timestampSql, /greatest\(clock_timestamp\(\)/);
		assert.match(timestampSql, /"updated_at" \+ interval '1 millisecond'/);
	} finally {
		t.mock.timers.reset();
		state.currentTemplate = null;
	}
});

test('resuming compares the due date with the Berlin day, not the UTC day', async () => {
	const pausedAt = new Date('2026-07-01T10:00:00Z');
	const paused = template({
		pausedAt,
		nextDueAt: new Date('2026-07-14T10:00:00Z'),
		anchorAt: new Date('2026-06-14T10:00:00Z'),
	});
	const resumeAt = async (now: string) => {
		mock.timers.enable({ apis: ['Date'], now: new Date(now) });
		state.sets = [];
		try {
			await editRecurringTemplate(caller, paused as never, { id: 'template-1', paused: false });
		} finally {
			mock.timers.reset();
		}
		const [set] = state.sets;
		assert.ok(set);
		return (set.nextDueAt as Date).toISOString();
	};
	// 00:30 Berlin on 15.07.: the 14.07. charge is yesterday and must not be booked.
	assert.equal(await resumeAt('2026-07-14T22:30:00Z'), '2026-08-14T10:00:00.000Z');
	// 23:30 Berlin on 14.07.: due today stays due.
	assert.equal(await resumeAt('2026-07-14T21:30:00Z'), '2026-07-14T10:00:00.000Z');
});

test('pause, resume and edit each write their own audit entry and guard on the pause state', async () => {
	audits.length = 0;
	state.updateWhere = [];
	state.sets = [];
	await editRecurringTemplate(caller, template() as never, { id: 'template-1', paused: true });
	await editRecurringTemplate(caller, template({ pausedAt: anchorAt }) as never, {
		id: 'template-1',
		paused: false,
	});
	await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		description: 'Neu',
	});
	assert.deepEqual(
		audits.map((a) => [a.eventType, a.memberId]),
		[
			['recurring.paused', MEMBER],
			['recurring.resumed', MEMBER],
			['recurring.updated', MEMBER],
		],
	);
	assert.ok(state.sets[0]?.pausedAt instanceof Date);
	assert.equal(state.sets[1]?.pausedAt, null);
	assert.equal('pausedAt' in (state.sets[2] ?? {}), false);
	assert.match(state.updateWhere[0] ?? '', /"paused_at" is null/);
	assert.match(state.updateWhere[1] ?? '', /"paused_at" is not null/);
});
