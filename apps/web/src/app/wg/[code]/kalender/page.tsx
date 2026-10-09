'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { CalendarMonth } from '@/features/events/components/CalendarMonth';
import { CalendarSubscriptionSection } from '@/features/events/components/CalendarSubscriptionSection';
import {
	CalendarUpcomingList,
	downloadOccurrenceIcs,
} from '@/features/events/components/CalendarUpcomingList';
import { EventCreateModal } from '@/features/events/components/EventCreateModal';
import { EventEditModal } from '@/features/events/components/EventEditModal';
import { TimeZoneNotice } from '@/features/events/components/TimeZoneNotice';
import { useCalendarPage } from '@/features/events/hooks/use-calendar-page';
import { haptic } from '@/shared/lib/haptics';
import { CalendarDays, List, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type ViewMode = 'month' | 'list';

export default function KalenderPage() {
	const { wg, isAdmin, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [month, setMonth] = useState<Date>(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});
	const calendar = useCalendarPage(month);
	const highlightEventId = useSearchParams().get('highlight');
	const { loading, loadError, actionError, editingOccurrence } = calendar;
	// Liste als Default: eine WG hat selten mehr als eine Handvoll Termine im
	// Monat — das Grid ist die Ausnahme-Ansicht, nicht der Einstieg.
	const [view, setView] = useState<ViewMode>('list');
	const [selectedDay, setSelectedDay] = useState<Date | null>(null);

	// A push link to an event beyond the agenda window has nothing to highlight in the list:
	// open that event directly instead of landing on an unrelated page.
	const openedLinkedEventRef = useRef<string | null>(null);
	const { upcomingOccurrences, openEvent } = calendar;
	useEffect(() => {
		if (!highlightEventId || loading || openedLinkedEventRef.current === highlightEventId) return;
		openedLinkedEventRef.current = highlightEventId;
		if (upcomingOccurrences.some((occurrence) => occurrence.eventId === highlightEventId)) return;
		void apiFetch<{ event: NonNullable<typeof calendar.editing> }>(
			`/api/wg/${encodedShareCode}/events/${encodeURIComponent(highlightEventId)}`,
			{ memberId: identity.memberId },
		).then((res) => {
			if (res.ok) openEvent(res.data.event);
			// A failed lookup that may succeed later is retried on the next refresh.
			else if (res.status !== 404 && res.status !== 403) openedLinkedEventRef.current = null;
		});
	}, [
		highlightEventId,
		loading,
		upcomingOccurrences,
		openEvent,
		encodedShareCode,
		identity.memberId,
	]);

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
		calendar.openCreate();
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
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav />
			{/* Der Tab oben benennt die Seite schon; Titel und Zähler bleiben für Screenreader. */}
			<header className="sr-only">
				<h1>Kalender</h1>
				<p>
					{loading
						? 'Lädt…'
						: `${calendar.eventCount} WG-Termin${calendar.eventCount === 1 ? '' : 'e'}`}
				</p>
			</header>

			<TimeZoneNotice />

			{actionError && (
				<Alert variant="destructive">
					<AlertDescription>{actionError}</AlertDescription>
				</Alert>
			)}

			{loadError && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
						<span>{loadError}</span>
						<Button type="button" variant="outline" onClick={() => void calendar.reload()}>
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
				className="gap-2"
			>
				<div className="flex flex-wrap items-center justify-end gap-2">
					{view === 'month' && !isCurrentMonth && (
						<Button
							variant="outline"
							size="sm"
							className="mr-auto"
							onClick={handleJumpToToday}
							aria-label="Zum aktuellen Monat springen"
						>
							Heute
						</Button>
					)}
					<TabsList className="w-fit shrink-0">
						<TabsTrigger value="list" className="min-w-max whitespace-nowrap">
							<List data-icon="inline-start" aria-hidden />
							Agenda
						</TabsTrigger>
						<TabsTrigger value="month" className="min-w-max whitespace-nowrap">
							<CalendarDays data-icon="inline-start" aria-hidden />
							Monat
						</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent value="list" className="flex flex-col gap-3">
					<section aria-labelledby="calendar-upcoming-heading" className="flex flex-col gap-3">
						<h2 id="calendar-upcoming-heading" className="sr-only">
							Nächste 30 Tage
						</h2>
						{loading ? (
							// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
							<div
								role="status"
								aria-label="Agenda wird geladen"
								className="flex flex-col divide-y overflow-hidden rounded-xl border"
							>
								{[0, 1, 2].map((index) => (
									<Skeleton key={index} className="h-12 w-full rounded-none" />
								))}
								<span className="sr-only">Agenda wird geladen…</span>
							</div>
						) : loadError ? null : (
							<CalendarUpcomingList
								occurrences={calendar.upcomingOccurrences}
								choreOccurrences={calendar.upcomingChoreOccurrences}
								onSelect={calendar.selectOccurrence}
								wgBaseHref={wgBaseHref}
								recurrenceByEventId={calendar.recurrenceByEventId}
								highlightEventId={highlightEventId}
							/>
						)}
					</section>
				</TabsContent>
				<TabsContent value="month" className="flex flex-col gap-2">
					<CalendarMonth
						month={month}
						occurrences={calendar.monthOccurrences}
						onPrev={handlePrevMonth}
						onNext={handleNextMonth}
						onSelectDay={handleDaySelect}
						onSelectOccurrence={calendar.selectOccurrence}
						selectedDay={selectedDay}
						choreOccurrences={calendar.upcomingChoreOccurrences}
						wgBaseHref={wgBaseHref}
						status={loading ? 'loading' : loadError ? 'error' : undefined}
					/>
				</TabsContent>
			</Tabs>

			<CalendarSubscriptionSection encodedShareCode={encodedShareCode} />

			<EventCreateModal
				open={calendar.createOpen}
				onClose={() => calendar.setCreateOpen(false)}
				onSubmit={calendar.createEvent}
				defaultDate={selectedDay ?? undefined}
			/>
			<EventEditModal
				event={calendar.editing}
				onClose={() => calendar.setEditing(null)}
				onUpdate={calendar.updateEvent}
				onDelete={calendar.deleteEvent}
				occurrence={editingOccurrence}
				onUpdateOccurrence={calendar.updateOccurrence}
				onDeleteOccurrence={calendar.deleteOccurrence}
				actionError={actionError}
				readOnly={
					calendar.editing !== null &&
					!isAdmin &&
					calendar.editing.createdByMemberId !== undefined &&
					calendar.editing.createdByMemberId !== identity.memberId
				}
				onExportIcs={editingOccurrence ? () => downloadOccurrenceIcs(editingOccurrence) : undefined}
			/>
			<ThumbAction>
				<Button type="button" onClick={handleFabClick} className="min-h-11 w-full">
					<Plus data-icon="inline-start" aria-hidden />
					Termin hinzufügen
				</Button>
			</ThumbAction>
		</div>
	);
}
