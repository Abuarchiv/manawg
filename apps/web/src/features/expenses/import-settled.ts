import { type db, expensePayments, expenseSplits, expenses } from '@/core/db';
import { normalizeCurrency } from '@/core/utils/money';
import { and, eq, gte, inArray } from 'drizzle-orm';

export interface ImportToCheck {
	id: string;
	startedAt: Date;
}

/**
 * The imports whose expenses cannot be taken back: a non-payer share was settled, or a payment
 * completed after the import may have covered the imported balance. That is a payment, in one of
 * the import's currencies, from someone who owes through the import (a netted chain can carry it
 * on to a third member) or to someone the import owes money. A payment by the creditor, or
 * between other members, leaves the imported balance open and does not count.
 */
export async function findSettledImportIds(
	executor: Pick<typeof db, 'select'>,
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
	const payers = new Map<string, Set<string>>();
	const debtors = new Map<string, Set<string>>();
	const currencies = new Map<string, Set<string>>();
	for (const row of rows) {
		if (!row.importId) continue;
		const payerSet = payers.get(row.importId) ?? new Set<string>();
		const debtorSet = debtors.get(row.importId) ?? new Set<string>();
		const currencySet = currencies.get(row.importId) ?? new Set<string>();
		payerSet.add(row.paidBy);
		currencySet.add(normalizeCurrency(row.currency));
		if (row.debtor && row.debtor !== row.paidBy) debtorSet.add(row.debtor);
		// A payer's own share is settled from the start; anyone else's means money moved.
		if (row.debtor && row.settledAt && row.debtor !== row.paidBy) settled.add(row.importId);
		payers.set(row.importId, payerSet);
		debtors.set(row.importId, debtorSet);
		currencies.set(row.importId, currencySet);
	}

	const earliest = new Date(Math.min(...imports.map((item) => item.startedAt.getTime())));
	const payments = await executor
		.select({
			from: expensePayments.fromMemberId,
			to: expensePayments.toMemberId,
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
		const payerSet = payers.get(item.id);
		const debtorSet = debtors.get(item.id);
		const currencySet = currencies.get(item.id);
		if (!payerSet || !debtorSet || !currencySet) continue;
		const related = payments.some(
			(payment) =>
				payment.completedAt !== null &&
				payment.completedAt >= item.startedAt &&
				currencySet.has(normalizeCurrency(payment.currency)) &&
				(debtorSet.has(payment.from) || payerSet.has(payment.to)),
		);
		if (related) settled.add(item.id);
	}
	return settled;
}
