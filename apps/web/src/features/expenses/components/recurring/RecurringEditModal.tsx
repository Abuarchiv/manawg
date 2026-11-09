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
	// The form seeds its fields once, so it is keyed by template id: another template gets fresh
	// values, while a roster refresh or re-render never discards what the user typed.
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
					key={recurringExpense.id}
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
