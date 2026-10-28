'use client';

import { useTranslations } from 'next-intl';
import { RecurringForm } from '@/features/expenses/components/recurring/RecurringForm';
import { RecurringModalShell } from '@/features/expenses/components/recurring/RecurringModalShell';
import type { MemberOption } from '@/features/expenses/expense-types';
import type { RecurringFormValues } from '@/features/expenses/recurring-form-model';

interface RecurringCreateModalProps {
	members: MemberOption[];
	defaultPaidByMemberId: string;
	submitting: boolean;
	saveError?: string | null | undefined;
	onClose: () => void;
	onSubmit: (values: RecurringFormValues) => void;
}

export function RecurringCreateModal({
	members,
	defaultPaidByMemberId,
	submitting,
	saveError,
	onClose,
	onSubmit,
}: RecurringCreateModalProps) {
	const t = useTranslations('expenses-recurring');
	return (
		<RecurringModalShell title={t('modal.createTitle')} onClose={onClose} submitting={submitting}>
			{(requestClose) => (
				<RecurringForm
					mode="create"
					members={members}
					defaultPaidByMemberId={defaultPaidByMemberId}
					submitting={submitting}
					saveError={saveError}
					onCancel={requestClose}
					onSubmit={onSubmit}
				/>
			)}
		</RecurringModalShell>
	);
}
