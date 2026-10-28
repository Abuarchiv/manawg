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
import { formatTimeFull, relativeTimeMessage } from '@/core/utils/time';
import type { ReminderHistoryItem } from '@/features/expenses/expense-types';
import { useMessage } from '@/shared/i18n/message';
import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

interface ReminderHistoryProps {
	items: ReadonlyArray<ReminderHistoryItem>;
	memberName: (id: string) => string;
	currentMemberId?: string;
}

// The API stores internal channel codes ('push' | 'inapp'); 'pending' marks a row shown before
// the send has been confirmed.
const CHANNELS = ['push', 'inapp', 'pending'] as const;

function channelKey(channel: string): (typeof CHANNELS)[number] | 'unknown' {
	return CHANNELS.find((known) => known === channel) ?? 'unknown';
}

export function ReminderHistory({ items, memberName, currentMemberId }: ReminderHistoryProps) {
	const locale = useLocale();
	const t = useTranslations('expenses-debts.history');
	const tLine = useTranslations('expenses-debts');
	const message = useMessage();
	if (items.length === 0)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Bell />
					</EmptyMedia>
					<EmptyTitle>{t('emptyTitle')}</EmptyTitle>
					<EmptyDescription>{t('emptyBody')}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<ItemGroup>
			{items.map((item) => (
				<ItemEntry key={item.id} variant="outline" size="sm">
					<ItemContent className="min-w-[min(100%,12rem)]">
						<ItemTitle className="line-clamp-none break-words">
							{tLine('debtLine', {
								debtorSelf: item.debtorMemberId === currentMemberId ? 'yes' : 'no',
								debtor: memberName(item.debtorMemberId),
								creditorSelf: item.creditorMemberId === currentMemberId ? 'yes' : 'no',
								creditor: memberName(item.creditorMemberId),
							})}
						</ItemTitle>
						<ItemDescription className="line-clamp-none break-words">
							<time dateTime={item.sentAt} title={formatTimeFull(item.sentAt, locale)}>
								{message(relativeTimeMessage(item.sentAt, Date.now(), locale))}
							</time>{' '}
							· {t(`channel.${channelKey(item.channel)}`)}
						</ItemDescription>
					</ItemContent>
					<Badge
						variant="outline"
						className="ml-auto h-auto min-h-5 shrink-0 text-meta font-mono tabular-nums"
					>
						{formatEuroCents(item.amountCents, item.currency, { locale })}
					</Badge>
				</ItemEntry>
			))}
		</ItemGroup>
	);
}
