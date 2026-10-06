'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { useToast } from '@/components/ui/Toast';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { StartWelcome } from '@/components/wg/dashboard/StartWelcome';
import { TodayIcon } from '@/components/wg/dashboard/TodayIcon';
import type { DashboardData } from '@/composition/dashboard-data';
import {
	type TodayImportantItem,
	type WeekAgendaItem,
	getBerlinWeekWindow,
	getForYouItems,
	getWeekAgenda,
} from '@/composition/dashboard-insights';
import { getDashboardAnnouncementHref } from '@/composition/dashboard-links';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { getChoreStatus } from '@/features/chores/chore-status';
import {
	ChoreCompleteDialog,
	completeTriggerLabel,
} from '@/features/chores/components/ChoreCompleteDialog';
import { type SerializedWgEvent, expandRecurrence } from '@/features/events/events';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	Loader2,
	Megaphone,
	Sparkles,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

const PushPrimingPrompt = dynamic(
	() => import('@/shared/components/push-priming-prompt').then((m) => m.PushPrimingPrompt),
	{ ssr: false },
);

const REFRESH_INTERVAL_MS = 30_000;
/** How long the done notice stays, and how long a tapped chore stays armed for the confirm tap. */
const TODAY_VISIBLE = 4;

type PendingAnnouncement = DashboardData['myOpenAnnouncements'][number];

