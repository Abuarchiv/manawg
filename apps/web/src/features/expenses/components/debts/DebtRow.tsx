'use client';

import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import { cn } from '@/shared/lib/cn';
import { pluralize } from '@/shared/lib/plural';
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
	currency: string;
	oldestDebtAgeDays: number;
	/** Phrase from this person's point of view: "schuldet dir" instead of their own name. */
	currentMemberId?: string;
	action?: ReactNode;
}

export function DebtRow({
	debtor,
	creditor,
	amountCents,
	currency,
	oldestDebtAgeDays,
	currentMemberId,
	action,
}: DebtRowProps) {
	const owedToMe = creditor.id === currentMemberId;
	const iOwe = debtor.id === currentMemberId;
	const ageLabel =
		oldestDebtAgeDays >= 1
			? `seit ${pluralize(oldestDebtAgeDays, 'Tag', 'Tagen')}`
			: 'heute fällig';

	return (
		<li>
			<Item size="sm" className="items-center gap-x-2.5">
				<div aria-hidden className="flex shrink-0 items-center -space-x-0.5">
					<MemberAvatar name={debtor.name} size={24} className="ring-2 ring-card" />
					<MemberAvatar name={creditor.name} size={24} className="ring-2 ring-card" />
				</div>
				<ItemContent className="min-w-0 basis-28">
					<ItemTitle className="line-clamp-none break-words">
						{iOwe ? 'Du schuldest' : `${debtor.name} schuldet`} {owedToMe ? 'dir' : creditor.name}
					</ItemTitle>
					<ItemDescription>
						{ageLabel} ·{' '}
						<span
							className={cn(
								'font-mono tabular-nums',
								owedToMe ? 'text-settled' : iOwe ? 'text-destructive' : 'text-foreground',
							)}
						>
							{formatEuroCents(amountCents, currency)}
						</span>
					</ItemDescription>
				</ItemContent>
				{action && <div className="ml-auto min-w-0 max-w-full">{action}</div>}
			</Item>
		</li>
	);
}
