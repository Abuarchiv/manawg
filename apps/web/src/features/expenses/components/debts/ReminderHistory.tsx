'use client';

import { Badge } from '@/components/ui/badge';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import type { ReminderHistoryItem } from '@/features/expenses/expense-types';
import { Bell } from 'lucide-react';

interface ReminderHistoryProps {
	items: ReadonlyArray<ReminderHistoryItem>;
	memberName: (id: string) => string;
	currentMemberId?: string;
}

// The API stores internal channel codes ('push' | 'inapp'); 'pending' marks a row shown before
// the send has been confirmed.
const CHANNEL_LABELS: Readonly<Record<string, string>> = {
	push: 'Push-Benachrichtigung',
	inapp: 'In der App',
	pending: 'Wird gesendet',
};

function channelLabel(channel: string): string {
	return CHANNEL_LABELS[channel] ?? 'Unbekannt';
}

export function ReminderHistory({ items, memberName, currentMemberId }: ReminderHistoryProps) {
	if (items.length === 0)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Bell />
					</EmptyMedia>
					<EmptyTitle>Noch keine Erinnerungen</EmptyTitle>
					<EmptyDescription>Versendete Erinnerungen erscheinen hier.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<ItemGroup>
			{items.map((item) => (
				<ItemEntry key={item.id} variant="outline" size="sm">
					<ItemContent className="min-w-[min(100%,12rem)]">
						<ItemTitle className="line-clamp-none break-words">
							{item.debtorMemberId === currentMemberId
								? 'Du schuldest'
								: `${memberName(item.debtorMemberId)} schuldet`}{' '}
							{item.creditorMemberId === currentMemberId
								? 'dir'
								: memberName(item.creditorMemberId)}
						</ItemTitle>
						<ItemDescription className="line-clamp-none break-words">
							<time dateTime={item.sentAt} title={formatTimeFull(item.sentAt)}>
								{formatRelativeTime(item.sentAt)}
							</time>{' '}
							· {channelLabel(item.channel)}
						</ItemDescription>
					</ItemContent>
					<Badge
						variant="outline"
						className="ml-auto h-auto min-h-5 shrink-0 text-meta font-mono tabular-nums"
					>
						{formatEuroCents(item.amountCents, item.currency)}
					</Badge>
				</ItemEntry>
			))}
		</ItemGroup>
	);
}
