'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { RecurringForm } from '@/features/expenses/components/recurring/RecurringForm';
import { RecurringModalShell } from '@/features/expenses/components/recurring/RecurringModalShell';
import type { MemberOption, RecurringExpense } from '@/features/expenses/expense-types';
import type { RecurringFormValues } from '@/features/expenses/recurring-form-model';

interface RecurringEditModalProps {
	recurringExpense: RecurringExpense;
	members: MemberOption[];
	submitting: boolean;
	saveError?: string | null | undefined;
	onClose: () => void;
	onSubmit: (values: RecurringFormValues) => void;
}

export function RecurringEditModal({
	recurringExpense,
	members,
	submitting,
	saveError,
	onClose,
	onSubmit,
}: RecurringEditModalProps) {
	const t = useTranslations('expenses-recurring');
	// RecurringForm resyncs its fields whenever `initial` changes identity (so
	// switching to a different recurringExpense picks up fresh values). A fresh object
	// literal here would give it a new identity on every re-render of this
	// modal — e.g. any unrelated state change on the parent recurringExpenses page while
	// the user is mid-edit — silently discarding whatever they just typed.
	// Keying the memo on `recurringExpense` ties the identity to the actual data instead.
	const initial = useMemo(
		() => ({
			description: recurringExpense.description,
			category: recurringExpense.category,
			amountCents: recurringExpense.amountCents,
			paidByMemberId: recurringExpense.paidByMemberId,
			intervalMonths: recurringExpense.intervalMonths,
			nextDueAt: recurringExpense.nextDueAt,
			splits: recurringExpense.splits,
		}),
		[recurringExpense],
	);

	return (
		<RecurringModalShell title={t('modal.editTitle')} onClose={onClose} submitting={submitting}>
			{(requestClose) => (
				<RecurringForm
					mode="edit"
					members={members}
					submitting={submitting}
					saveError={saveError}
					defaultPaidByMemberId={recurringExpense.paidByMemberId}
					initial={initial}
					onCancel={requestClose}
					onSubmit={onSubmit}
				/>
			)}
		</RecurringModalShell>
	);
}
