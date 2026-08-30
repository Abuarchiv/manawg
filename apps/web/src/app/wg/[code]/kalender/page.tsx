'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ALERT_DANGER } from '@/components/ui/styles';
import { BackLink } from '@/components/wg/BackLink';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
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
import { useCallback, useEffect, useMemo, useState } from 'react';

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
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [events, setEvents] = useState<CalendarEvent[]>([]);
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
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
	const [subscriptionConfirm, setSubscriptionConfirm] = useState<'rotate' | 'revoke' | null>(null);
	const subscriptionEndpoint = `/api/wg/${encodedShareCode}/calendar-subscription`;

	const load = useCallback(
		async (isInitial: boolean): Promise<void> => {
			if (isInitial) setLoading(true);
			const bounds = getMonthBounds(month);
			const upcomingTo = new Date(Date.now() + UPCOMING_DAYS * MS_PER_DAY);
			const fromParam = bounds.start.toISOString();
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
		const res = await apiFetch<{ event: CalendarEvent }>(`/api/wg/${encodedShareCode}/events`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			throw new Error('Termin konnte nicht gespeichert werden.');
		}
		haptic('medium');
		setEvents((current) => [...current, res.data.event]);
		setCreateOpen(false);
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
		const res = await apiFetch<CalendarSubscriptionResponse>(subscriptionEndpoint, {
			method,
			memberId: identity.memberId,
			memberToken: identity.memberToken,
		});
		if (res.ok && res.data.subscription) {
			setSubscription(res.data.subscription);
			setCopyState('idle');
			setSubscriptionNotice(message);
		} else {
			setSubscriptionError('Kalender-Feed konnte nicht gespeichert werden.');
		}
		setSubscriptionBusy(false);
	}

	async function revokeSubscription(): Promise<void> {
		setSubscriptionBusy(true);
		setSubscriptionError(null);
		setSubscriptionNotice(null);
		const res = await apiFetch<unknown>(subscriptionEndpoint, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
		});
		if (res.ok) {
			setSubscription(null);
			setCopyState('idle');
			setSubscriptionNotice('Kalender-Feed widerrufen.');
		} else {
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

	function handleViewToggle(): void {
		haptic('light');
		setView((v) => (v === 'month' ? 'list' : 'month'));
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
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center justify-between gap-3">
				<BackLink href={`${wgBaseHref}/pinnwand`} label="Pinnwand" />
				<div className="min-w-0 flex-1">
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						Kalender
					</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						{loading ? '' : `${events.length} Termin${events.length === 1 ? '' : 'e'}`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{/* Zurück zum aktuellen Monat */}
					{!isCurrentMonth && (
						<button
							type="button"
							onClick={handleJumpToToday}
							aria-label="Zum aktuellen Monat springen"
							title="Heute"
							className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							<RotateCcw className="h-4 w-4" aria-hidden />
						</button>
					)}
					{/* View toggle: 44px tap target */}
					<button
						type="button"
						onClick={handleViewToggle}
						aria-label={view === 'month' ? 'Listenansicht öffnen' : 'Monatsansicht öffnen'}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						{view === 'month' ? (
							<List className="h-4 w-4" aria-hidden />
						) : (
							<CalendarDays className="h-4 w-4" aria-hidden />
						)}
					</button>
					{/* FAB: .fab-mobile primitive handles fixed positioning + safe-area on mobile */}
					<button
						type="button"
						onClick={handleFabClick}
						aria-label="Neuen Termin anlegen"
						className="fab-mobile inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<Plus className="h-5 w-5" aria-hidden />
					</button>
				</div>
			</header>

			{actionError && (
				<div role="alert" className={ALERT_DANGER}>
					{actionError}
				</div>
			)}

			{loadError && (
				<div
					role="alert"
					className="flex items-center justify-between gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
				>
					<span>{loadError}</span>
					<button
						type="button"
						onClick={() => void load(true)}
						className="inline-flex h-11 items-center rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Erneut laden
					</button>
				</div>
			)}

			<section
				aria-labelledby="calendar-subscription-heading"
				className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 p-4"
			>
				<div>
					<h2
						id="calendar-subscription-heading"
						className="text-[14px] font-semibold text-[var(--text-1)]"
					>
						Kalender abonnieren
					</h2>
					<p className="mt-1 text-[12.5px] text-[var(--text-3)]">
						Neue WG-Termine automatisch in Apple Kalender oder Google Kalender erhalten.
					</p>
				</div>
				{subscriptionError && (
					<div role="alert" className={ALERT_DANGER}>
						{subscriptionError}
					</div>
				)}
				{subscriptionLoading ? (
					<p className="text-[12.5px] text-[var(--text-3)]">Feed wird geladen…</p>
				) : subscription ? (
					<div className="space-y-3">
						<label
							htmlFor="calendar-feed-url"
							className="block text-[12px] font-medium text-[var(--text-2)]"
						>
							Persönlicher Feed-Link
						</label>
						<div className="flex gap-2">
							<input
								id="calendar-feed-url"
								type="url"
								readOnly
								value={subscription.feedUrl}
								className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text-2)] outline-none"
							/>
							<button
								type="button"
								onClick={() => void copySubscriptionUrl()}
								className="inline-flex h-11 shrink-0 items-center rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{copyState === 'copied' ? 'Kopiert' : 'Link kopieren'}
							</button>
						</div>
						<div className="flex flex-wrap gap-2">
							<a
								href={subscription.feedUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								<ExternalLink className="h-3.5 w-3.5" aria-hidden />
								Feed öffnen
							</a>
							<button
								type="button"
								disabled={subscriptionBusy}
								onClick={() => setSubscriptionConfirm('rotate')}
								className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
							>
								<RefreshCw className="h-3.5 w-3.5" aria-hidden />
								Link erneuern
							</button>
							<button
								type="button"
								disabled={subscriptionBusy}
								onClick={() => setSubscriptionConfirm('revoke')}
								className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
							>
								<Trash2 className="h-3.5 w-3.5" aria-hidden />
								Abo widerrufen
							</button>
						</div>
						{copyState === 'failed' && (
							<p role="alert" className="text-[12px] text-[var(--danger)]">
								Kopieren fehlgeschlagen. Markiere den Link und kopiere ihn manuell.
							</p>
						)}
						<details className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2">
							<summary className="cursor-pointer text-[12.5px] font-medium text-[var(--text-1)]">
								Apple- und Android-Anleitung
							</summary>
							<div className="mt-3 space-y-3 text-[12.5px] leading-relaxed text-[var(--text-2)]">
								<div>
									<p className="font-medium text-[var(--text-1)]">Apple (iPhone/iPad)</p>
									<p>
										Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo
										hinzufügen. Den Feed-Link einfügen.
									</p>
								</div>
								<div>
									<p className="font-medium text-[var(--text-1)]">Android (Google Kalender)</p>
									<p>
										Google Kalender im Browser öffnen → Weitere Kalender → Über URL hinzufügen. Den
										Feed-Link einfügen.
									</p>
								</div>
							</div>
						</details>
						<p className="text-[11.5px] text-[var(--text-3)]">
							Der Feed enthält WG-Termine. Putzplan-Aufgaben bleiben in ManaWG und werden nicht
							exportiert.
						</p>
					</div>
				) : (
					<button
						type="button"
						disabled={subscriptionBusy}
						onClick={() => void saveSubscription('POST', 'Kalender-Feed erstellt.')}
						className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{subscriptionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
						Kalender-Feed erstellen
					</button>
				)}
				{subscriptionNotice && (
					<output className="block text-[12px] text-[var(--accent)]" aria-live="polite">
						{subscriptionNotice}
					</output>
				)}
			</section>

			{view === 'month' ? (
				<CalendarMonth
					month={month}
					occurrences={monthOccurrences}
					onPrev={handlePrevMonth}
					onNext={handleNextMonth}
					onSelectDay={handleDaySelect}
					onSelectOccurrence={handleSelectOccurrence}
					selectedDay={selectedDay}
				/>
			) : null}

			<section className="space-y-3">
				<h2 className="text-[14px] font-semibold text-[var(--text-1)]">Nächste 30 Tage</h2>
				<CalendarUpcomingList
					occurrences={upcomingOccurrences}
					choreOccurrences={upcomingChoreOccurrences}
					onSelect={handleSelectOccurrence}
					wgBaseHref={wgBaseHref}
				/>
			</section>

			<p className="text-center text-[12px] text-[var(--text-3)]">
				Putzplan-Aufgaben erscheinen automatisch in dieser Liste, werden aber nicht in den
				Kalender-Feed übernommen.
				<Link
					href={`${wgBaseHref}/putzen`}
					className="ml-1 inline-flex min-h-11 items-center rounded-sm underline transition-colors hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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
