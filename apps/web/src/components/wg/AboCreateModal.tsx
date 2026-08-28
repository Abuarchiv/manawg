'use client';

import { AboForm, type AboFormValues } from '@/components/wg/AboForm';
import { AboModalShell } from '@/components/wg/AboModalShell';
import type { MemberOption } from '@/components/wg/abos-types';

interface AboCreateModalProps {
	members: MemberOption[];
	defaultPaidByMemberId: string;
	submitting: boolean;
	onClose: () => void;
	onSubmit: (values: AboFormValues) => void;
}

export function AboCreateModal({
	members,
	defaultPaidByMemberId,
	submitting,
	onClose,
	onSubmit,
}: AboCreateModalProps) {
	return (
		<AboModalShell title="Neues Abo" onClose={onClose}>
			<AboForm
				mode="create"
				members={members}
				defaultPaidByMemberId={defaultPaidByMemberId}
				submitting={submitting}
				onCancel={onClose}
				onSubmit={onSubmit}
			/>
		</AboModalShell>
	);
}
