'use client';

import { Badge } from '@/components/ui/badge';
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item';
import { formatEuroCents } from '@/core/utils/money';
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
		<li>
			<Item variant="outline" className="items-start">
				<ItemContent className="min-w-0">
					<ItemTitle className="line-clamp-none break-words">
						{debtor.name} schuldet {creditor.name}
					</ItemTitle>
					<ItemDescription>{ageLabel}</ItemDescription>
				</ItemContent>
				<Badge variant="secondary" className="font-mono tabular-nums text-destructive">
					{formatEuroCents(amountCents)}
				</Badge>
				{action && <ItemFooter className="justify-end">{action}</ItemFooter>}
			</Item>
		</li>
	);
}
