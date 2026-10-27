'use client';

import type { AboFormValues } from '@/features/expenses/abo-form-model';
import { AboForm } from '@/features/expenses/components/abos/AboForm';
import { AboModalShell } from '@/features/expenses/components/abos/AboModalShell';
import type { MemberOption } from '@/features/expenses/expense-types';

interface AboCreateModalProps {
	members: MemberOption[];
	defaultPaidByMemberId: string;
	submitting: boolean;
	saveError?: string | null | undefined;
	onClose: () => void;
	onSubmit: (values: AboFormValues) => void;
}

export function AboCreateModal({
	members,
	defaultPaidByMemberId,
	submitting,
	saveError,
	onClose,
	onSubmit,
}: AboCreateModalProps) {
	return (
		<AboModalShell title="Neue Fixkosten" onClose={onClose} submitting={submitting}>
			{(requestClose) => (
				<AboForm
					mode="create"
					members={members}
					defaultPaidByMemberId={defaultPaidByMemberId}
					submitting={submitting}
					saveError={saveError}
					onCancel={requestClose}
					onSubmit={onSubmit}
				/>
			)}
		</AboModalShell>
	);
}
