import type { ExpenseCategory } from '@/features/expenses/expense-categories';
import type { Expense } from '@/features/expenses/expense-types';
import type { DebtorShare } from '@/features/expenses/split-math';

/**
 * Expense shown in the list while its request is in flight. When editing, a
 * share keeps its id and settled state unless its amount changed, so a
 * settled share is not shown as reopened before the server answers.
 */
export function buildOptimisticExpense({
	id,
	description,
	category,
	amountCents,
	paidByMemberId,
	imageUrl,
	splits,
	occurredAt,
	previous,
}: {
	id: string;
	description: string;
	category: ExpenseCategory;
	amountCents: number;
	paidByMemberId: string;
	imageUrl: string | null;
	splits: DebtorShare[];
	/** The day chosen in the form; omitted keeps the previous date or means now. */
	occurredAt?: string;
	previous?: Expense;
}): Expense {
	const now = new Date().toISOString();
	return {
		id,
		paidByMemberId,
		amountCents,
		currency: previous?.currency ?? 'EUR',
		description,
		category,
		imageUrl,
		occurredAt: occurredAt ?? previous?.occurredAt ?? now,
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
		splits: splits.map((split, index) => {
			const existing = previous?.splits.find(
				(current) => current.debtorMemberId === split.debtorMemberId,
			);
			return {
				id: existing?.id ?? `${id}:split:${index}`,
				debtorMemberId: split.debtorMemberId,
				amountCents: split.amountCents,
				settledAt: existing?.amountCents === split.amountCents ? existing.settledAt : null,
			};
		}),
	};
}

/** The list is shown newest first; ties fall back to entry time and id like the server order. */
export function sortExpensesNewestFirst(expenses: Expense[]): Expense[] {
	const time = (value: string) => Date.parse(value) || 0;
	return [...expenses].sort(
		(a, b) =>
			time(b.occurredAt) - time(a.occurredAt) ||
			time(b.createdAt) - time(a.createdAt) ||
			b.id.localeCompare(a.id),
	);
}

/** Undoes an optimistic row: a new one goes, an edited one gets its previous version back. */
export function rollbackExpense(
	current: Expense[],
	optimisticId: string,
	previous: Expense | null,
): Expense[] {
	if (!previous) return current.filter((expense) => expense.id !== optimisticId);
	return current.some((expense) => expense.id === previous.id)
		? current.map((expense) => (expense.id === previous.id ? previous : expense))
		: [previous, ...current];
}
