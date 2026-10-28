'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { navText } from '@/components/app/nav-text';
import { getWgSection } from '@/components/app/navigation';
import { segmentCountStatus } from '@/components/wg/segment-count-status';
import type { CountHint, SegmentCountState } from '@/components/wg/use-wg-counts';
import { useChatUnreadCount, useDashboardCounts } from '@/components/wg/use-wg-counts';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';

interface SubNavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	count?: number | undefined;
	countHint?: CountHint | undefined;
	countState?: SegmentCountState | undefined;
	countOverflow?: boolean | undefined;
	countExact?: number | undefined;
}

interface SubNavProps {
	label?: string;
	items?: SubNavItem[];
	className?: string;
	liveCount?: number | undefined;
}

export function SubNav({ label, items = [], className, liveCount }: SubNavProps) {
	const pathname = usePathname()?.replace(/\/+$/, '') ?? '';
	const section = getWgSection(pathname);

	return section ? (
		<WgSubNav
			section={section}
			pathname={pathname}
			label={label}
			className={className}
			liveCount={liveCount}
		/>
	) : (
		<SegmentList links={items} pathname={pathname} label={label} className={className} />
	);
}

function WgSubNav(props: {
	section: NonNullable<ReturnType<typeof getWgSection>>;
	pathname: string;
	label: string | undefined;
	className: string | undefined;
	liveCount: number | undefined;
}) {
	const dashboardCounted = props.section.pages.some((page) =>
		['shopping', 'chores', 'recurring'].includes(page.slug),
	);
	return dashboardCounted ? <DashboardSubNav {...props} /> : <ChatSubNav {...props} />;
}

function DashboardSubNav({
	section,
	pathname,
	label,
	className,
	liveCount,
}: {
	section: NonNullable<ReturnType<typeof getWgSection>>;
	pathname: string;
	label: string | undefined;
	className: string | undefined;
	liveCount: number | undefined;
}) {
	const counts = useDashboardCounts();
	const links = section.pages.map((page) => {
		const href = `${section.baseHref}/${page.slug}`;
		const count = counts[page.slug];
		const isCurrent = pathname === href;
		const useLiveCount = isCurrent && liveCount !== undefined;
		return {
			href,
			label: page.label,
			icon: page.icon,
			count: useLiveCount ? liveCount : count?.count,
			countHint: count?.hint,
			countState: useLiveCount ? 'ready' : count?.state,
			countOverflow: count?.overflow,
		};
	});

	return (
		<SegmentList
			links={links}
			pathname={pathname}
			label={label ?? section.label}
			className={className}
		/>
	);
}

function ChatSubNav({
	section,
	pathname,
	label,
	className,
}: {
	section: NonNullable<ReturnType<typeof getWgSection>>;
	pathname: string;
	label: string | undefined;
	className: string | undefined;
}) {
	const chat = useChatUnreadCount();
	const state: SegmentCountState =
		chat.data !== undefined
			? chat.error
				? 'stale'
				: 'ready'
			: chat.error
				? 'unavailable'
				: 'loading';
	const links = section.pages.map((page) => ({
		href: `${section.baseHref}/${page.slug}`,
		label: page.label,
		icon: page.icon,
		...(page.slug === 'chat'
			? {
					count: chat.data?.count,
					countHint: 'unread' as const,
					countState: state,
					countOverflow: chat.data?.overflow,
					countExact: chat.data?.exactCount,
				}
			: {}),
	}));
	return (
		<SegmentList
			links={links}
			pathname={pathname}
			label={label ?? section.label}
			className={className}
		/>
	);
}

function SegmentList({
	links,
	pathname,
	label,
	className,
}: {
	links: SubNavItem[];
	pathname: string;
	label?: string | undefined;
	className?: string | undefined;
}) {
	const t = useTranslations('shell.subNav');
	const message = useMessage();
	if (links.length < 2) return null;
	return (
		<nav
			aria-label={navText(label ?? t('fallbackLabel'), message)}
			className={cn('min-w-0', className)}
		>
			<ul className="grid auto-cols-[minmax(max-content,1fr)] grid-flow-col gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none]">
				{links.map(
					({ href, label: itemLabel, count, countHint, countState, countOverflow, countExact }) => {
						const target = new URL(href, 'https://manawg.invalid').pathname.replace(/\/+$/, '');
						const current = pathname === target;
						const active = current || pathname.startsWith(`${target}/`);
						const status = segmentCountStatus({
							count,
							hint: countHint,
							state: countState,
							overflow: countOverflow,
							exactCount: countExact,
						});
						const marker =
							countState === 'loading'
								? '…'
								: countState === 'unavailable'
									? '!'
									: countState === 'stale'
										? '~'
										: null;
						const showCount = typeof count === 'number' && count > 0;
						return (
							<li key={href} className="min-w-0">
								<Link
									href={href}
									prefetch
									aria-current={active ? (current ? 'page' : 'location') : undefined}
									aria-label={
										status
											? message({
													key: 'shell.counter.labelled',
													values: { label: navText(itemLabel, message), status },
												})
											: undefined
									}
									className={cn(
										"relative flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-meta font-medium after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
										active
											? 'bg-background text-foreground ring-1 ring-border dark:bg-foreground/15 dark:ring-foreground/25'
											: 'text-foreground/75 hover:text-foreground active:bg-foreground/5',
									)}
								>
									<span className="truncate">{navText(itemLabel, message)}</span>
									{showCount && (
										<span
											aria-hidden
											className="text-meta leading-none font-medium tabular-nums text-muted-foreground"
										>
											{marker}
											{countOverflow || count > 99 || (countExact ?? 0) > 99 ? '99+' : count}
										</span>
									)}
									{!showCount && marker && (
										<span
											aria-hidden
											className="text-meta leading-none font-medium text-muted-foreground"
										>
											{marker}
										</span>
									)}
								</Link>
							</li>
						);
					},
				)}
			</ul>
		</nav>
	);
}
