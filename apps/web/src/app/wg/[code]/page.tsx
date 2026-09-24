'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { StartWelcome } from '@/components/wg/dashboard/StartWelcome';
import { TodayIcon } from '@/components/wg/dashboard/TodayIcon';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import type { DashboardData } from '@/core/reads/dashboard-data';
import { type TodayImportantItem, getTodayImportantItems } from '@/core/reads/dashboard-insights';
import { getDashboardAnnouncementHref } from '@/core/reads/dashboard-links';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY, parseTimestamp, parseValidDate } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleCheck,
	Loader2,
	type LucideIcon,
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
const TODAY_VISIBLE = 4;

interface StartEvent {
	id: string;
	title: string;
	startsAt: string;
	allDay: boolean;
}

const EVENT_DAY_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	timeZone: 'Europe/Berlin',
});
const EVENT_TIME_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Europe/Berlin',
});

function formatEventStart(event: StartEvent): string {
	const date = parseValidDate(event.startsAt);
	if (!date) return 'Datum unbekannt';
	const day = EVENT_DAY_FORMATTER.format(date);
	return event.allDay ? day : `${day}, ${EVENT_TIME_FORMATTER.format(date)}`;
}

const NEXT_DUE_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	day: 'numeric',
	month: 'short',
	timeZone: 'Europe/Berlin',
});

