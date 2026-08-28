'use client';

import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface DebtRowMember {
	id: string;
	name: string;
	color: string | null;
}

interface DebtRowProps {
	debtor: DebtRowMember;
	creditor: DebtRowMember;
	amountCents: number;
	oldestDebtAgeDays: number;
	action?: ReactNode;
}

export function DebtRow({
	debtor,
	creditor,
	amountCents,
	oldestDebtAgeDays,
	action,
}: DebtRowProps) {
	const ageLabel =
		oldestDebtAgeDays >= 1
			? `seit ${oldestDebtAgeDays} ${oldestDebtAgeDays === 1 ? 'Tag' : 'Tagen'}`
			: 'heute fällig';

	return (
		<li className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-2">
				<MemberAvatar name={debtor.name} color={debtor.color} size={24} />
				<span className="truncate text-[13.5px] font-medium text-[var(--text-1)]">
					{debtor.name}
				</span>
				<span className="sr-only">schuldet</span>
				<ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden />
				<MemberAvatar name={creditor.name} color={creditor.color} size={24} />
				<span className="truncate text-[13.5px] text-[var(--text-2)]">{creditor.name}</span>
			</div>
			<div className="flex items-center justify-between gap-3 sm:justify-end">
				<div className="text-right">
					<div className="text-[14px] font-semibold tabular-nums text-[var(--text-1)]">
						{formatEuroCents(amountCents)}
					</div>
					<div className="text-[12px] text-[var(--text-3)]">{ageLabel}</div>
				</div>
				{action}
			</div>
		</li>
	);
}
