'use client';

import { ChevronDown, ChevronRight, Megaphone } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardData } from '@/composition/dashboard-data';
import { getDashboardAnnouncementHref } from '@/composition/dashboard-links';
import { cn } from '@/shared/lib/cn';
import { ActivityFeed } from './ActivityFeed';

interface WgNewsSectionProps {
	shareCode: string;
	wgBaseHref: string;
	loaded: boolean;
	failed: boolean;
	latestAnnouncement: DashboardData['latestAnnouncement'] | undefined;
	/** The latest announcement is one of the member's own open requests, already in "Für dich". */
	latestIsPending: boolean;
	activityItems: DashboardData['activity'];
}

export function WgNewsSection({
	shareCode,
	wgBaseHref,
	loaded,
	failed,
	latestAnnouncement,
	latestIsPending,
	activityItems,
}: WgNewsSectionProps) {
	const reducedMotion = useReducedMotion();
	return (
		<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
			{/* Always starts collapsed: news is opened on demand. */}
			<Collapsible>
				<h2 id="wg-now-heading" className="mb-1.5">
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className="group w-full justify-between border-0 px-0 -my-1.5 leading-[inherit] font-heading text-[length:inherit] font-semibold text-foreground hover:bg-transparent active:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
							/>
						}
					>
						Neu in deiner WG
						<ChevronDown aria-hidden className="size-4 group-aria-expanded:rotate-180" />
					</CollapsibleTrigger>
				</h2>
				<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
					<div className="flex min-w-0 flex-col gap-3">
						{loaded ? (
							<div className="flex flex-col gap-2">
								{latestAnnouncement && !latestIsPending && (
									<Item
										variant="muted"
										className="gap-2 px-2"
										render={
											<Link
												href={
													latestAnnouncement.id
														? getDashboardAnnouncementHref(shareCode, latestAnnouncement.id)
														: `${wgBaseHref}/pinnwand`
												}
											/>
										}
									>
										<span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
											<Megaphone className="size-4" strokeWidth={1.5} aria-hidden />
										</span>
										<ItemContent className="min-w-0">
											<ItemTitle className="[overflow-wrap:break-word]">
												Neu an der Pinnwand
											</ItemTitle>
											<ItemDescription className="[overflow-wrap:break-word]">
												{latestAnnouncement.authorName}: {latestAnnouncement.content}
											</ItemDescription>
										</ItemContent>
									</Item>
								)}
								{activityItems.length > 0 ? (
									<div className="rounded-xl border">
										<ActivityFeed items={activityItems} inset />
									</div>
								) : !latestAnnouncement || latestIsPending ? (
									<p className="text-sm text-muted-foreground">Noch keine neuen Einträge.</p>
								) : null}
							</div>
						) : failed ? (
							<p className="text-sm text-muted-foreground">
								Neuigkeiten konnten noch nicht geladen werden.
							</p>
						) : (
							<div
								className="flex flex-col gap-2"
								aria-label="Neuigkeiten werden geladen"
								// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
								role="status"
							>
								<Skeleton className="h-16 w-full bg-foreground/[0.07]" />
								<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
								<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
							</div>
						)}
						<Link
							href={`${wgBaseHref}/aktivitaet`}
							className={cn(
								buttonVariants({ variant: 'ghost' }),
								'min-w-0 max-w-full self-end whitespace-normal px-0 text-meta text-muted-foreground leading-snug',
							)}
						>
							Gesamte Aktivität <ChevronRight data-icon="inline-end" aria-hidden />
						</Link>
					</div>
				</CollapsiblePanel>
			</Collapsible>
		</section>
	);
}
