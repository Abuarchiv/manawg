'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
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
import { Skeleton } from '@/components/ui/skeleton';
import { ChatTopBarLink } from '@/components/wg/ChatTopBarLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { CopyCodeButton } from '@/components/wg/dashboard/CopyCodeButton';
import { ActivitySkeleton } from '@/components/wg/dashboard/DashboardSkeletons';
import { TodayIcon } from '@/components/wg/dashboard/TodayIcon';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import type { DashboardData } from '@/core/reads/dashboard-data';
import {
	getTodayFocus,
	getTodayImportantItems,
	getTodayListItems,
} from '@/core/reads/dashboard-insights';
import {
	getDashboardAnnouncementHref,
	getDashboardEmptyActionHref,
} from '@/core/reads/dashboard-links';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	Check,
	ChevronDown,
	ChevronRight,
	ListChecks,
	Megaphone,
	Receipt,
	UsersRound,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Dynamic + ssr:false: both create-WG (NeuClient's createWg → InviteStep
// "Später" skip) and join-WG (NeuClient's joinExistingWg) land here, on the
// dashboard — the natural moment to offer push notifications once, without
// adding its JS to every /wg/[code]/* route (this page has bundle headroom;
// see the einstellungen tabs above for the same on-demand pattern). It also
// depends on browser-only APIs (Notification, localStorage) with nothing to
// server-render.
const PushPrimingPrompt = dynamic(
	() => import('@/shared/components/push-priming-prompt').then((m) => m.PushPrimingPrompt),
	{ ssr: false },
);

const REFRESH_INTERVAL_MS = 30_000;

function formatEuro(cents: number, opts?: { signed?: boolean }): string {
	return formatEuroCents(cents, 'EUR', opts);
}

function dueRelative(iso: string): { text: string; tone: 'ok' | 'soon' | 'overdue' } {
	const due = parseTimestamp(iso);
	if (due === null) return { text: 'Datum prüfen', tone: 'soon' };
	const now = Date.now();
	const diffDays = Math.round((due - now) / MS_PER_DAY);
	if (diffDays < 0)
		return {
			text: `${Math.abs(diffDays)} T. überfällig`,
			tone: 'overdue',
		};
	if (diffDays === 0) return { text: 'heute', tone: 'soon' };
	if (diffDays === 1) return { text: 'morgen', tone: 'soon' };
	if (diffDays <= 3) return { text: `in ${diffDays} T.`, tone: 'soon' };
	return { text: `in ${diffDays} T.`, tone: 'ok' };
}

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

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function WgHomePage() {
	const { wg, members, identity } = useWg();
	// Current WG occupancy for the visible member surfaces (header count, member
	// panel). Moved-out members stay in `members` for name/color resolution but
	// drop out of these lists ("aus Listen raus").
	const activeMembers = members.filter((m) => m.active);
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const dashboardRequestId = useRef(0);
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
				setError(getWgLoadErrorMessage('Dashboard', res.status, await readDashboardError(res)));
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

	const myBalance = data?.balances.find((b) => b.memberId === identity.memberId)?.balanceCents ?? 0;
	const urgentChores = useMemo(
		() =>
			data?.dueChores.filter(
				(item) => item.overdue || dueRelative(item.nextDueAt).tone === 'soon',
			) ?? [],
		[data],
	);
	const todayImportant = useMemo(
		() =>
			data
				? getTodayImportantItems({
						shareCode: wg.shareCode,
						myBalanceCents: myBalance,
						openShoppingTop: data.openShoppingTop,
						dueChores: urgentChores,
						myOpenAnnouncements: data.myOpenAnnouncements,
						dueRecurringExpenses: data.dueRecurringExpenses,
						absentMembers: data.absentMembers,
					})
				: [],
		[data, wg.shareCode, myBalance, urgentChores],
	);
	const todayFocus = useMemo(() => getTodayFocus(todayImportant), [todayImportant]);
	const todayListItems = useMemo(
		() => getTodayListItems(todayImportant, todayFocus),
		[todayImportant, todayFocus],
	);
	const isNewWg =
		data &&
		!data.setup.hasExpense &&
		!data.setup.hasShoppingItem &&
		!data.setup.hasAnnouncement &&
		data.setup.choreCount === 0;

	return (
		<>
			<PushPrimingPrompt
				code={wg.shareCode}
				memberId={identity.memberId}
				memberToken={identity.memberToken}
			/>
			<div className="flex w-full min-w-0 flex-col gap-6 px-4 py-5">
				<header className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="text-2xl font-semibold tracking-tight">Start</h1>
						<p className="break-words text-sm text-muted-foreground">
							Hallo, {identity.name}. {activeMembers.length} Mitglied
							{activeMembers.length === 1 ? '' : 'er'} in deiner WG.
						</p>
					</div>
					<ChatTopBarLink
						href={`${wgBaseHref}/chat`}
						className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'relative size-11')}
					/>
				</header>

				{error && (
					<LoadErrorBanner
						message={error}
						onRetry={() => void load()}
						busy={loading}
						retryLabel="Dashboard erneut laden"
					/>
				)}
				{loading && data && (
					<output aria-live="polite" className="sr-only">
						Dashboard wird neu geladen
					</output>
				)}

				{isNewWg && (
					<Card>
						<CardHeader>
							<CardTitle>
								<h2>Deine WG kann loslegen</h2>
							</CardTitle>
							<CardDescription>
								Noch keine Einträge. Startet mit eurer Einkaufsliste.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Empty className="p-0">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<UsersRound aria-hidden />
									</EmptyMedia>
									<EmptyTitle>{wg.name}</EmptyTitle>
									<EmptyDescription>
										{activeMembers.length < 2
											? 'Lade deine Mitbewohner ein, damit ihr gemeinsam planen könnt.'
											: 'Alle können Ausgaben, Aufgaben und Infos ergänzen.'}
									</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Link
										href={`${wgBaseHref}/einkauf`}
										className={cn(buttonVariants(), 'min-h-11 w-full')}
									>
										<ListChecks data-icon="inline-start" aria-hidden /> Einkaufsliste starten
									</Link>
									<CopyCodeButton
										code={wg.shareCode}
										wgName={wg.name}
										joiningEnabled={wg.joiningEnabled}
									/>
									{!wg.joiningEnabled && (
										<Link
											href={`${wgBaseHref}/einstellungen`}
											className={cn(buttonVariants({ variant: 'link' }), 'min-h-11')}
										>
											Einladungen verwalten
										</Link>
									)}
								</EmptyContent>
							</Empty>
						</CardContent>
					</Card>
				)}

				<Card aria-labelledby="personal-balance-heading">
					<CardHeader>
						<CardTitle>
							<h2 id="personal-balance-heading">Dein Saldo</h2>
						</CardTitle>
						<CardDescription>Dein Anteil an den erfassten WG-Ausgaben.</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{data ? (
							<>
								<p className="text-3xl font-semibold tracking-tight tabular-nums">
									{formatEuro(Math.abs(myBalance))}
								</p>
								<p className="text-sm">
									{myBalance > 0
										? 'Du bekommst Geld aus der WG zurück.'
										: myBalance < 0
											? 'Diesen Betrag schuldest du der WG.'
											: 'Du bist ausgeglichen.'}
								</p>
								<Link
									href={`${wgBaseHref}/ausgaben`}
									className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 w-full')}
								>
									<Receipt data-icon="inline-start" aria-hidden /> Beträge und Personen ansehen
								</Link>
							</>
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Dein Saldo ist gerade nicht verfügbar.
							</p>
						) : (
							<output
								aria-live="polite"
								aria-label="Saldo wird geladen"
								className="flex flex-col gap-3"
							>
								<Skeleton className="h-9 w-32" />
								<Skeleton className="h-4 w-3/4" />
							</output>
						)}
					</CardContent>
					{data && (
						<CardFooter>
							<p className="text-sm text-muted-foreground">
								WG-Ausgaben: <span className="tabular-nums">{formatEuro(data.weekSpendCents)}</span>{' '}
								in 7 Tagen ·{' '}
								<span className="tabular-nums">{formatEuro(data.monthSpendCents)}</span> in 30 Tagen
							</p>
						</CardFooter>
					)}
				</Card>

				<section aria-label="Module" className="flex flex-col gap-3">
					<Card size="sm">
						<CardHeader>
							<CardTitle>
								<h2>Module</h2>
							</CardTitle>
							<CardDescription>Direkte Wege zu den wichtigsten WG-Bereichen.</CardDescription>
						</CardHeader>
						<CardContent>
							<ItemGroup>
								<Item
									variant="outline"
									render={<Link href={`${wgBaseHref}/ausgaben`} aria-label="Ausgaben" />}
								>
									<ItemMedia variant="icon">
										<Receipt aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>Ausgaben</ItemTitle>
										<ItemDescription>
											{data
												? `${formatEuro(data.monthSpendCents)} in den letzten 30 Tagen`
												: 'Gemeinsame Ausgaben öffnen'}
										</ItemDescription>
									</ItemContent>
								</Item>
								<Item
									variant="outline"
									render={
										<Link
											href={`${wgBaseHref}/einkauf`}
											aria-label={
												data && data.openShoppingCount > 0
													? `Einkauf offen ${data.openShoppingCount}${data.openShoppingTop[0] ? ` ${data.openShoppingTop[0]}` : ''}`
													: 'Einkauf'
											}
										/>
									}
								>
									<ItemMedia variant="icon">
										<ListChecks aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>Einkauf</ItemTitle>
										<ItemDescription>
											{data ? `${data.openShoppingCount} offene Artikel` : 'Einkaufsliste öffnen'}
										</ItemDescription>
									</ItemContent>
								</Item>
								<Item
									variant="outline"
									render={<Link href={`${wgBaseHref}/putzen`} aria-label="Putzen" />}
								>
									<ItemMedia variant="icon">
										<UsersRound aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>Putzen</ItemTitle>
										<ItemDescription>
											{data ? `${data.dueChores.length} anstehende Aufgaben` : 'Putzplan öffnen'}
										</ItemDescription>
									</ItemContent>
								</Item>
								<Item
									variant="outline"
									render={<Link href={`${wgBaseHref}/pinnwand`} aria-label="Pinnwand" />}
								>
									<ItemMedia variant="icon">
										<Megaphone aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>Pinnwand</ItemTitle>
										<ItemDescription>
											{data
												? `${data.myOpenAnnouncements.length} eigene Beiträge offen`
												: 'Infos für die WG öffnen'}
										</ItemDescription>
									</ItemContent>
								</Item>
							</ItemGroup>
						</CardContent>
					</Card>
				</section>

				{data && !isNewWg && (
					<section aria-labelledby="today-heading" className="flex flex-col gap-3">
						<div className="flex items-center justify-between gap-2">
							<h2 id="today-heading" className="text-base font-semibold">
								Für dich heute
							</h2>
							<Link
								href={`${wgBaseHref}/kalender`}
								className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}
							>
								<CalendarDays data-icon="inline-start" aria-hidden /> Termine
							</Link>
						</div>
						{todayFocus ? (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-start gap-2">
										<TodayIcon kind={todayFocus.kind} />
										<h3 className="min-w-0 break-words">{todayFocus.title}</h3>
									</CardTitle>
									<CardDescription>{todayFocus.detail}</CardDescription>
								</CardHeader>
								<CardFooter className="flex-wrap justify-between gap-2">
									<Badge variant={todayFocus.tone === 'danger' ? 'destructive' : 'secondary'}>
										{todayFocus.tone === 'danger' ? 'Offen – bitte klären' : 'Als Nächstes'}
									</Badge>
									<Link href={todayFocus.href} className={cn(buttonVariants(), 'min-h-11')}>
										{todayFocus.actionLabel}
										<ChevronRight data-icon="inline-end" aria-hidden />
									</Link>
								</CardFooter>
							</Card>
						) : (
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<Check aria-hidden />
									</EmptyMedia>
									<EmptyTitle>Gerade nichts Dringendes</EmptyTitle>
									<EmptyDescription>
										Neue Aufgaben und offene Punkte erscheinen hier.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						)}
						{todayListItems.length > 0 && (
							<ItemGroup>
								{todayListItems.map((item) => (
									<Item
										key={`${item.kind}:${item.href}`}
										variant="outline"
										render={<Link href={item.href} />}
									>
										<ItemMedia variant="icon">
											<TodayIcon kind={item.kind} />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">{item.title}</ItemTitle>
											<ItemDescription>{item.detail}</ItemDescription>
										</ItemContent>
										{item.tone === 'danger' && <Badge variant="destructive">Offen</Badge>}
									</Item>
								))}
							</ItemGroup>
						)}
					</section>
				)}

				{data &&
					(data.openShoppingCount > 0 ||
						data.latestAnnouncement ||
						data.myOpenAnnouncements.length > 0) && (
						<section aria-labelledby="wg-now-heading" className="flex flex-col gap-3">
							<h2 id="wg-now-heading" className="text-base font-semibold">
								In eurer WG
							</h2>
							<ItemGroup>
								{data.openShoppingCount > 0 && (
									<Item variant="outline" render={<Link href={`${wgBaseHref}/einkauf`} />}>
										<ItemMedia variant="icon">
											<ListChecks aria-hidden />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>Einkaufsliste</ItemTitle>
											<ItemDescription>{data.openShoppingTop.join(' · ')}</ItemDescription>
										</ItemContent>
										<Badge variant="secondary">{data.openShoppingCount} offen</Badge>
									</Item>
								)}
								{data.latestAnnouncement && (
									<Item variant="outline" render={<Link href={`${wgBaseHref}/pinnwand`} />}>
										<ItemMedia variant="icon">
											<Megaphone aria-hidden />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>Neu an der Pinnwand</ItemTitle>
											<ItemDescription>
												{data.latestAnnouncement.authorName}: {data.latestAnnouncement.content}
											</ItemDescription>
										</ItemContent>
									</Item>
								)}
								{data.myOpenAnnouncements.map((item) => (
									<Item
										key={item.id}
										variant="outline"
										render={<Link href={getDashboardAnnouncementHref(wg.shareCode, item.id)} />}
									>
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">{item.content}</ItemTitle>
											<ItemDescription>Dein offener Pinnwand-Beitrag</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						</section>
					)}

				{data && data.dueChores.length > 0 && (
					<section aria-labelledby="chores-heading" className="flex flex-col gap-3">
						<div className="flex items-center justify-between gap-2">
							<h2 id="chores-heading" className="text-base font-semibold">
								Anstehende Aufgaben
							</h2>
							<Link
								href={`${wgBaseHref}/putzen`}
								className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}
							>
								Putzplan
								<ChevronRight data-icon="inline-end" aria-hidden />
							</Link>
						</div>
						<ItemGroup>
							{data.dueChores.map((chore) => {
								const due = dueRelative(chore.nextDueAt);
								return (
									<Item
										key={chore.id}
										variant="outline"
										render={
											<Link
												href={`${wgBaseHref}/putzen?highlight=${encodeURIComponent(chore.id)}`}
											/>
										}
									>
										<ItemMedia>
											<Avatar>
												<AvatarFallback>
													{chore.assignedMemberName?.slice(0, 2).toUpperCase() ?? '?'}
												</AvatarFallback>
											</Avatar>
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">{chore.title}</ItemTitle>
											<ItemDescription>
												{chore.assignedMemberName ?? 'Niemand zugewiesen'}
											</ItemDescription>
										</ItemContent>
										<Badge variant={due.tone === 'overdue' ? 'destructive' : 'secondary'}>
											{due.text}
										</Badge>
									</Item>
								);
							})}
						</ItemGroup>
					</section>
				)}

				<section aria-labelledby="activity-heading" className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-2">
						<h2 id="activity-heading" className="text-base font-semibold">
							Letzte Aktivität
						</h2>
						<Link
							href={`${wgBaseHref}/aktivitaet`}
							className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}
						>
							Ganze Chronik
							<ChevronRight data-icon="inline-end" aria-hidden />
						</Link>
					</div>
					{data ? (
						<ActivityFeed
							items={data.activity}
							emptyHref={getDashboardEmptyActionHref(wg.shareCode, 'announcement', {
								kind: 'info',
								content: 'Hallo zusammen!',
							})}
						/>
					) : error ? (
						<p className="text-sm text-muted-foreground">
							Aktivitäten konnten noch nicht geladen werden.
						</p>
					) : (
						<ActivitySkeleton />
					)}
				</section>

				{data && data.wgHealth.score < 100 && (
					<Collapsible>
						<CollapsibleTrigger
							render={
								<Button
									variant="outline"
									className="h-auto min-h-11 w-full justify-between whitespace-normal"
								/>
							}
						>
							WG-Überblick · {data.wgHealth.score}/100
							<ChevronDown data-icon="inline-end" aria-hidden />
						</CollapsibleTrigger>
						<CollapsiblePanel>
							<div className="flex flex-col gap-3 pt-3">
								<p className="text-sm text-muted-foreground">{data.wgHealth.label}</p>
								<ItemGroup>
									{data.wgHealth.items.map((item) => (
										<Item key={item.label} variant="outline" render={<Link href={item.href} />}>
											<ItemContent className="min-w-0">
												<ItemTitle>{item.label}</ItemTitle>
											</ItemContent>
											<Badge variant={item.tone === 'danger' ? 'destructive' : 'secondary'}>
												{item.value}
											</Badge>
										</Item>
									))}
								</ItemGroup>
							</div>
						</CollapsiblePanel>
					</Collapsible>
				)}
			</div>
		</>
	);
}
