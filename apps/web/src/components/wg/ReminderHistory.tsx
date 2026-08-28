'use client';

import { formatEuroCents } from '@/lib/money';
import { formatRelativeTime, formatTimeFull } from '@/lib/time';
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
	if (items.length === 0) {
		return (
			<div className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-[13px] text-[var(--text-3)]">
				<Bell className="mx-auto mb-2 h-4 w-4" aria-hidden />
				Noch keine Mahnungen versendet.
			</div>
		);
	}

	return (
		<ul className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-base)]">
			{items.map((item) => (
				<li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
					<div className="min-w-0">
						<p className="truncate text-[13px] text-[var(--text-1)]">
							{memberName(item.debtorMemberId)} <span className="sr-only">schuldet</span>
							<span className="text-[var(--text-3)]" aria-hidden="true">
								←
							</span>{' '}
							{memberName(item.creditorMemberId)}
						</p>
						<p className="text-[11.5px] text-[var(--text-3)]">
							<time dateTime={item.sentAt} title={formatTimeFull(item.sentAt)}>
								{formatRelativeTime(item.sentAt)}
							</time>{' '}
							· {item.channel}
						</p>
					</div>
					<div className="shrink-0 text-right text-[13px] tabular-nums text-[var(--text-2)]">
						{formatEuroCents(item.amountCents, item.currency)}
					</div>
				</li>
			))}
		</ul>
	);
}
