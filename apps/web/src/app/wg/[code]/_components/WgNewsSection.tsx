'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardData } from '@/composition/dashboard-data';
import { cn } from '@/shared/lib/cn';
import { ActivityFeed } from './ActivityFeed';

interface WgNewsSectionProps {
	wgBaseHref: string;
	loaded: boolean;
	failed: boolean;
	/** Others' entries since this member's last visit, newest first. */
	newItems: DashboardData['activity'];
	/** False until the last-visit marker was read; the heading stays neutral until then. */
	lastSeenKnown: boolean;
}

const MAX_NEW_ROWS = 5;

export function WgNewsSection({
	wgBaseHref,
	loaded,
	failed,
	newItems,
	lastSeenKnown,
}: WgNewsSectionProps) {
	const t = useTranslations('home.news');
	const reducedMotion = useReducedMotion();
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const ready = loaded && lastSeenKnown;
	const hasNew = ready && newItems.length > 0;
	// New entries open the section on their own; a choice made by hand wins.
	const open = userOpen ?? hasNew;
	const heading = !ready
		? t('heading')
		: hasNew
			? t('headingNew', {
					count: newItems.length > MAX_NEW_ROWS ? `${MAX_NEW_ROWS}+` : String(newItems.length),
				})
			: t('headingNone');

	return (
		<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
			<Collapsible open={open} onOpenChange={setUserOpen}>
				<h2 id="wg-now-heading" className="mb-1.5">
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className={cn(
									'group w-full justify-between border-0 px-0 -my-1.5 leading-[inherit] font-heading text-[length:inherit] font-semibold text-foreground hover:bg-transparent active:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent [@media(any-hover:hover)]:focus-visible:ring-ring',
									ready &&
										!hasNew &&
										'font-normal text-muted-foreground aria-expanded:text-muted-foreground',
								)}
							/>
						}
					>
						{heading}
						<ChevronDown aria-hidden className="size-4 group-aria-expanded:rotate-180" />
					</CollapsibleTrigger>
				</h2>
				<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
					<div className="flex min-w-0 flex-col gap-3">
						{hasNew ? (
							<div className="rounded-xl border">
								<ActivityFeed items={newItems.slice(0, MAX_NEW_ROWS)} inset actorFirst />
							</div>
						) : loaded ? null : failed ? (
							<p className="text-sm text-muted-foreground">{t('failed')}</p>
						) : (
							<div className="flex flex-col gap-2" aria-label={t('loading')} role="status">
								<Skeleton className="h-16 w-full bg-foreground/[0.07]" />
								<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
								<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
							</div>
						)}
						<Link
							href={`${wgBaseHref}/activity`}
							className={cn(
								buttonVariants({ variant: 'ghost' }),
								'min-w-0 max-w-full self-end whitespace-normal px-0 text-meta text-muted-foreground leading-snug',
							)}
						>
							{t('allActivity')} <ChevronRight data-icon="inline-end" aria-hidden />
						</Link>
					</div>
				</CollapsiblePanel>
			</Collapsible>
		</section>
	);
}
