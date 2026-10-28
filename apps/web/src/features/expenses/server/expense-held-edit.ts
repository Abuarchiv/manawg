import 'server-only';
import { db, expenseSplits, expenses } from '@/core/db';
import { rowHoldsPatch } from '@/core/db/row-holds-patch';
import { eq } from 'drizzle-orm';

type Split = { debtorMemberId: string; amountCents: number };

/** Debtor and amount per share, in a fixed order, so two split lists compare as one string. */
function splitKey(splits: readonly Split[]): string {
	return splits
		.map((split) => `${split.debtorMemberId}:${split.amountCents}`)
		.sort()
		.join(',');
}

/**
 * The stored expense with its splits when it already holds every value of this edit: the retry
 * of a save whose answer got lost. `null` means the expense is gone or moved on.
 */
export async function storedExpenseHoldingEdit(
	id: string,
	edit: Partial<typeof expenses.$inferInsert>,
	splits: readonly Split[] | undefined,
) {
	const [stored] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
	if (!stored || !rowHoldsPatch(stored, edit)) return null;
	const storedSplits = await db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, id));
	if (splits && splitKey(splits) !== splitKey(storedSplits)) return null;
	return { ...stored, splits: storedSplits };
}
