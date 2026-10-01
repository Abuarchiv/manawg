import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import type { DebtorShare } from '@/features/expenses/split-math';

/**
 * Expense shown in the list while its request is in flight. When editing, a
 * share keeps its id and settled state unless its amount changed, so a
 * settled share is not shown as reopened before the server answers.
 */
export function buildOptimisticExpense({
	id,
	description,
	amountCents,
	paidByMemberId,
	imageUrl,
	splits,
	previous,
}: {
	id: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	imageUrl: string | null;
	splits: DebtorShare[];
	previous?: Expense;
}): Expense {
	const now = new Date().toISOString();
	return {
		id,
		paidByMemberId,
		amountCents,
		currency: previous?.currency ?? 'EUR',
		description,
		imageUrl,
		occurredAt: previous?.occurredAt ?? now,
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
