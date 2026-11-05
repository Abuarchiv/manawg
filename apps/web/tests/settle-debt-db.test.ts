import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';

// Settling a debt pair against real rows. The route test fakes this function, so the guards that
// live in SQL (active caller, unsettled split with the reviewed amount) are only proven here.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all migrations applied.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const { loadSettlementSnapshot, SettlementChangedError, settleDebtPair } = await import(
	'../src/features/expenses/server/settle-debt.ts'
);
const { selectSettlementScope } = await import('../src/features/expenses/settlement-scope.ts');

const pool = new pg.Pool({ connectionString: url || undefined, max: 4 });
const database = drizzle(pool, { schema });
const wgIds: string[] = [];
after(async () => {
	if (wgIds.length > 0) await database.delete(schema.wgs).where(inArray(schema.wgs.id, wgIds));
	await pool.end();
});

/** A flat where the debtor owes the payer 500 cents of one 1000-cent expense. */
async function flatWithDebt() {
	const [wg] = await database
		.insert(schema.wgs)
		.values({ shareCode: generateShareCode(), name: `Settle ${randomUUID()}` })
		.returning({ id: schema.wgs.id });
	assert.ok(wg);
	wgIds.push(wg.id);
	const member = async (name: string) => {
		const [row] = await database
			.insert(schema.wgMembers)
			.values({ wgId: wg.id, name, authUserId: randomUUID() })
			.returning({ id: schema.wgMembers.id });
		assert.ok(row);
		return row.id;
	};
	const payer = await member('Payer');
	const debtor = await member('Debtor');
	const [expense] = await database
		.insert(schema.expenses)
		.values({ wgId: wg.id, paidByMemberId: payer, amountCents: 1000, description: 'Rent' })
		.returning({ id: schema.expenses.id });
	assert.ok(expense);
	const [, split] = await database
		.insert(schema.expenseSplits)
		.values([
			{ expenseId: expense.id, debtorMemberId: payer, amountCents: 500 },
			{ expenseId: expense.id, debtorMemberId: debtor, amountCents: 500 },
		])
		.returning({ id: schema.expenseSplits.id });
	assert.ok(split);
	return { wgId: wg.id, payer, debtor, splitId: split.id };
}

async function reviewedConfirmation(wgId: string, fromMemberId: string, toMemberId: string) {
	const snapshot = await loadSettlementSnapshot(database, wgId);
	const preview = selectSettlementScope(
		snapshot.expenses,
		snapshot.members,
		snapshot.payments,
		fromMemberId,
		toMemberId,
	);
	return {
		fromMemberId,
		toMemberId,
		currency: 'EUR',
		expected: {
			currency: preview.currency,
			netCents: preview.netCents,
			settleableCents: preview.settleableCents,
			splits: preview.splits.map(({ id, amountCents, offset }) => ({ id, amountCents, offset })),
		},
	};
}

const settle = (wgId: string, callerId: string, confirmation: unknown) =>
	database.transaction((tx) => settleDebtPair(tx as never, wgId, callerId, confirmation as never));

const settledAt = async (splitId: string) =>
	(
		await database
			.select({ settledAt: schema.expenseSplits.settledAt })
			.from(schema.expenseSplits)
			.where(eq(schema.expenseSplits.id, splitId))
	)[0]?.settledAt ?? null;

test('a reviewed settlement marks the debtor share paid and answers the pair', {
	skip,
}, async () => {
	const flat = await flatWithDebt();
	const confirmation = await reviewedConfirmation(flat.wgId, flat.debtor, flat.payer);
	const outcome = await settle(flat.wgId, flat.debtor, confirmation);
	assert.equal(outcome.status, 200);
	assert.deepEqual(outcome.body, {
		settled: 1,
		settledIds: [flat.splitId],
		settledCents: 500,
		currency: 'EUR',
		remainingCents: 0,
		creditor: flat.payer,
		debtor: flat.debtor,
	});
	assert.ok(await settledAt(flat.splitId));
});

