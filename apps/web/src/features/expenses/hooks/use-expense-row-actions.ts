'use client';

import { apiFetch } from '@/core/infra/api-client';
import { expenseActionError } from '@/features/expenses/expense-errors';
import type { ExpenseSplit } from '@/features/expenses/expense-types';
import { useMessage } from '@/shared/i18n/message';
import type { ExpensePageContext } from './expense-page-context';

/** Delete an expense and toggle a share's settled state, both optimistic with rollback. */
export function useExpenseRowActions({
	wg,
	identity,
	toast,
	notify,
	pending,
	expenses,
	updateExpenses,
	reload,
}: ExpensePageContext) {
	const t = useMessage();
	const expenseApiUrl = (expenseId: string) =>
		`/api/wg/${encodeURIComponent(wg.shareCode)}/expenses/${encodeURIComponent(expenseId)}`;

	async function deleteExpense(id: string): Promise<void> {
		if (pending.isPending(id)) return;
		pending.start(id);
		notify.error(null);
		const previousExpenseIndex = expenses.findIndex((expense) => expense.id === id);
		const previousExpense = expenses[previousExpenseIndex];
		updateExpenses((current) => current.filter((expense) => expense.id !== id));

		const res = await apiFetch<unknown>(expenseApiUrl(id), {
			method: 'DELETE',
			memberId: identity.memberId,
		});

		// A 404 means someone else already deleted it, so the row has to go
		// either way — the only difference from success is that we say so.
		const alreadyGone = !res.ok && res.status === 404 && res.error === 'expense_not_found';
		if (!res.ok && !alreadyGone) {
			if (previousExpense) {
				updateExpenses((current) => {
					if (current.some((expense) => expense.id === id)) return current;
					const restored = [...current];
					restored.splice(Math.min(previousExpenseIndex, restored.length), 0, previousExpense);
					return restored;
				});
			}
			notify.error(
				t(
					res.status === 403
						? { key: 'expenses.notices.deleteForbidden' }
						: expenseActionError(res.error),
				),
			);
			pending.end(id);
			return;
		}

		if (alreadyGone) {
			notify.error(t({ key: 'expenses.notices.expenseGone' }));
		} else {
			toast.success(t({ key: 'expenses.notices.deleted' }));
		}
		pending.end(id);
		void reload();
	}

	async function toggleSettle(expenseId: string, split: ExpenseSplit): Promise<void> {
		// Double-click guard: sync check before any async work
		if (pending.isPending(split.id)) return;
		pending.start(split.id);
		notify.error(null);
		const settled = split.settledAt === null;
		const setSplitSettledAt = (settledAt: string | null) =>
			updateExpenses((current) =>
				current.map((expense) =>
					expense.id === expenseId
						? {
								...expense,
								splits: expense.splits.map((currentSplit) =>
									currentSplit.id === split.id ? { ...currentSplit, settledAt } : currentSplit,
								),
							}
						: expense,
				),
			);
		setSplitSettledAt(settled ? new Date().toISOString() : null);

		const res = await apiFetch<unknown>(
			`${expenseApiUrl(expenseId)}/splits/${encodeURIComponent(split.id)}/settle`,
			{
				method: 'POST',
				memberId: identity.memberId,
				body: JSON.stringify({ settled }),
			},
		);

		if (!res.ok) {
			setSplitSettledAt(split.settledAt);
			if (
				res.status === 404 &&
				(res.error === 'split_not_found' || res.error === 'expense_not_found')
			) {
				notify.error(t({ key: 'expenses.notices.paymentGone' }));
				void reload();
			} else {
				notify.error(t(expenseActionError(res.error)));
				if (res.error === 'split_already_offset') void reload();
			}
		} else {
			toast.success(t({ key: settled ? 'expenses.notices.settled' : 'expenses.notices.reopened' }));
			void reload();
		}

		pending.end(split.id);
	}

	return { deleteExpense, toggleSettle };
}