function subscribeOnline(onChange: () => void): () => void {
	window.addEventListener('online', onChange);
	window.addEventListener('offline', onChange);
	return () => {
		window.removeEventListener('online', onChange);
		window.removeEventListener('offline', onChange);
	};
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

export default function WgHomePage() {
	const online = useSyncExternalStore(
		subscribeOnline,
		() => navigator.onLine,
		() => true,
	);
	const { wg, identity } = useWg();
	const [todayMoreOpen, setTodayMoreOpen] = useState(false);
	const [confirmItem, setConfirmItem] = useState<TodayImportantItem | null>(null);
	const [pendingChoreId, setPendingChoreId] = useState<string | null>(null);
	const [completeError, setCompleteError] = useState<string | null>(null);
	const toast = useToast();
	const completionRequestKeysRef = useRef(new Map<string, string>());
	const [berlinTodayKey, setBerlinTodayKey] = useState(() => berlinDayKey(new Date()));
	const [agendaNow, setAgendaNow] = useState(() => Date.now());
	const reducedMotion = useReducedMotion();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const weekWindow = useMemo(
		() => getBerlinWeekWindow(Date.parse(`${berlinTodayKey}T12:00:00.000Z`)),
		[berlinTodayKey],
	);
	const dashboardRead = useCachedFetch<DashboardData>(`/api/wg/${encodedShareCode}/dashboard`, {
		memberId: identity.memberId,
		memberToken: identity.memberToken,
	});
	const eventUrl = `/api/wg/${encodedShareCode}/events?from=${encodeURIComponent(weekWindow.from.toISOString())}&to=${encodeURIComponent(weekWindow.to.toISOString())}`;
	const eventRead = useCachedFetch<{ events: SerializedWgEvent[] }>(eventUrl, {
		memberId: identity.memberId,
		memberToken: identity.memberToken,
	});
	const data = dashboardRead.data ?? null;
	const loading = dashboardRead.isLoading;
	const error = dashboardRead.error
		? getWgLoadErrorMessage('Die Startseite', dashboardRead.error.status, dashboardRead.error.error)
		: null;
	const eventOccurrences = useMemo(
		() =>
			(eventRead.data?.events ?? []).flatMap((event) =>
				expandRecurrence(event, weekWindow.from, weekWindow.to),
			),
		[eventRead.data, weekWindow],
	);
	const load = useCallback(() => {
		const now = Date.now();
		setAgendaNow(now);
		const nextTodayKey = berlinDayKey(new Date(now));
		if (nextTodayKey !== berlinTodayKey) setBerlinTodayKey(nextTodayKey);
		else void eventRead.refresh();
		void dashboardRead.refresh();
	}, [berlinTodayKey, dashboardRead.refresh, eventRead.refresh]);

	// Nur eigene Putzaufgaben lassen sich direkt abhaken. Wie im Putzplan: erst der
	// Knopf, dann der Bestätigungsdialog; ein Toast meldet das Ergebnis.
	async function completeChore(item: TodayImportantItem): Promise<void> {
		const choreId = item.entityId;
		if (!choreId || pendingChoreId) return;
		// One key per occurrence: after an uncertain failure that actually saved,
		// the next due date must not replay the earlier completion.
		const requestKey = `${choreId}:${item.expectedNextDueAt}`;
		const idempotencyKey =
			completionRequestKeysRef.current.get(requestKey) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setCompleteError(
				'Erledigt-Aktion konnte nicht sicher gespeichert werden. Versuche es erneut.',
			);
			return;
		}
		completionRequestKeysRef.current.set(requestKey, idempotencyKey);
		setCompleteError(null);
		setPendingChoreId(choreId);
		const result = await apiFetch(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(choreId)}/complete`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					expectedNextDueAt: item.expectedNextDueAt,
					expectedAssignedMemberId: item.expectedAssignedMemberId,
				}),
			},
		);
		setPendingChoreId(null);
		if (result.ok || result.error === 'chore_already_completed') {
			completionRequestKeysRef.current.delete(requestKey);
			setConfirmItem(null);
			toast.success(`${item.title} erledigt.`);
			void load();
			return;
		}
		if (result.error === 'chore_occurrence_changed') {
			completionRequestKeysRef.current.delete(requestKey);
			setConfirmItem(null);
			toast.info('Termin oder Zuständigkeit haben sich geändert. Der Plan wird aktualisiert.');
			void load();
			return;
		}
		if (result.status > 0 && result.status < 500 && result.status !== 429)
			completionRequestKeysRef.current.delete(requestKey);
		setCompleteError(
			result.status === 0
				? 'Offline: Öffne den Putzplan, dort wird die Erledigung vorgemerkt.'
				: 'Erledigt konnte nicht gespeichert werden. Versuche es gleich erneut.',
		);
	}
	useVisibilityPausedInterval(() => void load(), REFRESH_INTERVAL_MS);
	useEffect(() => {
		const onShow = () => {
			if (document.visibilityState === 'visible') load();
		};
		document.addEventListener('visibilitychange', onShow);
		window.addEventListener('focus', onShow);
		return () => {
			document.removeEventListener('visibilitychange', onShow);
			window.removeEventListener('focus', onShow);
		};
	}, [load]);

	const forYouItems = useMemo(
		() =>
			data
				? getForYouItems({
						shareCode: wg.shareCode,
						currentMemberId: identity.memberId,
						openShoppingCount: data.openShoppingCount,
						openShoppingTop: data.openShoppingTop,
						dueChores: data.dueChores,
						myOpenAnnouncements: data.myOpenAnnouncements,
						dueRecurringExpenses: data.dueRecurringExpenses,
						absentMembers: data.absentMembers,
						balances: data.balances,
					})
				: [],
		[data, identity.memberId, wg.shareCode],
	);
	const forYouVisible = forYouItems.slice(0, TODAY_VISIBLE);
	const forYouMore = forYouItems.slice(TODAY_VISIBLE);
	const weekAgenda = useMemo(
		() =>
			getWeekAgenda({
				shareCode: wg.shareCode,
				currentMemberId: identity.memberId,
				dueChores: data?.dueChores ?? [],
				events: eventOccurrences,
				now: agendaNow,
			}),
		[data?.dueChores, eventOccurrences, agendaNow, identity.memberId, wg.shareCode],
	);
	const overdueVisible = weekAgenda.overdue.slice(0, TODAY_VISIBLE);
	const upcomingVisible = weekAgenda.upcoming.slice(0, TODAY_VISIBLE);
	const latestAnnouncement = data?.latestAnnouncement;
	const pendingAnnouncements = data?.myOpenAnnouncements ?? [];
	const latestIsPending = Boolean(
		latestAnnouncement &&
			pendingAnnouncements.some((item) =>
				samePendingAnnouncement(latestAnnouncement, item, identity.name),
			),
	);
	const pendingHrefs = useMemo(() => new Set(forYouItems.map((item) => item.href)), [forYouItems]);
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
			forYouItems.length === 0,
	);

	return (
		<>
			<div
				data-home-content
				className="mx-auto flex w-full min-w-0 max-w-[var(--app-frame-width)] flex-col gap-3 px-4 py-3"
			>
				{isNewWg && (
					<div>
						<StartWelcome />
					</div>
				)}
				{/* Offline mit vorhandenen Daten meldet schon die Offline-Leiste. */}
				{error && !(data && !online) && (
					<div>
						<LoadErrorBanner
							message={data ? `${error} Die angezeigten Daten können veraltet sein.` : error}
							onRetry={() => void load()}
							busy={loading}
							retryLabel="Startseite erneut laden"
						/>
					</div>
				)}

				{!isNewWg && (
					<section aria-labelledby="today-heading" className="flex min-w-0 flex-col gap-2">
						<h2 id="today-heading" className="font-heading text-xl font-semibold">
							Für dich
						</h2>
						{data ? (
							forYouItems.length > 0 ? (
								<>
									<ul className="flex flex-col divide-y divide-border/60 rounded-xl border">
										{forYouVisible.map((item) => (
											<TodayRow
												key={`${item.kind}:${item.entityId ?? item.href}`}
												item={item}
												pending={pendingChoreId === item.entityId}
												confirming={confirmItem?.entityId === item.entityId}
												error={completeError}
												onCheck={() => {
													setCompleteError(null);
													setConfirmItem(item);
												}}
												onCancel={() => setConfirmItem(null)}
												onConfirm={() => void completeChore(item)}
											/>
										))}
									</ul>
									{forYouMore.length > 0 && (
										<Collapsible open={todayMoreOpen} onOpenChange={setTodayMoreOpen}>
											<CollapsibleTrigger
												render={
													<Button
														variant="ghost"
														className="w-full justify-between text-muted-foreground"
													/>
												}
											>
												<span>
													{todayMoreOpen
														? 'Weniger anzeigen'
														: `Weitere anzeigen (${forYouMore.length})`}
												</span>
												<ChevronDown data-icon="inline-end" aria-hidden />
											</CollapsibleTrigger>
											<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
												<ul className="mt-1 flex flex-col divide-y divide-border/60 rounded-xl border">
													{forYouMore.map((item) => (
														<TodayRow
															key={`${item.kind}:${item.entityId ?? item.href}`}
															item={item}
															pending={pendingChoreId === item.entityId}
															confirming={confirmItem?.entityId === item.entityId}
															error={completeError}
															onCheck={() => {
																setCompleteError(null);
																setConfirmItem(item);
															}}
															onCancel={() => setConfirmItem(null)}
															onConfirm={() => void completeChore(item)}
														/>
													))}
												</ul>
											</CollapsiblePanel>
										</Collapsible>
									)}
								</>
							) : (
								<p className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground">
									<Check className="size-4 shrink-0" aria-hidden />
									Alles erledigt. Gerade gibt es nichts für dich zu tun.
								</p>
							)
						) : error ? (
							<p className="text-sm text-muted-foreground">
								Deine persönlichen Aufgaben konnten nicht geladen werden.
							</p>
						) : (
							<output aria-label="Für dich wird geladen" className="flex flex-col gap-2">
								<Skeleton className="h-14 w-full" />
								<Skeleton className="h-14 w-full" />
							</output>
						)}
					</section>
				)}

				<div className="flex min-w-0 flex-col gap-3">
					<section aria-labelledby="week-heading" className="flex min-w-0 flex-col gap-2">
						<div className="flex min-w-0 flex-wrap items-center gap-3">
							<h2 id="week-heading" className="font-heading min-w-0 text-xl font-semibold">
								Diese Woche
							</h2>
							<Link
								href={`${wgBaseHref}/kalender`}
								className={cn(
									buttonVariants({ variant: 'ghost' }),
									'ml-auto shrink-0 px-2 text-sm text-muted-foreground after:h-[44px] after:min-w-[44px]',
								)}
							>
								Kalender <ChevronRight data-icon="inline-end" aria-hidden />
							</Link>
						</div>

						{eventRead.isLoading && !eventRead.data && (
							<output className="text-sm text-muted-foreground">Termine werden geladen…</output>
						)}
						{eventRead.error && !(online === false && eventRead.data) && (
							<div className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
								<output className="min-w-0 flex-1 basis-48">
									{eventRead.data
										? 'Termine konnten nicht aktualisiert werden. Angezeigte Einträge können veraltet sein.'
										: data
											? 'Termine konnten nicht geladen werden. Putzplan-Aufgaben bleiben sichtbar.'
											: 'Termine konnten nicht geladen werden.'}
								</output>
								<Button
									variant="outline"
									type="button"
									className="min-h-11 shrink-0"
									onClick={() => void eventRead.refresh()}
								>
									Termine erneut laden
								</Button>
							</div>
						)}
						{!data && !error && (
							<output className="text-sm text-muted-foreground">
								Putzplan-Aufgaben werden geladen…
							</output>
						)}
						{!data && error && (
							<p className="text-sm text-muted-foreground">
								Putzplan-Aufgaben konnten nicht geladen werden.
							</p>
						)}

						{weekAgenda.overdue.length > 0 && (
							<div className="flex min-w-0 flex-col gap-2">
								<h3 className="text-sm font-medium text-foreground">Überfällig</h3>
								<ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-xl border">
									{overdueVisible.map((item) => (
										<AgendaRow key={item.key} item={item} todayKey={berlinTodayKey} />
									))}
								</ul>
								{weekAgenda.overdue.length > overdueVisible.length && (
									<Link
										href={`${wgBaseHref}/putzen?filter=overdue`}
										className={cn(
											buttonVariants({ variant: 'ghost' }),
											'w-full justify-between text-muted-foreground',
										)}
									>
										<span>
											Alle überfälligen Aufgaben (
											{weekAgenda.overdue.length - overdueVisible.length})
										</span>
										<ChevronRight data-icon="inline-end" aria-hidden />
									</Link>
								)}
							</div>
						)}

						{upcomingVisible.length > 0 && (
							<div className="flex min-w-0 flex-col gap-2">
								{weekAgenda.overdue.length > 0 && (
									<h3 className="text-sm font-medium text-muted-foreground">Anstehend</h3>
								)}
								<ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-xl border">
									{upcomingVisible.map((item) => (
										<AgendaRow key={item.key} item={item} todayKey={berlinTodayKey} />
									))}
								</ul>
								{weekAgenda.upcoming.length > upcomingVisible.length && (
									<Link
										href={`${wgBaseHref}/kalender`}
										className={cn(
											buttonVariants({ variant: 'ghost' }),
											'w-full justify-between text-muted-foreground',
										)}
									>
										<span>
											Weitere Termine und Aufgaben (
											{weekAgenda.upcoming.length - upcomingVisible.length})
										</span>
										<ChevronRight data-icon="inline-end" aria-hidden />
									</Link>
								)}
							</div>
						)}

						{data &&
							!error &&
							!eventRead.error &&
							Boolean(eventRead.data) &&
							weekAgenda.overdue.length === 0 &&
							weekAgenda.upcoming.length === 0 && (
								<p className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground">
									<CalendarDays className="size-4 shrink-0" aria-hidden />
									Bis Sonntag nichts geplant.
								</p>
							)}
					</section>

					<section aria-labelledby="wg-now-heading" className="flex min-w-0 flex-col gap-3">
						{/* Immer zugeklappt starten: Neuigkeiten öffnet man bei Bedarf selbst. */}
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
												<div className="rounded-xl border">
													<ActivityFeed items={activityItems} inset />
												</div>
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
									<Link
										href={`${wgBaseHref}/aktivitaet`}
										className={cn(
											buttonVariants({ variant: 'ghost' }),
											'min-w-0 max-w-full self-end whitespace-normal px-0 text-[12px] text-muted-foreground leading-snug',
										)}
									>
										Gesamte Aktivität <ChevronRight data-icon="inline-end" aria-hidden />
									</Link>
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
	pending,
	confirming,
	error,
	onCheck,
	onCancel,
	onConfirm,
}: {
	item: TodayImportantItem;
	pending: boolean;
	confirming: boolean;
	error: string | null;
	onCheck: () => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const checkable = item.kind === 'chore' && item.isPersonal && Boolean(item.entityId);
	const actionLabel = getChoreStatus(item.expectedNextDueAt ?? '').actionLabel;
	const debtAmount =
		item.kind === 'debt' && item.amountCents !== undefined
			? formatEuroCents(item.amountCents, item.currency, { signed: true })
			: undefined;
	return (
		<li className="flex min-w-0 items-center gap-2 pl-2 pr-2">
			{checkable ? (
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					aria-label={completeTriggerLabel(item.title, actionLabel)}
					// aria-disabled statt disabled: sonst verliert der Fokus den Knopf, während gespeichert wird.
					aria-disabled={pending}
					onClick={() => {
						if (!pending) onCheck();
					}}
				>
					{pending ? (
						<Loader2 className="animate-spin" aria-hidden />
					) : (
						<Circle className="text-muted-foreground" aria-hidden />
					)}
				</Button>
			) : (
				<span className="flex size-8 shrink-0 items-center justify-center">
					<TodayIcon kind={item.kind} />
				</span>
			)}
			<Link
				href={item.href}
				className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 rounded-lg py-1.5 outline-none transition-colors duration-75 active:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="flex min-w-16 flex-1 flex-col">
					<span className="text-[14px] font-medium leading-snug break-words">{item.title}</span>
					<span
						className={cn(
							'text-pretty text-[12px] text-muted-foreground',
							item.kind === 'recurring' && 'tabular-nums',
						)}
					>
						{pending ? 'Wird gespeichert…' : item.detail}
					</span>
				</span>
				<span className="ml-auto flex shrink-0 items-center gap-2">
					{debtAmount !== undefined && !pending && (
						<span className="whitespace-nowrap font-mono text-[12px] font-medium tabular-nums">
							{debtAmount}
						</span>
					)}
					<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
				</span>
			</Link>
			{checkable && (
				<ChoreCompleteDialog
					open={confirming}
					title={item.title}
					actionLabel={actionLabel}
					busy={pending}
					error={error}
					onCancel={onCancel}
					onConfirm={onConfirm}
				/>
			)}
		</li>
	);
}

const AGENDA_DAY_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	timeZone: 'Europe/Berlin',
});

function formatAgendaDay(dayKey: string, todayKey: string): string {
	if (dayKey === todayKey) return 'Heute';
	const tomorrowKey = berlinDayKey(new Date(Date.parse(`${todayKey}T12:00:00Z`) + MS_PER_DAY));
	if (dayKey === tomorrowKey) return 'Morgen';
	return AGENDA_DAY_FORMATTER.format(new Date(`${dayKey}T12:00:00.000Z`));
}

function AgendaRow({ item, todayKey }: { item: WeekAgendaItem; todayKey: string }) {
	return (
		<li className="flex min-w-0 items-center gap-2 pl-2 pr-2">
			<span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
				{item.kind === 'event' ? (
					<CalendarDays className="size-4" aria-hidden />
				) : (
					<Sparkles className="size-4" aria-hidden />
				)}
			</span>
			<Link
				href={item.href}
				className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-[14px] font-medium leading-snug break-words">{item.title}</span>
					<span className="text-[12px] text-muted-foreground">
						{formatAgendaDay(item.dayKey, todayKey)} · {item.detail}
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</Link>
		</li>
	);
}
