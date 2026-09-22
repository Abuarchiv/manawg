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
import {
	ChevronDown,
	ChevronRight,
	Megaphone,
	Receipt,
	Search,
	ShoppingBasket,
	SprayCan,
} from 'lucide-react';
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
	const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
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
			setUpdatedAt(new Date());
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

	const myBalances =
		data?.balances.filter((balance) => balance.memberId === identity.memberId) ?? [];
	const primaryBalance =
		myBalances.find((balance) => balance.currency === 'EUR') ?? myBalances[0] ?? null;
	const myBalance = primaryBalance?.balanceCents ?? 0;
	const myBalanceText =
		myBalances.length > 0
			? myBalances
					.filter((balance) => balance.balanceCents !== 0 || myBalances.length === 1)
					.map((balance) =>
						formatEuroCents(balance.balanceCents, balance.currency, { signed: true }),
					)
					.join(' · ')
			: formatEuroCents(0, 'EUR', { signed: true });
	const myNextChore = data?.dueChores
		.filter((chore) => chore.assignedMemberId === identity.memberId)
		.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt))[0];
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
			.slice(0, latestAnnouncement ? 2 : 3);
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
				className="mx-auto grid w-full max-w-[var(--app-frame-width)] min-w-0 grid-cols-1 gap-6 px-4 py-6 md:grid-cols-12"
			>
				<header className="flex min-w-0 flex-col gap-1 md:col-span-12">
					<h1 className="font-heading text-2xl font-semibold tracking-tight">Deine WG im Blick</h1>
					<p className="text-sm text-muted-foreground">
						Was heute für dich und eure WG wichtig ist.
					</p>
					{updatedAt && (
						<p className="text-xs text-muted-foreground">
							{new Intl.DateTimeFormat('de-DE', {
								weekday: 'long',
								day: 'numeric',
								month: 'long',
								timeZone: 'Europe/Berlin',
							}).format(updatedAt)}{' '}
							· Stand{' '}
							{new Intl.DateTimeFormat('de-DE', {
								hour: '2-digit',
								minute: '2-digit',
								timeZone: 'Europe/Berlin',
							}).format(updatedAt)}{' '}
							Uhr
						</p>
					)}
				</header>
				{isNewWg && (
					<div className="md:col-span-12">
						<StartWelcome />
					</div>
				)}
				{error && (
					<div className="md:col-span-12">
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
						className="flex min-w-0 flex-col gap-3 md:col-span-12"
					>
						<h2 id="today-heading" className="text-sm font-medium text-muted-foreground">
							Heute wichtig
						</h2>
						{data ? (
							todayFocus ? (
								<Card>
									<CardContent className="flex flex-wrap items-center gap-4">
										<div className="min-w-0 flex-1">
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
											<span aria-hidden className="inline">
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

				<div className="flex min-w-0 flex-col gap-6 md:col-span-12">
					<div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
						<section
							aria-labelledby="balance-heading"
							className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
						>
							<h2 id="balance-heading" className="text-sm font-medium text-muted-foreground">
								Ausgaben
							</h2>
							{data ? (
								<ItemGroup>
									<Item
										variant="muted"
										render={<Link href={`${wgBaseHref}/ausgaben`} />}
										className="flex-wrap sm:flex-nowrap"
									>
										<ItemMedia variant="icon" className="order-1 sm:order-none">
											<Receipt aria-hidden />
										</ItemMedia>
										<ItemContent className="order-3 basis-full min-w-0 sm:order-none sm:basis-auto">
											<ItemTitle
												className={cn(
													'font-mono tabular-nums',
													myBalance > 0 && 'text-settled',
													myBalance < 0 && 'text-destructive',
												)}
											>
												{myBalanceText}
											</ItemTitle>
											<ItemDescription className="line-clamp-none break-normal">
												{myBalances.some((balance) => balance.balanceCents > 0) &&
												myBalances.some((balance) => balance.balanceCents < 0)
													? 'Offene Salden in mehreren Währungen.'
													: myBalance > 0
														? 'Du bekommst Geld zurück.'
														: myBalance < 0
															? 'Du schuldest der WG Geld.'
															: 'Du bist ausgeglichen.'}
											</ItemDescription>
										</ItemContent>
										<ChevronRight
											className="order-2 ml-auto size-4 text-muted-foreground sm:order-none"
											aria-hidden
										/>
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
							<Link
								href={`${wgBaseHref}/ausgaben?new=1`}
								className={cn(
									buttonVariants({ variant: 'secondary' }),
									'mt-auto min-h-11 whitespace-normal break-normal',
								)}
							>
								<span className="min-w-0 break-normal whitespace-normal">Ausgabe hinzufügen</span>
							</Link>
						</section>

						<section
							aria-labelledby="chores-heading"
							className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
						>
							<h2
								id="chores-heading"
								className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
							>
								<SprayCan className="size-4" aria-hidden />
								Putzplan
							</h2>
							{data ? (
								<div className="flex flex-col gap-1">
									<p className="font-medium break-words">
										{myNextChore ? myNextChore.title : 'Keine Aufgabe für dich geplant'}
									</p>
									<p className="text-sm text-muted-foreground">
										{myNextChore
											? `Du bist dran · ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'Europe/Berlin' }).format(new Date(myNextChore.nextDueAt))}`
											: data.setup.choreCount === 0
												? 'Legt euren ersten Putzdienst an.'
												: 'Den Plan für eure WG findest du hier.'}
									</p>
								</div>
							) : error ? (
								<p className="text-sm text-muted-foreground">
									Putzplan ist gerade nicht verfügbar.
								</p>
							) : (
								<div aria-label="Putzplan wird geladen">
									<Skeleton className="h-5 w-3/4" />
									<Skeleton className="mt-2 h-4 w-1/2" />
								</div>
							)}
							<Link
								href={`${wgBaseHref}/putzen`}
								className={cn(
									buttonVariants({ variant: 'secondary' }),
									'mt-auto min-h-11 break-normal',
								)}
							>
								<span className="min-w-0 break-normal whitespace-normal">Putzplan öffnen</span>
							</Link>
						</section>
						<section
							aria-labelledby="shopping-heading"
							className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
						>
							<h2
								id="shopping-heading"
								className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
							>
								<ShoppingBasket className="size-4" aria-hidden />
								Einkauf
							</h2>
							{data ? (
								<div className="flex flex-col gap-1">
									<Link
										href={`${wgBaseHref}/einkauf`}
										className="font-medium underline-offset-4 hover:underline"
									>
										{data.openShoppingCount === 0
											? 'Alles besorgt'
											: `${data.openShoppingCount} ${data.openShoppingCount === 1 ? 'offener Artikel' : 'offene Artikel'}`}
									</Link>
									<p className="break-words text-sm text-muted-foreground">
										{data.openShoppingCount > 0
											? data.openShoppingTop.slice(0, 3).join(', ') ||
												'Eure Einkaufsliste ist bereit.'
											: 'Fehlt etwas? Trag es direkt ein.'}
									</p>
								</div>
							) : error ? (
								<p className="text-sm text-muted-foreground">
									Einkaufsliste ist gerade nicht verfügbar.
								</p>
							) : (
								<div aria-label="Einkauf wird geladen">
									<Skeleton className="h-5 w-3/4" />
									<Skeleton className="mt-2 h-4 w-1/2" />
								</div>
							)}
							<Link
								href={`${wgBaseHref}/einkauf#shopping-name`}
								className={cn(
									buttonVariants({ variant: 'secondary' }),
									'mt-auto min-h-11 break-normal',
								)}
							>
								<span className="min-w-0 break-normal whitespace-normal">Artikel hinzufügen</span>
							</Link>
						</section>
					</div>
					<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
						<Collapsible defaultOpen={false}>
							<h2 id="wg-now-heading">
								<CollapsibleTrigger
									render={
										<Button
											variant="ghost"
											className="group min-h-11 w-full justify-between px-0 text-muted-foreground"
										/>
									}
								>
									Neu in deiner WG
									<ChevronDown aria-hidden className="size-4 group-aria-expanded:rotate-180" />
								</CollapsibleTrigger>
							</h2>
							<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
								<div className="flex min-w-0 flex-col gap-3">
									<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
										<div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
											{/* The header keeps no search control (AGENTS.md). Search stays
								    reachable from Start, as the WG shell documents. */}
											<Link
												href={`${wgBaseHref}/suche`}
												className={cn(
													buttonVariants({ variant: 'ghost' }),
													'min-h-11 min-w-0 max-w-full shrink whitespace-normal px-0 text-[13px] text-muted-foreground leading-snug',
												)}
											>
												<Search data-icon="inline-start" aria-hidden />
												WG durchsuchen
											</Link>
											<Link
												href={`${wgBaseHref}/aktivitaet`}
												className={cn(
													buttonVariants({ variant: 'ghost' }),
													'min-h-11 min-w-0 max-w-full shrink whitespace-normal px-0 text-[13px] text-muted-foreground text-right leading-snug',
												)}
											>
												Ganze Chronik <ChevronRight data-icon="inline-end" aria-hidden />
											</Link>
										</div>
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
																	? getDashboardAnnouncementHref(
																			wg.shareCode,
																			latestAnnouncement.id,
																		)
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
								</div>
							</CollapsiblePanel>
						</Collapsible>
					</section>
				</div>
				<div className="md:col-span-12">
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
