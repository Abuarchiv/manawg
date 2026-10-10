import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

// Booking a recurring charge moves its template on in the same transaction: a lost follow-up
// advance request must not leave the booked charge due. writeExpense runs against a fake
// transaction that records the template update.

const schema = await import('../src/core/db/schema.ts');
const { expenses, recurringExpenses } = schema;

const WG = 'wg-1';
const DUE = new Date('2026-01-31T00:00:00.000Z');
const template = {
	id: 'template-1',
	wgId: WG,
	description: 'Miete',
	category: 'wohnen' as const,
	amountCents: 100,
	intervalMonths: 1,
	nextDueAt: DUE,
	anchorAt: DUE,
	pausedAt: null,
	lastCreatedAt: null,
	splitsJson: '[]',
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const state = { updates: [] as Array<Record<string, unknown>>, casMatches: true };

mock.module('@/core/db', { namedExports: { ...schema, db: {} } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort } });
mock.module('@/core/db/idempotent-write', { namedExports: { bodyCodec: () => ({}) } });
mock.module('@/core/db/private-image-deletions', {
	namedExports: { assertPrivateImageCanBeAttached: async () => undefined },
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: { hasCapturingExpensePayment: async () => false },
});
mock.module('@/features/expenses/server/expenses', {
	namedExports: {
		insertExpenseWithSplits: async (_tx: unknown, input: Record<string, unknown>) => ({
			expense: { id: 'expense-1', ...input },
			splits: [],
		}),
	},
});

const { writeExpense } = await import('../src/features/expenses/server/expense-create.ts');

function fakeTx() {
	return {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						// No booking exists yet for this due date.
						if (table === expenses) return Promise.resolve([]);
						assert.equal(table, recurringExpenses);
						return { for: async () => [template] };
					},
				}),
			}),
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						assert.equal(table, recurringExpenses);
						state.updates.push(values);
						return state.casMatches ? [{ ...template, ...values }] : [];
					},
				}),
			}),
		}),
	} as never;
}

const input = {
	wgId: WG,
	paidByMemberId: 'member-1',
	amountCents: 100,
	currency: 'EUR',
	description: 'Miete',
	category: 'wohnen' as const,
	imageUrl: null,
	occurredAt: DUE,
	splits: [{ debtorMemberId: 'member-1', amountCents: 100 }],
};

test('a recurring booking advances its template in the booking transaction', async () => {
	state.updates = [];
	state.casMatches = true;
	const outcome = await writeExpense(fakeTx(), {
		...input,
		recurring: { id: template.id, expectedDueAt: DUE },
	});
	assert.equal(state.updates.length, 1);
	// The anchor day (31st) survives the clamp to February.
	assert.equal((state.updates[0]?.nextDueAt as Date).toISOString(), '2026-02-28T00:00:00.000Z');
	assert.ok(outcome.context && 'created' in outcome.context);
	assert.equal(outcome.context.created.recurringDueAt, DUE);
	assert.equal(outcome.context.advanced?.nextDueAt.toISOString(), '2026-02-28T00:00:00.000Z');
	// The response carries the advanced template, so no follow-up PATCH is needed.
	assert.equal(
		(outcome.body as { recurringExpense?: { nextDueAt: string } }).recurringExpense?.nextDueAt,
		'2026-02-28T00:00:00.000Z',
	);
});

test('a lost compare-and-set aborts the booking so the insert rolls back', async () => {
	state.updates = [];
	state.casMatches = false;
	await assert.rejects(
		writeExpense(fakeTx(), { ...input, recurring: { id: template.id, expectedDueAt: DUE } }),
		(err: unknown) =>
			err instanceof TransactionAbort && err.code === 'recurring_expense_already_advanced',
	);
});

test('an ordinary expense touches no template', async () => {
	state.updates = [];
	const outcome = await writeExpense(fakeTx(), input);
	assert.equal(state.updates.length, 0);
	assert.ok(outcome.context && 'created' in outcome.context);
	assert.equal(outcome.context.advanced, null);
});
