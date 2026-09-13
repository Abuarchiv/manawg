'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { StartWelcome } from '@/components/wg/dashboard/StartWelcome';
import { TodayIcon } from '@/components/wg/dashboard/TodayIcon';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import type { DashboardData } from '@/core/reads/dashboard-data';
import {
	getTodayFocus,
	getTodayImportantItems,
	getTodayListItems,
} from '@/core/reads/dashboard-insights';
import { getDashboardAnnouncementHref } from '@/core/reads/dashboard-links';
import { formatEuroCents } from '@/core/utils/money';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import { ChevronDown, ChevronRight, Megaphone, Receipt } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PushPrimingPrompt = dynamic(
	() => import('@/shared/components/push-priming-prompt').then((m) => m.PushPrimingPrompt),
	{ ssr: false },
);

const REFRESH_INTERVAL_MS = 30_000;

type PendingAnnouncement = DashboardData['myOpenAnnouncements'][number];

async function readDashboardError(response: Response): Promise<string | null> {
	try {
		const body = (await response.clone().json()) as { code?: unknown; error?: unknown };
		if (typeof body.code === 'string') return body.code;
		if (typeof body.error === 'string') return body.error;
	} catch {
		return null;
	}
	return null;
}

function samePendingAnnouncement(
	announcement: NonNullable<DashboardData['latestAnnouncement']>,
	pending: PendingAnnouncement,
	currentMemberName: string,
): boolean {
	if (announcement.id && announcement.id === pending.id) return true;
	return (
		!announcement.id &&
		announcement.authorName === currentMemberName &&
		announcement.content === pending.content
	);
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function WgHomePage() {
	const { wg, identity } = useWg();
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [todayMoreOpen, setTodayMoreOpen] = useState(false);
	const dashboardRequestId = useRef(0);
	const reducedMotion = useReducedMotion();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;

	const load = useCallback(async (): Promise<void> => {
		const requestId = dashboardRequestId.current + 1;
		dashboardRequestId.current = requestId;
		setLoading(true);
		try {
			const res = await fetch(`/api/wg/${encodedShareCode}/dashboard`, {
				cache: 'no-store',
				headers: { 'x-manawg-member-id': identity.memberId },
			});
			if (requestId !== dashboardRequestId.current) return;
			if (!res.ok) {
				const responseError = await readDashboardError(res);
				if (requestId !== dashboardRequestId.current) return;
				setError(getWgLoadErrorMessage('Dashboard', res.status, responseError));
				return;
			}
			const json = (await res.json()) as DashboardData;
			if (requestId !== dashboardRequestId.current) return;
			setData(json);
			setError(null);
		} catch {
			if (requestId !== dashboardRequestId.current) return;
			setError(getWgLoadErrorMessage('Dashboard', 0, 'Netzwerkfehler'));
		} finally {
			if (requestId === dashboardRequestId.current) setLoading(false);
		}
	}, [encodedShareCode, identity.memberId]);

	useEffect(() => {
		void load();
	}, [load]);
	useVisibilityPausedInterval(() => void load(), REFRESH_INTERVAL_MS);

	const myBalance =
		data?.balances.find((balance) => balance.memberId === identity.memberId)?.balanceCents ?? 0;
	const todayImportant = useMemo(
		() =>
			data
				? getTodayImportantItems({
						shareCode: wg.shareCode,
						currentMemberId: identity.memberId,
						openShoppingCount: data.openShoppingCount,
						openShoppingTop: data.openShoppingTop,
						dueChores: data.dueChores,
						myOpenAnnouncements: data.myOpenAnnouncements,
						dueRecurringExpenses: data.dueRecurringExpenses,
						absentMembers: data.absentMembers,
					})
				: [],
		[data, identity.memberId, wg.shareCode],
	);
	const todayFocus = useMemo(() => getTodayFocus(todayImportant), [todayImportant]);
	const todayRemainder = useMemo(
		() => getTodayListItems(todayImportant, todayFocus),
		[todayImportant, todayFocus],
	);
	const todaySecondary = todayRemainder.slice(0, 2);
	const todayMore = todayRemainder.slice(2);
	const latestAnnouncement = data?.latestAnnouncement;
	const pendingAnnouncements = data?.myOpenAnnouncements ?? [];
	const latestIsPending = Boolean(
		latestAnnouncement &&
			pendingAnnouncements.some((item) =>
				samePendingAnnouncement(latestAnnouncement, item, identity.name),
			),
	);
	const activityItems = useMemo(() => {
		if (!data) return [];
		const pendingHrefs = new Set(todayImportant.map((item) => item.href));
		return data.activity
			.filter((item) => !item.href || !pendingHrefs.has(item.href))
			.filter((item) => {
				if (!latestAnnouncement || item.kind !== 'announcement') return true;
				if (latestAnnouncement.id) {
					return item.href !== getDashboardAnnouncementHref(wg.shareCode, latestAnnouncement.id);
				}
				return (
					item.text !== latestAnnouncement.content ||
					item.memberName !== latestAnnouncement.authorName
				);
			})
			.slice(0, 3);
	}, [data, latestAnnouncement, todayImportant, wg.shareCode]);
	const isNewWg = Boolean(
		data &&
			!data.setup.hasExpense &&
			!data.setup.hasShoppingItem &&
			!data.setup.hasAnnouncement &&
			data.setup.choreCount === 0 &&
			todayImportant.length === 0,
	);

	return (
		<>
			<div
				data-home-content
				className="mx-auto grid w-full max-w-[var(--app-frame-width)] min-w-0 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12"
			>
				{error && (
					<div className="lg:col-span-12">
						<LoadErrorBanner
							message={data ? `${error} Die angezeigten Daten können veraltet sein.` : error}
							onRetry={() => void load()}
							busy={loading}
							retryLabel="Dashboard erneut laden"
						/>
					</div>
				)}
				{loading && data && (
					<output aria-live="polite" className="sr-only">
						Dashboard wird neu geladen
					</output>
				)}

				{!isNewWg && (
					<section
						aria-labelledby="today-heading"
						className="flex min-w-0 flex-col gap-3 lg:col-span-8"
					>
						<h2 id="today-heading" className="text-sm font-medium text-muted-foreground">
							Heute wichtig
						</h2>
						{data ? (
							todayFocus ? (
								<Card>
									<CardContent className="flex flex-wrap items-center gap-4">
										<div className="min-w-36 flex-1">
											<CardTitle className="flex items-start gap-2 font-semibold">
												<TodayIcon kind={todayFocus.kind} />
												<h3 className="min-w-0 break-words">{todayFocus.title}</h3>
											</CardTitle>
											<p className="text-xs font-medium text-muted-foreground">
												{todayFocus.isPersonal ? 'Für dich' : 'Für eure WG'}
											</p>
											<p
												className={cn(
													'text-sm text-muted-foreground',
													todayFocus.kind === 'recurring' && 'font-mono tabular-nums',
												)}
											>
												{todayFocus.detail}
											</p>
										</div>
										<Link
											href={todayFocus.href}
											aria-label={todayFocus.actionLabel}
											className={cn(
												buttonVariants({ size: 'sm', variant: 'secondary' }),
												'ml-auto min-h-11 shrink-0',
											)}
										>
											<span aria-hidden className="sm:hidden">
												{todayFocus.kind === 'recurring' ? 'Prüfen' : 'Öffnen'}
											</span>
											<span aria-hidden className="hidden sm:inline">
												{todayFocus.actionLabel}
											</span>
											<ChevronRight data-icon="inline-end" aria-hidden />
										</Link>
									</CardContent>
								</Card>
							) : (
								<p className="text-sm text-muted-foreground">Gerade gibt es nichts Dringendes.</p>
							)
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Heute wichtige Einträge konnten nicht geladen werden.
							</p>
						) : (
							<Card aria-label="Heute wichtig wird geladen">
								<CardContent className="flex flex-col gap-3">
									<Skeleton className="h-5 w-2/3" />
									<Skeleton className="h-4 w-1/2" />
									<Skeleton className="h-11 w-32 self-end" />
								</CardContent>
							</Card>
						)}
						{data && todaySecondary.length > 0 && (
							<ItemGroup className="gap-0 divide-y divide-border/60">
								{todaySecondary.map((item) => (
									<Item
										key={`${item.kind}:${item.href}`}
										className="rounded-none px-0"
										render={<Link href={item.href} />}
									>
										<ItemMedia variant="icon">
											<TodayIcon kind={item.kind} />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">{item.title}</ItemTitle>
											<ItemDescription
												className={item.kind === 'recurring' ? 'font-mono tabular-nums' : undefined}
											>
												{item.detail}
											</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						)}
						{data && todayMore.length > 0 && (
							<Collapsible open={todayMoreOpen} onOpenChange={setTodayMoreOpen}>
								<CollapsibleTrigger
									render={<Button variant="ghost" className="min-h-11 w-full justify-between" />}
								>
									<span>
										{todayMoreOpen ? 'Weniger anzeigen' : `Weitere anzeigen (${todayMore.length})`}
									</span>
									<ChevronDown data-icon="inline-end" aria-hidden />
								</CollapsibleTrigger>
								<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
									<div className="flex flex-col gap-3 pt-1">
										<ItemGroup>
											{todayMore.map((item) => (
												<Item key={`${item.kind}:${item.href}`} render={<Link href={item.href} />}>
													<ItemMedia variant="icon">
														<TodayIcon kind={item.kind} />
													</ItemMedia>
													<ItemContent className="min-w-0">
														<ItemTitle className="line-clamp-none break-words">
															{item.title}
														</ItemTitle>
														<ItemDescription>{item.detail}</ItemDescription>
													</ItemContent>
												</Item>
											))}
										</ItemGroup>
									</div>
								</CollapsiblePanel>
							</Collapsible>
						)}
					</section>
				)}

				<div className="flex min-w-0 flex-col gap-6 lg:col-span-4">
					{isNewWg && <StartWelcome />}

					<section aria-labelledby="balance-heading" className="flex min-w-0 flex-col gap-3">
						<h2 id="balance-heading" className="text-sm font-medium text-muted-foreground">
							Dein Saldo
						</h2>
						{data ? (
							<ItemGroup>
								<Item variant="muted" render={<Link href={`${wgBaseHref}/ausgaben`} />}>
									<ItemMedia variant="icon">
										<Receipt aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle
											className={cn(
												'font-mono tabular-nums',
												myBalance > 0 && 'text-settled',
												myBalance < 0 && 'text-destructive',
											)}
										>
											{formatEuroCents(myBalance, 'EUR', { signed: true })}
										</ItemTitle>
										<ItemDescription>
											{myBalance > 0
												? 'Du bekommst Geld zurück.'
												: myBalance < 0
													? 'Du schuldest der WG Geld.'
													: 'Du bist ausgeglichen.'}
										</ItemDescription>
									</ItemContent>
									<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
								</Item>
							</ItemGroup>
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Dein Saldo ist gerade nicht verfügbar.
							</p>
						) : (
							<Item variant="muted" aria-label="Saldo wird geladen">
								<ItemContent className="gap-2">
									<Skeleton className="h-4 w-24" />
									<Skeleton className="h-4 w-40" />
								</ItemContent>
							</Item>
						)}
					</section>

					<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
						<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
							<h2 id="wg-now-heading" className="text-sm font-medium text-muted-foreground">
								Neu in deiner WG
							</h2>
							<Link
								href={`${wgBaseHref}/aktivitaet`}
								className={cn(
									buttonVariants({ variant: 'ghost' }),
									'min-h-11 min-w-0 max-w-full shrink whitespace-normal px-0 text-xs text-muted-foreground text-right leading-snug',
								)}
							>
								Ganze Chronik <ChevronRight data-icon="inline-end" aria-hidden />
							</Link>
						</div>
						{data ? (
							<div className="flex flex-col gap-2">
								{latestAnnouncement && !latestIsPending && (
									<Item
										variant="muted"
										render={
											<Link
												href={
													latestAnnouncement.id
														? getDashboardAnnouncementHref(wg.shareCode, latestAnnouncement.id)
														: `${wgBaseHref}/pinnwand`
												}
											/>
										}
									>
										<ItemMedia variant="icon">
											<Megaphone aria-hidden />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>Neu an der Pinnwand</ItemTitle>
											<ItemDescription>
												{latestAnnouncement.authorName}: {latestAnnouncement.content}
											</ItemDescription>
										</ItemContent>
									</Item>
								)}
								{activityItems.length > 0 ? (
									<ActivityFeed items={activityItems} compact />
								) : !latestAnnouncement || latestIsPending ? (
									<p className="text-sm text-muted-foreground">Noch keine neuen Einträge.</p>
								) : null}
							</div>
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Neuigkeiten konnten noch nicht geladen werden.
							</p>
						) : (
							<div className="flex flex-col gap-2" aria-label="Neuigkeiten werden geladen">
								<Skeleton className="h-16 w-full" />
								<Skeleton className="h-11 w-full" />
								<Skeleton className="h-11 w-full" />
							</div>
						)}
					</section>
				</div>
				<div className="lg:col-span-12">
					<PushPrimingPrompt
						code={wg.shareCode}
						memberId={identity.memberId}
						memberToken={identity.memberToken}
					/>
				</div>
			</div>
		</>
	);
}