function formatNextDue(nextDueAt: string | null | undefined): string {
	const date = nextDueAt ? parseValidDate(nextDueAt) : null;
	return date ? `Für dich · ${NEXT_DUE_FORMATTER.format(date)}` : 'Für dich';
}

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
	const [armedChoreId, setArmedChoreId] = useState<string | null>(null);
	const [pendingChoreId, setPendingChoreId] = useState<string | null>(null);
	const [completeNotice, setCompleteNotice] = useState<string | null>(null);
	const completionRequestKeysRef = useRef(new Map<string, string>());
	const [nextEvent, setNextEvent] = useState<StartEvent | null | undefined>(undefined);
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

	useEffect(() => {
		const from = new Date();
		const to = new Date(from.getTime() + 7 * MS_PER_DAY);
		void apiFetch<{ events: StartEvent[] }>(
			`/api/wg/${encodedShareCode}/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
			{ memberId: identity.memberId },
		).then((result) => {
			if (!result.ok) return setNextEvent(null);
			const now = Date.now();
			const upcoming = result.data.events
				.filter((event) => (parseTimestamp(event.startsAt) ?? 0) >= now - MS_PER_DAY)
				.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
			setNextEvent(upcoming[0] ?? null);
		});
	}, [encodedShareCode, identity.memberId]);

	// Nur eigene Putzaufgaben lassen sich direkt abhaken. Erster Tipp merkt vor,
	// zweiter bestätigt – wie im Putzplan, damit ein versehentlicher Tipp nichts bucht.
	async function completeChore(item: TodayImportantItem): Promise<void> {
		const choreId = item.entityId;
		if (!choreId || pendingChoreId) return;
		if (armedChoreId !== choreId) {
			setArmedChoreId(choreId);
			setCompleteNotice(null);
			return;
		}
		const idempotencyKey =
			completionRequestKeysRef.current.get(choreId) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setCompleteNotice('Konnte nicht sicher gespeichert werden. Erledige es im Putzplan.');
			return;
		}
		completionRequestKeysRef.current.set(choreId, idempotencyKey);
		setPendingChoreId(choreId);
		const result = await apiFetch(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(choreId)}/complete`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ completedByMemberId: identity.memberId }),
			},
		);
		setPendingChoreId(null);
		setArmedChoreId(null);
		if (result.ok || result.error === 'chore_already_completed') {
			completionRequestKeysRef.current.delete(choreId);
			setCompleteNotice(`${item.title} erledigt.`);
			void load();
			return;
		}
		if (result.status > 0 && result.status < 500 && result.status !== 429)
			completionRequestKeysRef.current.delete(choreId);
		setCompleteNotice(
			result.status === 0
				? 'Offline: Öffne den Putzplan, dort wird die Erledigung vorgemerkt.'
				: 'Erledigt konnte nicht gespeichert werden. Versuche es gleich erneut.',
		);
	}
	useVisibilityPausedInterval(() => void load(), REFRESH_INTERVAL_MS);

	const myBalances =
		data?.balances.filter((balance) => balance.memberId === identity.memberId) ?? [];
	const primaryBalance =
		myBalances.find((balance) => balance.currency === 'EUR') ?? myBalances[0] ?? null;
	const myBalance = primaryBalance?.balanceCents ?? 0;
	// Zeige nur Salden ungleich Null je Währung an — außer es bliebe dadurch
	// nichts übrig (z. B. alles ausgeglichen), dann zeig den/die vorhandenen
	// Saldo/Salden trotzdem, statt eine leere Kachel zu rendern.
	const nonZeroBalances = myBalances.filter((balance) => balance.balanceCents !== 0);
	const myBalanceText =
		myBalances.length > 0
			? (nonZeroBalances.length > 0 ? nonZeroBalances : myBalances)
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
	const todayVisible = todayImportant.slice(0, TODAY_VISIBLE);
	const todayMore = todayImportant.slice(TODAY_VISIBLE);
	const latestAnnouncement = data?.latestAnnouncement;
	const pendingAnnouncements = data?.myOpenAnnouncements ?? [];
	const latestIsPending = Boolean(
		latestAnnouncement &&
			pendingAnnouncements.some((item) =>
				samePendingAnnouncement(latestAnnouncement, item, identity.name),
			),
	);
	const pendingHrefs = useMemo(
		() => new Set(todayImportant.map((item) => item.href)),
		[todayImportant],
	);
	const activityItems = useMemo(() => {
		if (!data) return [];
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
	}, [data, latestAnnouncement, pendingHrefs, wg.shareCode]);
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
				className="mx-auto grid w-full max-w-[var(--app-frame-width)] min-w-0 grid-cols-1 gap-6 px-4 py-6"
			>
				<header className="flex min-w-0 flex-col gap-1">
					<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight break-words">
						{new Intl.DateTimeFormat('de-DE', {
							weekday: 'long',
							day: 'numeric',
							month: 'long',
							timeZone: 'Europe/Berlin',
						}).format(updatedAt ?? new Date())}
					</h1>
					{updatedAt && (
						<p className="text-xs text-muted-foreground">
							Stand{' '}
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
					<div>
						<StartWelcome />
					</div>
				)}
				{error && (
					<div>
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
					<section aria-labelledby="today-heading" className="flex min-w-0 flex-col gap-2">
						<h2 id="today-heading" className="font-heading text-xl font-semibold">
							Heute für dich
						</h2>
						{completeNotice && (
							<output className="block text-sm text-muted-foreground">{completeNotice}</output>
						)}
						{data ? (
							todayImportant.length > 0 ? (
								<>
									<ul className="flex flex-col divide-y divide-border/60 rounded-xl border">
										{todayVisible.map((item) => (
											<TodayRow
												key={`${item.kind}:${item.href}`}
												item={item}
												armed={armedChoreId === item.entityId}
												pending={pendingChoreId === item.entityId}
												onCheck={() => void completeChore(item)}
											/>
										))}
									</ul>
									{todayMore.length > 0 && (
										<Collapsible open={todayMoreOpen} onOpenChange={setTodayMoreOpen}>
											<CollapsibleTrigger
												render={<Button variant="ghost" className="w-full justify-between" />}
											>
												<span>
													{todayMoreOpen
														? 'Weniger anzeigen'
														: `Weitere anzeigen (${todayMore.length})`}
												</span>
												<ChevronDown data-icon="inline-end" aria-hidden />
											</CollapsibleTrigger>
											<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
												<ul className="mt-1 flex flex-col divide-y divide-border/60 rounded-xl border">
													{todayMore.map((item) => (
														<TodayRow
															key={`${item.kind}:${item.href}`}
															item={item}
															armed={armedChoreId === item.entityId}
															pending={pendingChoreId === item.entityId}
															onCheck={() => void completeChore(item)}
														/>
													))}
												</ul>
											</CollapsiblePanel>
										</Collapsible>
									)}
								</>
							) : (
								<p className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
									<Check className="size-4 shrink-0" aria-hidden />
									Alles erledigt. Gerade gibt es nichts für dich zu tun.
								</p>
							)
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Deine Aufgaben für heute konnten nicht geladen werden.
							</p>
						) : (
							<output aria-label="Heute für dich wird geladen" className="flex flex-col gap-2">
								<Skeleton className="h-14 w-full" />
								<Skeleton className="h-14 w-full" />
							</output>
						)}
					</section>
				)}

				<div className="flex min-w-0 flex-col gap-6">
					<ul
						aria-label="Überblick"
						className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,max(8rem,calc(50%-0.375rem))),1fr))] gap-3"
					>
						<StartTile
							href={`${wgBaseHref}/ausgaben`}
							icon={Receipt}
							label="Saldo"
							loading={!data && !error}
							value={data ? myBalanceText : '–'}
							valueClassName={cn(
								'font-mono tabular-nums',
								myBalance > 0 && 'text-settled',
								myBalance < 0 && 'text-destructive',
							)}
							detail={
								!data
									? 'Nicht verfügbar'
									: myBalance > 0
										? 'Du bekommst zurück'
										: myBalance < 0
											? 'Du schuldest'
											: 'Ausgeglichen'
							}
						/>
						<StartTile
							href={`${wgBaseHref}/einkauf`}
							icon={ShoppingBasket}
							label="Einkäufe"
							loading={!data && !error}
							value={
								!data
									? '–'
									: data.openShoppingCount === 0
										? 'Alles da'
										: `${data.openShoppingCount} offen`
							}
							detail={
								data && data.openShoppingCount > 0
									? data.openShoppingTop.slice(0, 2).join(', ') || 'Liste öffnen'
									: 'Etwas eintragen'
							}
						/>
						<StartTile
							href={`${wgBaseHref}/putzen`}
							icon={SprayCan}
							label="Putzplan"
							loading={!data && !error}
							value={myNextChore ? myNextChore.title : 'Nichts fällig'}
							detail={
								myNextChore
									? formatNextDue(myNextChore.nextDueAt)
									: data?.setup.choreCount === 0
										? 'Plan anlegen'
										: 'Für dich'
							}
						/>
						<StartTile
							href={`${wgBaseHref}/kalender`}
							icon={CalendarDays}
							label="Kalender"
							loading={nextEvent === undefined}
							value={nextEvent ? nextEvent.title : 'Keine Termine'}
							detail={nextEvent ? formatEventStart(nextEvent) : 'Nächste 7 Tage'}
						/>
					</ul>
					<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
						<div className="flex justify-end">
							<Link
								href={`${wgBaseHref}/suche`}
								className={cn(
									buttonVariants({ variant: 'ghost' }),
									'min-w-0 max-w-full shrink whitespace-normal px-0 text-[13px] text-muted-foreground leading-snug',
								)}
							>
								<Search data-icon="inline-start" aria-hidden /> WG durchsuchen
							</Link>
						</div>
						<Collapsible defaultOpen={false}>
							<h2 id="wg-now-heading">
								<CollapsibleTrigger
									render={
										<Button
											variant="ghost"
											className="group w-full justify-between px-0 text-muted-foreground"
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
											<Link
												href={`${wgBaseHref}/aktivitaet`}
												className={cn(
													buttonVariants({ variant: 'ghost' }),
													'min-w-0 max-w-full shrink whitespace-normal px-0 text-[13px] text-muted-foreground text-right leading-snug',
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
										<div
											className="flex flex-col gap-2"
											aria-label="Neuigkeiten werden geladen"
											// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
											role="status"
										>
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
				<div>
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

function TodayRow({
	item,
	armed,
	pending,
	onCheck,
}: {
	item: TodayImportantItem;
	armed: boolean;
	pending: boolean;
	onCheck: () => void;
}) {
	const checkable = item.kind === 'chore' && item.isPersonal && Boolean(item.entityId);
	return (
		<li className="flex min-w-0 items-center gap-1 pr-1">
			{checkable ? (
				<Button
					variant="ghost"
					size="icon"
					className="ml-1 size-9 shrink-0"
					aria-label={armed ? `Bestätigen: ${item.title} erledigt` : `Abhaken: ${item.title}`}
					aria-pressed={armed}
					disabled={pending}
					onClick={onCheck}
				>
					{pending ? (
						<Loader2 className="animate-spin" aria-hidden />
					) : armed ? (
						<CircleCheck aria-hidden />
					) : (
						<Circle className="text-muted-foreground" aria-hidden />
					)}
				</Button>
			) : (
				<span className="ml-1 flex size-9 shrink-0 items-center justify-center">
					<TodayIcon kind={item.kind} />
				</span>
			)}
			<Link
				href={item.href}
				className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="font-medium break-words">{item.title}</span>
					<span
						className={cn(
							'text-sm text-muted-foreground',
							item.kind === 'recurring' && 'tabular-nums',
						)}
					>
						{armed ? 'Nochmal tippen zum Bestätigen' : item.detail}
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</Link>
		</li>
	);
}

function StartTile({
	href,
	icon: Icon,
	label,
	value,
	detail,
	loading,
	valueClassName,
}: {
	href: string;
	icon: LucideIcon;
	label: string;
	value: string;
	detail: string;
	loading: boolean;
	valueClassName?: string;
}) {
	return (
		<li className="min-w-0">
			<Link
				href={href}
				className="flex h-full min-h-24 min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
			>
				<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<Icon className="size-4 shrink-0" aria-hidden />
					{label}
				</span>
				{loading ? (
					<>
						<Skeleton className="h-5 w-3/4" />
						<Skeleton className="h-4 w-1/2" />
					</>
				) : (
					<>
						<span className={cn('font-semibold break-words', valueClassName)}>{value}</span>
						<span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
					</>
				)}
			</Link>
		</li>
	);
}
