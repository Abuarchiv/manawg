import { type db, expensePayments, expenseSplits, expenses } from '@/core/db';
import { normalizeCurrency } from '@/core/utils/money';
import { and, eq, gte, inArray } from 'drizzle-orm';

export interface ImportToCheck {
	id: string;
	startedAt: Date;
}

/**
 * The imports whose expenses cannot be taken back: a non-payer share was settled, or a
 * payment completed since the import between members of it in one of its currencies. Such a
 * payment may have covered the imported balance through a netted chain, and which part it
 * covered is not recoverable. Payments between other members or in other currencies do not count.
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
	const members = new Map<string, Set<string>>();
	const currencies = new Map<string, Set<string>>();
	for (const row of rows) {
		if (!row.importId) continue;
		const memberSet = members.get(row.importId) ?? new Set<string>();
		const currencySet = currencies.get(row.importId) ?? new Set<string>();
		memberSet.add(row.paidBy);
		currencySet.add(normalizeCurrency(row.currency));
		if (row.debtor) memberSet.add(row.debtor);
		// A payer's own share is settled from the start; anyone else's means money moved.
		if (row.debtor && row.settledAt && row.debtor !== row.paidBy) settled.add(row.importId);
		members.set(row.importId, memberSet);
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
		const memberSet = members.get(item.id);
		const currencySet = currencies.get(item.id);
		if (!memberSet || !currencySet) continue;
		const related = payments.some(
			(payment) =>
				payment.completedAt !== null &&
				payment.completedAt >= item.startedAt &&
				currencySet.has(normalizeCurrency(payment.currency)) &&
				(memberSet.has(payment.from) || memberSet.has(payment.to)),
		);
		if (related) settled.add(item.id);
	}
	return settled;
}
