import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { activityItemKey } from '@/core/reads/activity';
import { formatEuroCents } from '@/core/utils/money';
import { formatCompactRelativeTime } from '@/core/utils/time';
import { cn } from '@/shared/lib/cn';
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
	id?: string;
	kind: 'expense' | 'shopping' | 'announcement' | 'chore' | 'recurring' | 'absence' | 'audit';
	timestamp: string;
	memberName: string;
	text: string;
	detail?: string;
	amountCents?: number;
	currency?: string;
	href?: string;
}

interface ActivityFeedProps {
	items: ActivityItem[];
	emptyHref?: string;
	compact?: boolean;
}

function formatEuro(cents: number, currency?: string): string {
	return formatEuroCents(cents, currency ?? 'EUR');
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

export function ActivityFeed({ items, emptyHref, compact = false }: ActivityFeedProps) {
	if (items.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Noch keine Aktivität.</EmptyTitle>
					<EmptyDescription>Lege los — die ersten Einträge erscheinen hier.</EmptyDescription>
				</EmptyHeader>
				{emptyHref && (
					<EmptyContent>
						<Link
							href={emptyHref}
							className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
						>
							Erste Aktion starten
						</Link>
					</EmptyContent>
				)}
			</Empty>
		);
	}

	const now = Date.now();
	if (compact) {
		return (
			<ul aria-label="Aktivitätsverlauf" className="divide-y divide-border/60">
				{items.map((item, index) => {
					const Icon = kindIcon[item.kind];
					const content = (
						<>
							<Icon
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								strokeWidth={1.5}
								aria-hidden
							/>
							<div className="min-w-0 flex-1">
								<p className="text-sm leading-5">
									<ActivityText item={item} />
								</p>
								<time dateTime={item.timestamp} className="text-[13px] text-muted-foreground">
									{formatCompactRelativeTime(item.timestamp, now)}
								</time>
							</div>
							{item.amountCents !== undefined && (
								<span className="shrink-0 font-mono text-xs tabular-nums">
									{formatEuro(item.amountCents, item.currency)}
								</span>
							)}
						</>
					);
					return (
						<li key={activityItemKey(item, index)}>
							{item.href ? (
								<Link
									href={item.href}
									className="flex min-h-14 items-start gap-3 py-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring active:bg-muted"
								>
									{content}
								</Link>
							) : (
								<div className="flex min-h-14 items-start gap-3 py-3">{content}</div>
							)}
						</li>
					);
				})}
			</ul>
		);
	}

	return (
		<ItemGroup aria-label="Aktivitätsverlauf">
			{items.map((item, index) => {
				const Icon = kindIcon[item.kind];
				const content = (
					<>
						<ItemMedia variant="icon" className="mt-0.5">
							<Icon strokeWidth={1.75} aria-hidden />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle className="w-full line-clamp-none">
								<span className="flex min-w-0 flex-1 flex-col gap-1">
									<ActivityText item={item} />
									<time
										dateTime={item.timestamp}
										className="shrink-0 text-xs text-muted-foreground tabular-nums"
									>
										{formatCompactRelativeTime(item.timestamp, now)}
									</time>
								</span>
							</ItemTitle>
							<div className="flex flex-wrap items-center gap-2">
								{item.detail && (
									<ItemDescription className="line-clamp-2" title={item.detail}>
										{item.detail}
									</ItemDescription>
								)}
								{item.amountCents !== undefined && (
									<Badge variant="secondary" className="shrink-0 tabular-nums">
										{formatEuro(item.amountCents, item.currency)}
									</Badge>
								)}
							</div>
						</ItemContent>
					</>
				);
				if (item.href) {
					return (
						<Item
							key={activityItemKey(item, index)}
							variant={compact ? 'default' : 'outline'}
							render={<Link href={item.href} aria-label={`${item.memberName} ${item.text}`} />}
							className={cn('min-h-11', compact && 'rounded-none px-0')}
						>
							{content}
						</Item>
					);
				}
				return (
					<Item
						key={activityItemKey(item, index)}
						variant={compact ? 'default' : 'outline'}
						className={cn(compact && 'rounded-none px-0')}
					>
						{content}
					</Item>
				);
			})}
		</ItemGroup>
	);
}

function ActivityText({ item }: { item: ActivityItem }) {
	// Wrap in a single block-level span so the parent flex container treats this
	// as ONE flex item. Without the wrapper, the multiple inner <span>s + JSX
	// text-node space become separate anonymous flex items with zero gap — the
	// space character collapses visually and "Abu hat die WG …" renders as
	// "Abuhat die WG …". Amount is shown as a Badge beside the detail, not here.
	return (
		<span className="min-w-0 flex-1 break-words">
			<span className="font-medium text-foreground">{item.memberName}</span>{' '}
			<span className="text-muted-foreground">{item.text}</span>
		</span>
	);
}
