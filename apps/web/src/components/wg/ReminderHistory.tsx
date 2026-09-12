'use client';

import { Badge } from '@/components/ui/badge';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import { Bell } from 'lucide-react';

export interface ReminderHistoryItem {
	id: string;
	debtorMemberId: string;
	creditorMemberId: string;
	amountCents: number;
	currency: string;
	channel: string;
	sentAt: string;
	oldestDebtAgeDays: number;
}

interface ReminderHistoryProps {
	items: ReadonlyArray<ReminderHistoryItem>;
	memberName: (id: string) => string;
}

export function ReminderHistory({ items, memberName }: ReminderHistoryProps) {
	if (items.length === 0)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Bell />
					</EmptyMedia>
					<EmptyTitle>Noch keine Mahnungen</EmptyTitle>
					<EmptyDescription>Versendete Mahnungen erscheinen hier.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<ItemGroup>
			{items.map((item) => (
				<Item key={item.id} variant="outline" size="sm">
					<ItemContent className="min-w-0">
						<ItemTitle className="line-clamp-none break-words">
							{memberName(item.debtorMemberId)} schuldet {memberName(item.creditorMemberId)}
						</ItemTitle>
						<ItemDescription>
							<time dateTime={item.sentAt} title={formatTimeFull(item.sentAt)}>
								{formatRelativeTime(item.sentAt)}
							</time>{' '}
							· {item.channel}
						</ItemDescription>
					</ItemContent>
					<Badge variant="outline" className="tabular-nums">
						{formatEuroCents(item.amountCents, item.currency)}
					</Badge>
				</Item>
			))}
		</ItemGroup>
	);
}
