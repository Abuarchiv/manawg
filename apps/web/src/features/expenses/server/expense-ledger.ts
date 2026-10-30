import 'server-only';
import { eq } from 'drizzle-orm';
import { db, expenseSplits, expenses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import type { DebtExpenseInput } from '@/features/expenses/debts';

/** Every expense with all splits; the debt calculation decides which splits still count. */
export async function loadExpensesWithSplits(
	wgId: string,
	client: typeof db | DbTransaction = db,
): Promise<DebtExpenseInput[]> {
	return (await loadLedger(wgId, client)).map((entry) => entry.debt);
}

/** Booking data for reconstructing the ledger at a past moment. */
export interface LedgerEntry {
	importId: string | null;
	createdAt: Date;
	debt: DebtExpenseInput;
}

/** One query keeps a concurrent edit from mixing an old payer with new splits. */
export async function loadLedger(
	wgId: string,
	client: typeof db | DbTransaction = db,
): Promise<LedgerEntry[]> {
	const rows = await client
		.select({
			expense: {
				id: expenses.id,
				paidByMemberId: expenses.paidByMemberId,
				currency: expenses.currency,
				occurredAt: expenses.occurredAt,
				importId: expenses.importId,
				createdAt: expenses.createdAt,
			},
			split: {
				expenseId: expenseSplits.expenseId,
				debtorMemberId: expenseSplits.debtorMemberId,
				amountCents: expenseSplits.amountCents,
				settledAt: expenseSplits.settledAt,
			},
		})
		.from(expenses)
		.leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
		.where(eq(expenses.wgId, wgId));

	const ledger = new Map<string, LedgerEntry>();
	for (const { expense, split } of rows) {
		let entry = ledger.get(expense.id);
		if (!entry) {
			entry = {
				importId: expense.importId ?? null,
				createdAt: expense.createdAt,
				debt: {
					paidByMemberId: expense.paidByMemberId,
					...(expense.currency ? { currency: expense.currency } : {}),
					occurredAt:
						expense.occurredAt instanceof Date
							? expense.occurredAt.toISOString()
							: String(expense.occurredAt),
					splits: [],
				},
			};
			ledger.set(expense.id, entry);
		}
		if (split) {
			entry.debt.splits.push({
				debtorMemberId: split.debtorMemberId,
				amountCents: split.amountCents,
				settledAt:
					split.settledAt === null
						? null
						: split.settledAt instanceof Date
							? split.settledAt.toISOString()
							: String(split.settledAt),
			});
		}
	}
	return [...ledger.values()];
}
