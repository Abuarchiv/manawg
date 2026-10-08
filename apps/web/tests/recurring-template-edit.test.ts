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

const state = { sets: [] as Array<Record<string, unknown>>, memberWhere: [] as string[] };

mock.module('@/core/db', {
	namedExports: {
		...schema,
		db: {
			select: () => ({
				from: () => ({
					where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
						state.memberWhere.push(dialect.sqlToQuery(condition).sql);
						return [{ id: MEMBER }];
					},
				}),
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: async () => {
							state.sets.push(values);
							return [{ ...template(), ...values }];
						},
					}),
				}),
			}),
		},
	},
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
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
	assert.equal((state.sets[0]?.anchorAt as Date).getTime(), anchorAt.getTime());
	assert.equal((state.sets[0]?.nextDueAt as Date).getTime(), dueAt.getTime());
});

test('a due date moved to another day re-anchors the cadence', async () => {
	state.sets = [];
	const moved = new Date(dueAt.getTime() + 2 * DAY_MS);
	const response = await editRecurringTemplate(caller, template() as never, {
		id: 'template-1',
		nextDueAt: moved.toISOString(),
	});
	assert.equal(response.status, 200);
	assert.equal((state.sets[0]?.anchorAt as Date).getTime(), moved.getTime());
	assert.equal((state.sets[0]?.nextDueAt as Date).getTime(), moved.getTime());
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