test('a review that no longer matches is refused and settles nothing', { skip }, async () => {
	const flat = await flatWithDebt();
	const confirmation = await reviewedConfirmation(flat.wgId, flat.debtor, flat.payer);
	const stale = { ...confirmation, expected: { ...confirmation.expected, netCents: 400 } };
	const outcome = await settle(flat.wgId, flat.debtor, stale);
	assert.equal(outcome.status, 409);
	assert.deepEqual(outcome.context, { kind: 'changed' });
	assert.equal(await settledAt(flat.splitId), null);
});

test('a moved-out caller or a member of another flat cannot settle', { skip }, async () => {
	const flat = await flatWithDebt();
	const other = await flatWithDebt();
	const confirmation = await reviewedConfirmation(flat.wgId, flat.debtor, flat.payer);
	await database
		.update(schema.wgMembers)
		.set({ deactivatedAt: new Date() })
		.where(eq(schema.wgMembers.id, flat.debtor));
	const movedOut = await settle(flat.wgId, flat.debtor, confirmation);
	assert.equal(movedOut.status, 401);
	assert.deepEqual(movedOut.context, { kind: 'member_deactivated' });

	for (const pair of [
		{ fromMemberId: other.debtor, toMemberId: flat.payer },
		{ fromMemberId: flat.payer, toMemberId: other.payer },
	]) {
		const outcome = await settle(flat.wgId, flat.payer, { ...confirmation, ...pair });
		assert.equal(outcome.status, 400);
		assert.deepEqual(outcome.context, { kind: 'member_not_in_wg' });
	}
	assert.equal(await settledAt(flat.splitId), null);
});

for (const [label, change] of [
	['settled', 'UPDATE expense_splits SET settled_at = now() WHERE id = $1'],
	['changed in amount', 'UPDATE expense_splits SET amount_cents = 400 WHERE id = $1'],
] as const) {
	test(`a share ${label} by someone else during the settlement aborts it`, { skip }, async () => {
		const flat = await flatWithDebt();
		const confirmation = await reviewedConfirmation(flat.wgId, flat.debtor, flat.payer);
		const other = await pool.connect();
		try {
			await other.query('BEGIN');
			await other.query('SELECT 1 FROM expense_splits WHERE id = $1 FOR UPDATE', [flat.splitId]);
			const settling = settle(flat.wgId, flat.debtor, confirmation);
			// The settlement reads the open share, then waits on the locked row.
			await new Promise((resolve) => setTimeout(resolve, 300));
			await other.query(change, [flat.splitId]);
			await other.query('COMMIT');
			await assert.rejects(settling, SettlementChangedError);
		} finally {
			other.release();
		}
	});
}

test('a debt that only exists through a third member settles nothing and says why', {
	skip,
}, async () => {
	const flat = await flatWithDebt();
	// The debtor owes the payer 500 directly; a third member who owes the debtor 500 makes the
	// simplified debt run from the third member to the payer without any split between them.
	const [third] = await database
		.insert(schema.wgMembers)
		.values({ wgId: flat.wgId, name: 'Third', authUserId: randomUUID() })
		.returning({ id: schema.wgMembers.id });
	assert.ok(third);
	const [expense] = await database
		.insert(schema.expenses)
		.values({ wgId: flat.wgId, paidByMemberId: flat.debtor, amountCents: 500, description: 'Gas' })
		.returning({ id: schema.expenses.id });
	assert.ok(expense);
	await database
		.insert(schema.expenseSplits)
		.values({ expenseId: expense.id, debtorMemberId: third.id, amountCents: 500 });
	const confirmation = await reviewedConfirmation(flat.wgId, third.id, flat.payer);
	assert.equal(confirmation.expected.netCents, 500);
	const outcome = await settle(flat.wgId, third.id, confirmation);
	assert.equal(outcome.status, 200);
	assert.deepEqual(outcome.body, {
		settled: 0,
		settledIds: [],
		settledCents: 0,
		currency: 'EUR',
		remainingCents: 500,
		creditor: flat.payer,
		debtor: third.id,
		reason: 'no_direct_splits',
	});
});
