'use client';

import { Badge } from '@/components/ui/badge';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { formatEuroCents } from '@/core/utils/money';
import type { ExpenseSplitShare } from '@/features/expenses/expense-types';
import type { MemberRef } from '@/shared/lib/member-types';

interface SplitReviewProps {
	members: ReadonlyArray<MemberRef>;
	splits: ReadonlyArray<ExpenseSplitShare> | null;
	paidByMemberId: string;
	currency?: string;
}

// The caller supplies the exact split result used by its existing save handler.
export function SplitReview({
	members,
	splits,
	paidByMemberId,
	currency = 'EUR',
}: SplitReviewProps) {
	if (!splits) return null;
	return (
		<ItemGroup aria-label="Anteile vor dem Speichern" aria-live="polite" className="gap-1">
			{members.map((member) => {
				const share = splits.find((split) => split.debtorMemberId === member.id);
				return (
					<ItemEntry key={member.id} variant="muted" size="xs">
						<ItemContent className="min-w-0">
							<ItemTitle className="line-clamp-none break-words">{member.name}</ItemTitle>
							{(!share || share.amountCents === 0) && (
								<ItemDescription className="line-clamp-none">Kein Anteil</ItemDescription>
							)}
							{share && share.amountCents !== 0 && member.id === paidByMemberId && (
								<ItemDescription className="line-clamp-none">
									Eigener Anteil · bereits bezahlt
								</ItemDescription>
							)}
						</ItemContent>
						<Badge variant="outline" className="font-mono tabular-nums">
							{formatEuroCents(share?.amountCents ?? 0, currency)}
						</Badge>
					</ItemEntry>
				);
			})}
		</ItemGroup>
	);
}
