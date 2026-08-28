'use client';

import { ALERT_DANGER } from '@/components/ui/styles';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { MS_PER_DAY } from '@/core/utils/time';
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
import { haptic } from '@manawg/shared/lib/haptics';
import { CalendarDays, List, Plus, RotateCw } from 'lucide-react';
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
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [view, setView] = useState<ViewMode>('month');
	const [month, setMonth] = useState<Date>(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});
	const [selectedDay, setSelectedDay] = useState<Date | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<EditableEvent | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const load = useCallback(
		async (isInitial: boolean): Promise<void> => {
			if (isInitial) setLoading(true);
			else setRefreshing(true);
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
			}
			setLoadError(nextError);
			if (isInitial) setLoading(false);
			else setRefreshing(false);
		},
		[encodedShareCode, identity.memberId, month],
	);

	useEffect(() => {
		void load(true);
	}, [load]);

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
			},
		);
		if (!res.ok) {
			setActionError('Termin konnte nicht gelöscht werden.');
			return;
		}
		setEvents((current) => current.filter((event) => event.id !== id));
		setEditing(null);
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
				<div>
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						Kalender
					</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						{loading ? '' : `${events.length} Termin${events.length === 1 ? '' : 'e'}`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{/* Refresh: secondary chrome, hidden on mobile */}
					<button
						type="button"
						onClick={() => void load(false)}
						disabled={loading || refreshing}
						aria-label="Kalender aktualisieren"
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						<RotateCw
							className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`}
							aria-hidden
						/>
					</button>
					{/* Heute: jump back when navigated away from current month */}
					{!isCurrentMonth && (
						<button
							type="button"
							onClick={handleJumpToToday}
							aria-label="Zum aktuellen Monat springen"
							className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[12px] font-medium text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
						>
							Heute
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
						className="fab-mobile"
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
				Tipp: Putzplan-Aufgaben erscheinen automatisch in der Liste —
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
		</div>
	);
}
