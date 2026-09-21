'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BackLink } from '@/components/wg/BackLink';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { copyText } from '@/core/utils/clipboard';
import { MS_PER_DAY } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { CalendarMonth } from '@/features/events/components/CalendarMonth';
import { CalendarUpcomingList } from '@/features/events/components/CalendarUpcomingList';
import {
	type CreateEventPayload,
	EventCreateModal,
} from '@/features/events/components/EventCreateModal';
import {
	type EditableEvent,
	EventEditModal,
	type UpdateEventPayload,
} from '@/features/events/components/EventEditModal';
import {
	type EventInput,
	type EventOccurrence,
	expandRecurrence,
	getMonthBounds,
} from '@/features/events/events';
import { haptic } from '@/shared/lib/haptics';
import {
	CalendarDays,
	ExternalLink,
	List,
	Loader2,
	Plus,
	RefreshCw,
	RotateCcw,
	Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface CalendarEvent {
	id: string;
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
}

type CalendarCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';
type CalendarCreateResponse = { event: CalendarEvent; warning: CalendarCreateWarning };

interface ChoreSummary {
	id: string;
	title: string;
	nextDueAt: string;
}

interface CalendarSubscription {
	feedUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface CalendarSubscriptionResponse {
	subscription: CalendarSubscription | null;
}

type ViewMode = 'month' | 'list';

const UPCOMING_DAYS = 30;

function eventToInput(event: CalendarEvent): EventInput {
	return {
		id: event.id,
		title: event.title,
		description: event.description,
		startsAt: event.startsAt,
		endsAt: event.endsAt,
		allDay: event.allDay,
		location: event.location,
		recurrence: event.recurrence,
	};
}

function buildChoreOccurrences(
	chores: ChoreSummary[],
	from: Date,
	to: Date,
): Array<{ choreId: string; title: string; startsAt: string }> {
	const fromMs = from.getTime();
	const toMs = to.getTime();
	return chores
		.filter((chore) => {
			const ts = Date.parse(chore.nextDueAt);
			return ts >= fromMs && ts <= toMs;
		})
		.map((chore) => ({ choreId: chore.id, title: chore.title, startsAt: chore.nextDueAt }))
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function KalenderPage() {
	const { wg, identity } = useWg();
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const createEventRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const [chores, setChores] = useState<ChoreSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	// Liste als Default: eine WG hat selten mehr als eine Handvoll Termine im
	// Monat — das Grid ist die Ausnahme-Ansicht, nicht der Einstieg.
	const [view, setView] = useState<ViewMode>('list');
	const [month, setMonth] = useState<Date>(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});
	const [selectedDay, setSelectedDay] = useState<Date | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<EditableEvent | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [subscription, setSubscription] = useState<CalendarSubscription | null>(null);
	const [subscriptionLoading, setSubscriptionLoading] = useState(true);
	const [subscriptionBusy, setSubscriptionBusy] = useState(false);
	const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
	const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
	const subscriptionRequestKeysRef = useRef(new Map<string, string>());
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
	const [subscriptionConfirm, setSubscriptionConfirm] = useState<'rotate' | 'revoke' | null>(null);
	const subscriptionEndpoint = `/api/wg/${encodedShareCode}/calendar-subscription`;

	const load = useCallback(
		async (isInitial: boolean): Promise<void> => {
			if (isInitial) setLoading(true);
			const bounds = getMonthBounds(month);
			const upcomingFrom = new Date();
			const upcomingTo = new Date(upcomingFrom.getTime() + UPCOMING_DAYS * MS_PER_DAY);
			const fromParam = new Date(
				Math.min(bounds.start.getTime(), upcomingFrom.getTime()),
			).toISOString();
			const toParam = new Date(Math.max(bounds.end.getTime(), upcomingTo.getTime())).toISOString();

			const [eventsRes, choreRes] = await Promise.all([
				apiFetch<{ events: CalendarEvent[] }>(
					`/api/wg/${encodedShareCode}/events?from=${encodeURIComponent(
						fromParam,
					)}&to=${encodeURIComponent(toParam)}`,
					{ memberId: identity.memberId },
				),
				apiFetch<{ chores: ChoreSummary[] }>(`/api/wg/${encodedShareCode}/chores`, {
					memberId: identity.memberId,
				}),
			]);

			let nextError: string | null = null;
			if (eventsRes.ok) setEvents(eventsRes.data.events);
			else nextError = 'Termine konnten nicht geladen werden.';
			if (choreRes.ok) {
				setChores(
					choreRes.data.chores.map((chore) => ({
						id: chore.id,
						title: chore.title,
						nextDueAt: chore.nextDueAt,
					})),
				);
			} else if (!nextError) nextError = 'Putzplan-Aufgaben konnten nicht geladen werden.';
			setLoadError(nextError);
			if (isInitial) setLoading(false);
		},
		[encodedShareCode, identity.memberId, month],
	);

	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(false), 30_000);
	useEffect(() => {
		void load(true);
	}, [load]);

	const loadSubscription = useCallback(async (): Promise<void> => {
		setSubscriptionLoading(true);
		const res = await apiFetch<CalendarSubscriptionResponse>(subscriptionEndpoint, {
			memberId: identity.memberId,
			memberToken: identity.memberToken,
		});
		if (res.ok) {
			setSubscription(res.data.subscription ?? null);
			setSubscriptionError(null);
		} else {
			setSubscriptionError('Kalender-Feed konnte nicht geladen werden.');
		}
		setSubscriptionLoading(false);
	}, [identity.memberId, identity.memberToken, subscriptionEndpoint]);

	useEffect(() => {
		void loadSubscription();
	}, [loadSubscription]);

	const monthOccurrences = useMemo<EventOccurrence[]>(() => {
		const bounds = getMonthBounds(month);
		return events.flatMap((event) =>
			expandRecurrence(eventToInput(event), bounds.start, bounds.end),
		);
	}, [events, month]);

	const upcomingOccurrences = useMemo<EventOccurrence[]>(() => {
		const from = new Date();
		const to = new Date(from.getTime() + UPCOMING_DAYS * MS_PER_DAY);
		const all = events.flatMap((event) => expandRecurrence(eventToInput(event), from, to));
		return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
	}, [events]);

	const upcomingChoreOccurrences = useMemo(() => {
		const from = new Date();
		const to = new Date(from.getTime() + UPCOMING_DAYS * MS_PER_DAY);
		return buildChoreOccurrences(chores, from, to);
	}, [chores]);

	function handleSelectOccurrence(occ: EventOccurrence): void {
		const event = events.find((e) => e.id === occ.eventId);
		if (!event) return;
		setEditing(event);
	}

	async function handleCreate(payload: CreateEventPayload): Promise<void> {
		const fingerprint = JSON.stringify(payload);
		const pending = createEventRequestRef.current;
		const idempotencyKey =
			pending?.fingerprint === fingerprint ? pending.key : createOfflineIdempotencyKey();
		if (!idempotencyKey) throw new Error('Termin konnte nicht sicher gesendet werden.');
		createEventRequestRef.current = { fingerprint, key: idempotencyKey };
		const res = await apiFetch<CalendarCreateResponse>(`/api/wg/${encodedShareCode}/events`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			if (res.status > 0 && res.status < 500) createEventRequestRef.current = null;
			throw new Error('Termin konnte nicht gespeichert werden.');
		}
		createEventRequestRef.current = null;
		haptic('medium');
		setEvents((current) => [...current, res.data.event]);
		setCreateOpen(false);
		if (res.data.warning) {
			toast.info('Termin gespeichert. Push-Versand konnte nicht bestätigt werden.');
		}
	}

	async function handleUpdate(id: string, payload: UpdateEventPayload): Promise<void> {
		const res = await apiFetch<{ event: CalendarEvent }>(
			`/api/wg/${encodedShareCode}/events/${encodeURIComponent(id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify(payload),
			},
		);
		if (!res.ok) {
			throw new Error('Termin konnte nicht aktualisiert werden.');
		}
		setEvents((current) => current.map((event) => (event.id === id ? res.data.event : event)));
		setEditing(null);
	}

	async function handleDelete(id: string): Promise<void> {
		const res = await apiFetch<unknown>(
			`/api/wg/${encodedShareCode}/events/${encodeURIComponent(id)}`,
			{
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			},
		);
		if (!res.ok) {
			setActionError('Termin konnte nicht gelöscht werden.');
			return;
		}
		setEvents((current) => current.filter((event) => event.id !== id));
		setEditing(null);
	}

	async function saveSubscription(method: 'POST' | 'PATCH', message: string): Promise<void> {
		setSubscriptionBusy(true);
		setSubscriptionError(null);
		setSubscriptionNotice(null);
		const requestKeyId = `subscription:${method}`;
		const idempotencyKey =
			subscriptionRequestKeysRef.current.get(requestKeyId) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setSubscriptionError(
				'Kalender-Feed konnte nicht sicher gespeichert werden. Versuche es erneut.',
			);
			setSubscriptionBusy(false);
			return;
		}
		subscriptionRequestKeysRef.current.set(requestKeyId, idempotencyKey);
		const res = await apiFetch<CalendarSubscriptionResponse>(subscriptionEndpoint, {
			method,
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			headers: { 'Idempotency-Key': idempotencyKey },
		});
		if (res.ok && res.data.subscription) {
			subscriptionRequestKeysRef.current.delete(requestKeyId);
			setSubscription(res.data.subscription);
			setCopyState('idle');
			setSubscriptionNotice(message);
		} else {
			if (!res.ok && res.status > 0 && res.status < 500) {
				subscriptionRequestKeysRef.current.delete(requestKeyId);
			}
			setSubscriptionError('Kalender-Feed konnte nicht gespeichert werden.');
		}
		setSubscriptionBusy(false);
	}

	async function revokeSubscription(): Promise<void> {
		setSubscriptionBusy(true);
		setSubscriptionError(null);
		setSubscriptionNotice(null);
		const requestKeyId = 'subscription:DELETE';
		const idempotencyKey =
			subscriptionRequestKeysRef.current.get(requestKeyId) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setSubscriptionError(
				'Kalender-Feed konnte nicht sicher widerrufen werden. Versuche es erneut.',
			);
			setSubscriptionBusy(false);
			return;
		}
		subscriptionRequestKeysRef.current.set(requestKeyId, idempotencyKey);
		const res = await apiFetch<unknown>(subscriptionEndpoint, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			headers: { 'Idempotency-Key': idempotencyKey },
		});
		if (res.ok) {
			subscriptionRequestKeysRef.current.delete(requestKeyId);
			setSubscription(null);
			setCopyState('idle');
			setSubscriptionNotice('Kalender-Feed widerrufen.');
		} else {
			if (!res.ok && res.status > 0 && res.status < 500) {
				subscriptionRequestKeysRef.current.delete(requestKeyId);
			}
			setSubscriptionError('Kalender-Feed konnte nicht widerrufen werden.');
		}
		setSubscriptionBusy(false);
	}

	async function copySubscriptionUrl(): Promise<void> {
		if (!subscription) return;
		setCopyState((await copyText(subscription.feedUrl)) ? 'copied' : 'failed');
	}

	function changeMonth(delta: number): void {
		setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
		setSelectedDay(null);
	}

	function handlePrevMonth(): void {
		haptic('light');
		changeMonth(-1);
	}

	function handleNextMonth(): void {
		haptic('light');
		changeMonth(1);
	}

	function handleDaySelect(day: Date): void {
		haptic('light');
		setSelectedDay(day);
	}

	function handleFabClick(): void {
		haptic('light');
		setCreateOpen(true);
	}

	const now = new Date();
	const isCurrentMonth =
		month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();

	function handleJumpToToday(): void {
		haptic('light');
		setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
		setSelectedDay(null);
	}

	return (
		<div
			data-household-content
			className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
		>
			<header className="flex flex-wrap items-center gap-3">
				<BackLink href={`${wgBaseHref}/einkauf`} label="Haushalt" />
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-2xl font-semibold tracking-tight break-words [overflow-wrap:anywhere]">
						Kalender
					</h1>
					<p className="mt-1">
						<Badge variant="secondary">
							{loading ? 'Lädt…' : `${events.length} Termin${events.length === 1 ? '' : 'e'}`}
						</Badge>
					</p>
				</div>
				<div className="flex shrink-0 items-center justify-end gap-2">
					{!isCurrentMonth && (
						<Button
							variant="outline"
							size="icon"
							onClick={handleJumpToToday}
							aria-label="Zum aktuellen Monat springen"
							title="Heute"
							className="min-h-11 min-w-11"
						>
							<RotateCcw aria-hidden />
						</Button>
					)}
					<Button
						size="default"
						onClick={handleFabClick}
						aria-label="Termin hinzufügen"
						className="w-9 shrink-0 px-0 sm:w-auto sm:px-3"
					>
						<Plus aria-hidden />
						<span className="hidden sm:inline">Termin hinzufügen</span>
					</Button>
				</div>
			</header>
			<SubNav label="Haushalt" items={[]} />

			{actionError && (
				<Alert variant="destructive">
					<AlertDescription>{actionError}</AlertDescription>
				</Alert>
			)}

			{loadError && (
				<Alert variant="destructive">
					<AlertTitle>Kalender konnte nicht geladen werden</AlertTitle>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
						<span>{loadError}</span>
						<Button
							type="button"
							variant="outline"
							className="min-h-11"
							onClick={() => void load(true)}
						>
							Erneut laden
						</Button>
					</AlertDescription>
				</Alert>
			)}

			<Tabs
				value={view}
				onValueChange={(value) => {
					haptic('light');
					setView(value as ViewMode);
				}}
				className="gap-3"
			>
				<TabsList className="w-full">
					<TabsTrigger value="list" className="min-h-11">
						<List data-icon="inline-start" aria-hidden />
						Agenda
					</TabsTrigger>
					<TabsTrigger value="month" className="min-h-11">
						<CalendarDays data-icon="inline-start" aria-hidden />
						Monat
					</TabsTrigger>
				</TabsList>
				<TabsContent value="list" className="flex flex-col gap-3">
					<section aria-labelledby="calendar-upcoming-heading" className="flex flex-col gap-3">
						<h2 id="calendar-upcoming-heading" className="text-sm font-semibold">
							Nächste 30 Tage
						</h2>
						{loading ? (
							<output aria-live="polite" className="block text-sm text-muted-foreground">
								Agenda wird geladen…
							</output>
						) : loadError ? null : (
							<CalendarUpcomingList
								occurrences={upcomingOccurrences}
								choreOccurrences={upcomingChoreOccurrences}
								onSelect={handleSelectOccurrence}
								onCreate={handleFabClick}
								wgBaseHref={wgBaseHref}
							/>
						)}
					</section>
				</TabsContent>
				<TabsContent value="month">
					<CalendarMonth
						month={month}
						occurrences={monthOccurrences}
						onPrev={handlePrevMonth}
						onNext={handleNextMonth}
						onSelectDay={handleDaySelect}
						onSelectOccurrence={handleSelectOccurrence}
						selectedDay={selectedDay}
					/>
				</TabsContent>
			</Tabs>

			<details className="rounded-xl border border-border">
				<summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
					Kalender abonnieren
				</summary>
				<div className="flex flex-col gap-3 border-t border-border px-4 py-4">
					<p className="text-sm text-muted-foreground">
						Neue WG-Termine automatisch in Apple Kalender oder Google Kalender erhalten.
					</p>
					{subscriptionError && (
						<Alert variant="destructive">
							<AlertDescription>{subscriptionError}</AlertDescription>
						</Alert>
					)}
					{subscriptionLoading ? (
						<p className="text-sm text-muted-foreground">Feed wird geladen…</p>
					) : subscription ? (
						<div className="flex flex-col gap-3">
							<Field>
								<FieldLabel htmlFor="calendar-feed-url">Persönlicher Feed-Link</FieldLabel>
								<div className="flex min-w-0 flex-wrap gap-2">
									<Input
										id="calendar-feed-url"
										type="url"
										readOnly
										value={subscription.feedUrl}
										className="min-h-11 min-w-0 flex-1 text-sm"
									/>
									<Button
										type="button"
										variant="outline"
										onClick={() => void copySubscriptionUrl()}
										className="min-h-11 max-w-full shrink whitespace-normal"
									>
										{copyState === 'copied' ? 'Kopiert' : 'Link kopieren'}
									</Button>
								</div>
							</Field>
							<div className="flex flex-wrap gap-2">
								<Button
									nativeButton={false}
									render={
										<a href={subscription.feedUrl} target="_blank" rel="noopener noreferrer">
											<ExternalLink data-icon="inline-start" aria-hidden />
											Feed öffnen
										</a>
									}
									className="min-h-11"
								/>
								<Button
									type="button"
									variant="outline"
									disabled={subscriptionBusy}
									onClick={() => setSubscriptionConfirm('rotate')}
									className="min-h-11"
								>
									<RefreshCw data-icon="inline-start" aria-hidden />
									Link erneuern
								</Button>
								<Button
									type="button"
									variant="destructive"
									disabled={subscriptionBusy}
									onClick={() => setSubscriptionConfirm('revoke')}
									className="min-h-11"
								>
									<Trash2 data-icon="inline-start" aria-hidden />
									Abo widerrufen
								</Button>
							</div>
							{copyState === 'failed' && (
								<Alert variant="destructive">
									<AlertDescription>
										Kopieren fehlgeschlagen. Markiere den Link und kopiere ihn manuell.
									</AlertDescription>
								</Alert>
							)}
							<details className="rounded-lg border border-border px-3 py-2">
								<summary className="cursor-pointer text-sm font-medium">
									Apple- und Android-Anleitung
								</summary>
								<div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
									<div>
										<p className="font-medium text-foreground">Apple (iPhone/iPad)</p>
										<p>
											Kalender-App → Kalender → Kalender hinzufügen → Abonnementkalender hinzufügen.
											Den Feed-Link einfügen.
										</p>
									</div>
									<div>
										<p className="font-medium text-foreground">Android (Google Kalender)</p>
										<p>
											Google Kalender am Computer im Browser öffnen → Weitere Kalender → + → Über
											URL. Den Feed-Link einfügen; die Android-App unterstützt das Hinzufügen per
											URL nicht direkt.
										</p>
									</div>
								</div>
							</details>
							<p className="text-xs text-muted-foreground">
								Der Feed enthält WG-Termine. Putzplan-Aufgaben bleiben in ManaWG und werden nicht
								exportiert.
							</p>
						</div>
					) : (
						<Button
							type="button"
							disabled={subscriptionBusy}
							onClick={() => void saveSubscription('POST', 'Kalender-Feed erstellt.')}
							className="min-h-11 max-w-full self-start whitespace-normal text-left"
						>
							{subscriptionBusy ? <Loader2 data-icon="inline-start" aria-hidden /> : null}
							Kalender-Feed erstellen
						</Button>
					)}
					{subscriptionNotice && (
						<Alert>
							<AlertDescription aria-live="polite">{subscriptionNotice}</AlertDescription>
						</Alert>
					)}
				</div>
			</details>

			<p className="text-center text-xs text-muted-foreground">
				Putzplan-Aufgaben erscheinen automatisch in dieser Liste, werden aber nicht in den
				Kalender-Feed übernommen.
				<Link
					href={`${wgBaseHref}/putzen`}
					className="ml-1 inline-flex min-h-11 items-center rounded-sm underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					Putzplan öffnen
				</Link>
			</p>

			<EventCreateModal
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				onSubmit={handleCreate}
				defaultDate={selectedDay ?? undefined}
			/>
			<EventEditModal
				event={editing}
				onClose={() => setEditing(null)}
				onUpdate={handleUpdate}
				onDelete={handleDelete}
				actionError={actionError}
			/>
			<ConfirmDialog
				open={subscriptionConfirm !== null}
				onClose={() => setSubscriptionConfirm(null)}
				onConfirm={() => {
					if (subscriptionConfirm === 'rotate') {
						void saveSubscription('PATCH', 'Kalender-Feed erneuert.');
					} else {
						void revokeSubscription();
					}
				}}
				title={
					subscriptionConfirm === 'rotate' ? 'Feed-Link erneuern?' : 'Kalender-Feed widerrufen?'
				}
				description={
					subscriptionConfirm === 'rotate'
						? 'Der bisherige Link wird sofort ungültig. Kalender-Apps müssen mit dem neuen Link aktualisiert werden.'
						: 'Der bisherige Link funktioniert sofort nicht mehr. Du kannst später einen neuen Feed erstellen.'
				}
				confirmLabel={subscriptionConfirm === 'rotate' ? 'Link erneuern' : 'Widerrufen'}
				variant={subscriptionConfirm === 'revoke' ? 'danger' : 'default'}
				icon={subscriptionConfirm === 'revoke' ? Trash2 : RefreshCw}
			/>
		</div>
	);
}
