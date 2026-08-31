import { db, expenseSplits, expenses } from '@/core/db';
import type { DebtExpenseInput } from '@/features/expenses/debts';
import { eq, inArray } from 'drizzle-orm';

/**
 * Load every expense of a WG together with its splits, shaped for the pure
 * balance math in `debts.ts`. "Open" is a misnomer kept for history: we load
 * all splits (settled and unsettled) because `computeBalances` decides which
 * ones still count. Extracted here so the balances route and the member
 * move-out check share one query instead of drifting apart.
 */
export async function loadOpenExpenses(wgId: string): Promise<DebtExpenseInput[]> {
	const expenseRows = await db
		.select({
			id: expenses.id,
			paidByMemberId: expenses.paidByMemberId,
			currency: expenses.currency,
			occurredAt: expenses.occurredAt,
		})
		.from(expenses)
		.where(eq(expenses.wgId, wgId));
	if (expenseRows.length === 0) return [];

	const ids = expenseRows.map((row) => row.id);
	const splitRows = await db
		.select({
			expenseId: expenseSplits.expenseId,
			debtorMemberId: expenseSplits.debtorMemberId,
			amountCents: expenseSplits.amountCents,
			settledAt: expenseSplits.settledAt,
		})
		.from(expenseSplits)
		.where(inArray(expenseSplits.expenseId, ids));

	const splitsByExpense = groupSplitsByExpense(splitRows);

	return expenseRows.map((row) => ({
		paidByMemberId: row.paidByMemberId,
		...(row.currency ? { currency: row.currency } : {}),
		occurredAt:
			row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
		splits: splitsByExpense.get(row.id) ?? [],
	}));
}

interface RawSplitRow {
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | string | null;
}

/**
 * Group split rows by expense id, normalising `settledAt` to an ISO string.
 *
 * The normalisation is not cosmetic: different driver versions can return
 * different types for timestamp columns, so a caller comparing the raw value
 * behaved differently depending on the driver. Normalising to ISO string
 * makes the behaviour deterministic regardless of the underlying driver.
 */
export function groupSplitsByExpense(
	rows: readonly RawSplitRow[],
): Map<string, DebtExpenseInput['splits']> {
	const splitsByExpense = new Map<string, DebtExpenseInput['splits']>();
	for (const split of rows) {
		const list = splitsByExpense.get(split.expenseId) ?? [];
		list.push({
			debtorMemberId: split.debtorMemberId,
			amountCents: split.amountCents,
			settledAt:
				split.settledAt === null
					? null
					: split.settledAt instanceof Date
						? split.settledAt.toISOString()
						: String(split.settledAt),
		});
		splitsByExpense.set(split.expenseId, list);
	}
	return splitsByExpense;
}
