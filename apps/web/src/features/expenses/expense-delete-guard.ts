interface SettledShareSplit {
	debtorMemberId: string;
	settledAt: string | null;
}

interface SettledShareExpense {
	paidByMemberId: string;
	splits: readonly SettledShareSplit[];
}

/**
 * Mirror of the API's delete gate: a share that someone other than the payer
 * already settled means money moved, and deleting the expense would silently
 * undo it. Such an expense must not offer Delete in the UI.
 *
 * Kept free of React and database imports so both the ledger row and future
 * callers can share it.
 */
export function hasSettledShares(expense: SettledShareExpense): boolean {
	return expense.splits.some(
		(split) => split.debtorMemberId !== expense.paidByMemberId && split.settledAt !== null,
	);
}
