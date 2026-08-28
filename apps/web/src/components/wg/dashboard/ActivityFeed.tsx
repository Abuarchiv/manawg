import { formatEuroCents } from '@/lib/money';
import { formatCompactRelativeTime } from '@/lib/time';
import {
	CalendarOff,
	History,
	ListChecks,
	Megaphone,
	Receipt,
	Repeat2,
	Sparkles,
} from 'lucide-react';
import Link from 'next/link';

interface ActivityItem {
	kind: 'expense' | 'shopping' | 'announcement' | 'chore' | 'recurring' | 'absence' | 'audit';
	timestamp: string;
	memberName: string;
	text: string;
	detail?: string;
	amountCents?: number;
	href?: string;
}

interface ActivityFeedProps {
	items: ActivityItem[];
	emptyHref?: string;
}

function formatEuro(cents: number): string {
	return formatEuroCents(cents);
}

const kindIcon: Record<ActivityItem['kind'], typeof Receipt> = {
	expense: Receipt,
	shopping: ListChecks,
	announcement: Megaphone,
	chore: Sparkles,
	recurring: Repeat2,
	absence: CalendarOff,
	audit: History,
};

export function ActivityFeed({ items, emptyHref }: ActivityFeedProps) {
	if (items.length === 0) {
		return (
			<div className="space-y-2">
				<p className="text-sm text-[var(--text-2)]">
					Noch keine Aktivität. Lege los — die ersten Einträge erscheinen hier.
				</p>
				{emptyHref && (
					<Link
						href={emptyHref}
						className="inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Erste Aktion starten
					</Link>
				)}
			</div>
		);
	}

	const now = Date.now();

	return (
		<ol className="divide-y divide-[var(--border)]">
			{items.map((item) => {
				const Icon = kindIcon[item.kind];
				return (
					<li
						key={`${item.kind}-${item.timestamp}-${item.text}`}
						className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
					>
						<Icon
							className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-3)]"
							strokeWidth={1.75}
							aria-hidden
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2">
								{item.href ? (
									<Link
										href={item.href}
										className="-my-2 flex min-h-11 min-w-0 flex-1 items-center truncate rounded-sm text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
									>
										<ActivityText item={item} />
									</Link>
								) : (
									<p className="flex min-h-11 min-w-0 flex-1 items-center truncate text-sm">
										<ActivityText item={item} />
									</p>
								)}
								<time
									dateTime={item.timestamp}
									className="shrink-0 text-[12px] tabular-nums text-[var(--text-3)]"
								>
									{formatCompactRelativeTime(item.timestamp, now)}
								</time>
							</div>
							{item.detail && (
								<p
									className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--text-3)]"
									title={item.detail}
								>
									{item.detail}
								</p>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function ActivityText({ item }: { item: ActivityItem }) {
	// Wrap in a single block-level span so the parent `<Link className="flex">`
	// (iter 9 tap-target fix) treats this as ONE flex item. Without the
	// wrapper, the multiple inner <span>s + JSX text-node space become
	// separate anonymous flex items with zero gap — the space character
	// collapses visually and "Abu hat die WG …" renders as "Abuhat die WG …".
	return (
		<span className="truncate">
			<span className="font-medium text-[var(--text-1)]">{item.memberName}</span>{' '}
			<span className="text-[var(--text-2)]">{item.text}</span>
			{item.amountCents !== undefined && (
				<span className="ml-1.5 tabular-nums text-[var(--text-2)]">
					· {formatEuro(item.amountCents)}
				</span>
			)}
		</span>
	);
}
