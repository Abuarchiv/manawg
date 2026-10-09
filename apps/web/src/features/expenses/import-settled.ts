import { type db, expensePayments, expenseSplits, expenses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { normalizeCurrency } from '@/core/utils/money';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { type PairBalance, computeBalances } from './debts';
import { loadOpenExpenses } from './open-expenses';

export interface ImportToCheck {
	id: string;
	startedAt: Date;
}

/**
 * The imports whose expenses cannot be taken back: a non-payer share was settled, or the
 * payments completed since the import show it. The balances decide that, not who paid whom:
 * taking the import out must not leave a debt, or a larger one, that the current balances do
 * not have. That holds for a payment of the imported debt itself, for one carried on through a
 * netted chain, and for a payment that closed a circle through the import. A payment by the
 * creditor or one that a different debt fully backs leaves undo possible.
 */
export async function findSettledImportIds(
	executor: typeof db | DbTransaction,
	wgId: string,
	imports: ReadonlyArray<ImportToCheck>,
): Promise<Set<string>> {
	const settled = new Set<string>();
	if (imports.length === 0) return settled;
	const rows = await executor
		.select({
			importId: expenses.importId,
			paidBy: expenses.paidByMemberId,
			currency: expenses.currency,
			debtor: expenseSplits.debtorMemberId,
			settledAt: expenseSplits.settledAt,
		})
		.from(expenses)
		.leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
		.where(
			and(
				eq(expenses.wgId, wgId),
				inArray(
					expenses.importId,
					imports.map((item) => item.id),
				),
			),
		);
	const currencies = new Map<string, Set<string>>();
	for (const row of rows) {
		if (!row.importId) continue;
		const currencySet = currencies.get(row.importId) ?? new Set<string>();
		currencySet.add(normalizeCurrency(row.currency));
		// A payer's own share is settled from the start; anyone else's means money moved.
		if (row.debtor && row.settledAt && row.debtor !== row.paidBy) settled.add(row.importId);
		currencies.set(row.importId, currencySet);
	}

	const earliest = new Date(Math.min(...imports.map((item) => item.startedAt.getTime())));
	const payments = await executor
		.select({
			from: expensePayments.fromMemberId,
			to: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
			completedAt: expensePayments.completedAt,
		})
		.from(expensePayments)
		.where(
			and(
				eq(expensePayments.wgId, wgId),
				eq(expensePayments.status, 'completed'),
				gte(expensePayments.completedAt, earliest),
			),
		);
	for (const item of imports) {
		const currencySet = currencies.get(item.id);
		if (settled.has(item.id) || !currencySet) continue;
		// Only payments made since this import can have covered its shares; older ones are
		// part of the history before it and stay out of the comparison.
		const sincePayments = payments.filter(
			(payment) =>
				payment.completedAt !== null &&
				payment.completedAt >= item.startedAt &&
				currencySet.has(normalizeCurrency(payment.currency)),
		);
		const lastPaymentAt = sincePayments.reduce<Date | null>(
			(latest, payment) =>
				payment.completedAt !== null && (!latest || payment.completedAt > latest)
					? payment.completedAt
					: latest,
			null,
		);
		if (!lastPaymentAt) continue;
		const since = sincePayments.map((payment) => ({
			fromMemberId: payment.from,
			toMemberId: payment.to,
			amountCents: payment.amountCents,
			currency: payment.currency,
		}));
		// The ledger as it stood at the last payment: purchases booked afterwards must not
		// make a payment that covered the import look like it paid something newer.
		const current = computeBalances(
			await loadOpenExpenses(wgId, executor, undefined, lastPaymentAt),
			since,
		);
		const without = computeBalances(
			await loadOpenExpenses(wgId, executor, item.id, lastPaymentAt),
			since,
		);
		if (createsDebts(current, without)) settled.add(item.id);
	}
	return settled;
}

/** True when `after` holds a debt that `before` does not, or a larger one. */
function createsDebts(before: ReadonlyArray<PairBalance>, after: ReadonlyArray<PairBalance>) {
	const known = new Map(
		before.map((pair) => [
			`${pair.currency}:${pair.debtorId}:${pair.creditorId}`,
			pair.amountCents,
		]),
	);
	return after.some(
		(pair) =>
			pair.amountCents > (known.get(`${pair.currency}:${pair.debtorId}:${pair.creditorId}`) ?? 0),
	);
}
