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
import { useLocale, useTranslations } from 'next-intl';

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
	const locale = useLocale();
	const t = useTranslations('expenses-form.split');
	if (!splits) return null;
	return (
		<ItemGroup aria-label={t('reviewAria')} aria-live="polite" className="gap-1">
			{members.map((member) => {
				const share = splits.find((split) => split.debtorMemberId === member.id);
				return (
					<ItemEntry key={member.id} variant="muted" size="xs">
						<ItemContent className="min-w-0">
							<ItemTitle className="line-clamp-none break-words">{member.name}</ItemTitle>
							{(!share || share.amountCents === 0) && (
								<ItemDescription className="line-clamp-none">{t('noShare')}</ItemDescription>
							)}
							{share && share.amountCents !== 0 && member.id === paidByMemberId && (
								<ItemDescription className="line-clamp-none">{t('ownShare')}</ItemDescription>
							)}
						</ItemContent>
						<Badge variant="outline" className="font-mono tabular-nums">
							{formatEuroCents(share?.amountCents ?? 0, currency, { locale })}
						</Badge>
					</ItemEntry>
				);
			})}
		</ItemGroup>
	);
}
