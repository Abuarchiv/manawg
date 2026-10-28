import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { useCachedFetch } from '@/core/hooks/use-cached-fetch';
import { isNetworkError } from '@/core/http/error-codes';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	type CalendarEvent,
	type ChoreSummary,
	buildChoreOccurrences,
	eventToInput,
} from '@/features/events/calendar-page-model';
import type { CreateEventPayload } from '@/features/events/components/EventCreateModal';
import type {
	EditableEvent,
	UpdateEventPayload,
} from '@/features/events/components/EventEditModal';
import { eventSaveError, isEventGone } from '@/features/events/event-save-errors';
import {
	type EventOccurrence,
	expandAgendaRecurrence,
	expandRecurrence,
	getCalendarDayBounds,
	getMonthBounds,
} from '@/features/events/events';
import { postOccurrenceChange } from '@/features/events/occurrence-api';
import { type Message, useMessage } from '@/shared/i18n/message';
import { haptic } from '@/shared/lib/haptics';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

type CalendarCreateResponse = {
	event: CalendarEvent;
	warning: null | 'notification_delivery_failed' | 'notification_delivery_unknown';
};

const UPCOMING_DAYS = 30;

function subject(
	key: 'saveSubject' | 'updateSubject' | 'deleteSubject' | 'changeSubject',
): Message {
	return { key: `events.errors.${key}` };
}

/** Loads events and cleaning-plan due dates; create/update/delete optimistically. */
export function useCalendarPage(month: Date) {
	const { wg, identity } = useWg();
	const toast = useToast();
	const t = useTranslations('events');
	const render = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const eventsBaseUrl = `/api/wg/${encodedShareCode}/events`;

	const calendarEventsUrl = useMemo(() => {
		const bounds = getMonthBounds(month);
		const upcomingFrom = new Date();
		const upcomingTo = new Date(upcomingFrom.getTime() + UPCOMING_DAYS * MS_PER_DAY);
		const fromParam = new Date(
			Math.min(bounds.start.getTime(), getCalendarDayBounds(upcomingFrom).start.getTime()),
		).toISOString();
		const toParam = new Date(
			Math.max(bounds.end.getTime(), getCalendarDayBounds(upcomingTo).end.getTime()),
		).toISOString();
		return `${eventsBaseUrl}?from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}`;
	}, [eventsBaseUrl, month]);
	const choresUrl = `/api/wg/${encodedShareCode}/chores`;

	const {
		data: cachedChores,
		error: choresReadError,
		refresh: refreshChores,
	} = useCachedFetch<{ chores: ChoreSummary[] }>(choresUrl, { memberId: identity.memberId });
	const chores = useMemo<ChoreSummary[]>(
		() => cachedChores?.chores.map(({ id, title, nextDueAt }) => ({ id, title, nextDueAt })) ?? [],
		[cachedChores],
	);

	// Events are no offline actions, so the collection has no offline queue. The URL follows the
	// month; the shown events stay until the new range arrives.
	const monthCachedRef = useRef(false);
	const collection = useSyncedCollection<{ events: CalendarEvent[] }, CalendarEvent>({
		url: calendarEventsUrl,
		memberId: identity.memberId,
		select: (data) => data.events,
		assemble: (nextEvents, current) => ({ ...current, events: nextEvents }),
		getId: (event) => event.id,
		// Offline, the events on screen may belong to another month's window; say so instead of
		// showing that month as empty.
		describeError: (error): string =>
			collection.hasData() && !monthCachedRef.current && isNetworkError(error.error, error.status)
				? t('load.monthOffline')
				: t('load.events'),
		// Offline with this month on screen: keep showing it, no error state.
		hideError: (error, { hasData }) =>
			hasData && monthCachedRef.current && isNetworkError(error.error, error.status),
		// The chores side read refreshes with every events load, including the poll.
		reload: (reason) => {
			void refreshChores();
			void collection.load(reason === 'mount' ? {} : { silent: true });
		},
	});
	monthCachedRef.current = collection.data !== undefined;
	const { items: events, commit, pending, load: loadEvents } = collection;
	const choresError =
		choresReadError &&
		!(cachedChores && isNetworkError(choresReadError.error, choresReadError.status))
			? t('load.chores')
			: null;
	const loadError = collection.loadError ?? choresError;
	const loading = collection.initialLoading || (!cachedChores && !choresReadError);
	const createEventRequestRef = useRef<PendingIdempotentRequest | null>(null);

	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditingState] = useState<EditableEvent | null>(null);
	const [editingOccurrence, setEditingOccurrence] = useState<EventOccurrence | null>(null);
	// Closing the drawer also drops the occurrence it was opened on, so the next event starts clean.
	function setEditing(event: EditableEvent | null): void {
		setEditingState(event);
		if (event === null) setEditingOccurrence(null);
	}
	const [actionError, setActionError] = useState<string | null>(null);

	// A conflict means the shown list is stale: fetch again even if a GET is already running.
	function reloadAfterConflict(): void {
		void loadEvents({ silent: true, afterMutation: true });
	}

	const monthOccurrences = useMemo<EventOccurrence[]>(() => {
		const bounds = getMonthBounds(month);
		return events.flatMap((event) =>
			expandRecurrence(eventToInput(event), bounds.start, bounds.end),
		);
	}, [events, month]);

	const upcomingOccurrences = useMemo<EventOccurrence[]>(() => {
		const from = new Date();
		const to = new Date(from.getTime() + UPCOMING_DAYS * MS_PER_DAY);
		const all = events.flatMap((event) => expandAgendaRecurrence(eventToInput(event), from, to));
		return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
	}, [events]);

	// For series, the agenda names the interval; the occurrence itself only carries a flag.
	const recurrenceByEventId = useMemo(
		() => new Map(events.map((event) => [event.id, event.recurrence])),
		[events],
	);

	const upcomingChoreOccurrences = useMemo(() => {
		// From the start of today: a chore due this morning is still today's chore.
		const from = new Date();
		const to = new Date(from.getTime() + UPCOMING_DAYS * MS_PER_DAY);
		from.setHours(0, 0, 0, 0);
		return buildChoreOccurrences(chores, from, to);
	}, [chores]);

	// The month grid is not limited to the agenda's 30 days.
	const monthChoreOccurrences = useMemo(() => {
		const bounds = getMonthBounds(month);
		return buildChoreOccurrences(chores, bounds.start, bounds.end);
	}, [chores, month]);

	function selectOccurrence(occurrence: EventOccurrence): void {
		const event = events.find((e) => e.id === occurrence.eventId);
		// An optimistic row has no server id yet; editing it would PATCH a non-existent event.
		if (!event || event.id.startsWith('pending:')) return;
		setActionError(null);
		setEditingOccurrence(occurrence);
		setEditing(event);
	}

	function openCreate(): void {
		setActionError(null);
		setCreateOpen(true);
	}

	async function createEvent(payload: CreateEventPayload): Promise<void> {
		const fingerprint = JSON.stringify(payload);
		const idempotencyKey = resolveIdempotencyKey(createEventRequestRef.current, fingerprint);
		if (!idempotencyKey) throw new Error(t('errors.keyUnavailableSend'));
		createEventRequestRef.current = { fingerprint, key: idempotencyKey };
		const optimisticId = `pending:${idempotencyKey}`;
		const optimisticEvent: CalendarEvent = {
			id: optimisticId,
			...payload,
			createdByMemberId: identity.memberId,
		};
		// The overlay keeps the optimistic row through a poll that lands while the POST runs.
		pending.set(optimisticEvent);
		commit((current) => [...current, optimisticEvent]);
		const res = await apiFetch<CalendarCreateResponse>(eventsBaseUrl, {
			method: 'POST',
			memberId: identity.memberId,
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify(payload),
		});
		pending.delete(optimisticId);
		if (!res.ok) {
			if (shouldReleaseIdempotencyKey(res.status, res.error)) createEventRequestRef.current = null;
			commit((current) => current.filter((event) => event.id !== optimisticId));
			const message = render(eventSaveError(subject('saveSubject'), res));
			toast.error(message);
			throw new Error(message);
		}
		createEventRequestRef.current = null;
		haptic('medium');
		commit((current) => {
			const withoutOptimistic = current.filter((event) => event.id !== optimisticId);
			return withoutOptimistic.some((event) => event.id === res.data.event.id)
				? withoutOptimistic
				: [...withoutOptimistic, res.data.event];
		});
		setCreateOpen(false);
		if (res.data.warning) {
			toast.info(t('toast.savedPushUnconfirmed'));
		} else {
			toast.success(t('toast.saved'));
		}
	}

	async function updateEvent(id: string, payload: UpdateEventPayload): Promise<void> {
		setActionError(null);
		const previous = events.find((event) => event.id === id);
		if (previous) {
			pending.set({ ...previous, ...payload });
			commit((current) =>
				current.map((event) => (event.id === id ? { ...event, ...payload } : event)),
			);
		}
		const res = await apiFetch<{ event: CalendarEvent }>(
			`${eventsBaseUrl}/${encodeURIComponent(id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify(payload),
			},
		);
		pending.delete(id);
		if (!res.ok) {
			if (isEventGone(res)) {
				commit((current) => current.filter((event) => event.id !== id));
			} else if (previous) {
				commit((current) => current.map((event) => (event.id === id ? previous : event)));
			}
			const message = render(eventSaveError(subject('updateSubject'), res));
			if (res.error === 'event_changed') reloadAfterConflict();
			toast.error(message);
			throw new Error(message);
		}
		commit((current) => current.map((event) => (event.id === id ? res.data.event : event)));
		setEditing(null);
	}

	async function deleteEvent(id: string): Promise<void> {
		setActionError(null);
		const previousEventIndex = events.findIndex((event) => event.id === id);
		const previousEvent = events[previousEventIndex];
		commit((current) => current.filter((event) => event.id !== id));
		const res = await apiFetch<unknown>(`${eventsBaseUrl}/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			memberId: identity.memberId,
		});
		// Already deleted by someone else: goal reached, do not restore.
		if (!res.ok && !isEventGone(res)) {
			if (previousEvent) {
				commit((current) => {
					if (current.some((event) => event.id === id)) return current;
					const restored = [...current];
					restored.splice(Math.min(previousEventIndex, restored.length), 0, previousEvent);
					return restored;
				});
			}
			const message = render(eventSaveError(subject('deleteSubject'), res));
			setActionError(message);
			toast.error(message);
			return;
		}
		commit((current) => current.filter((event) => event.id !== id));
		setEditing(null);
		if (res.ok) toast.success(t('toast.deleted'));
	}

	/** One date of a series: cancel it, or replace it with a single event built from `payload`. */
	async function changeOccurrence(
		id: string,
		occurrenceStartsAt: string,
		payload: UpdateEventPayload | null,
	): Promise<void> {
		setActionError(null);
		const res = await postOccurrenceChange<CalendarEvent>(
			eventsBaseUrl,
			identity.memberId,
			id,
			occurrenceStartsAt,
			payload,
		);
		if (!res.ok) {
			if (isEventGone(res)) {
				commit((current) => current.filter((event) => event.id !== id));
			}
			// Status 0 with `idempotency_key_unavailable` ends in eventSaveError's fallback text.
			const message = render(eventSaveError(subject('changeSubject'), res));
			if (res.status === 409 || res.status === 404) reloadAfterConflict();
			toast.error(message);
			throw new Error(message);
		}
		const { event, created } = res.data;
		commit((current) => [
			...current.map((item) => (item.id === id ? event : item)),
			// A refresh that ran in between may already hold the detached event.
			...(created && !current.some((item) => item.id === created.id) ? [created] : []),
		]);
		setEditing(null);
		toast.success(payload ? t('toast.changed') : t('toast.removed'));
	}

	return {
		eventCount: events.length,
		loading,
		loadError,
		reload: async (): Promise<void> => {
			await Promise.all([refreshChores(), loadEvents()]);
		},
		monthOccurrences,
		upcomingOccurrences,
		recurrenceByEventId,
		upcomingChoreOccurrences,
		monthChoreOccurrences,
		createOpen,
		setCreateOpen,
		editing,
		setEditing,
		/** Opens an event on its own, with no occurrence left over from an earlier one. */
		openEvent: (event: EditableEvent) => {
			setEditingOccurrence(null);
			setEditingState(event);
		},
		editingOccurrence,
		actionError,
		selectOccurrence,
		openCreate,
		createEvent,
		updateEvent,
		deleteEvent,
		updateOccurrence: (id: string, occurrenceStartsAt: string, payload: UpdateEventPayload) =>
			changeOccurrence(id, occurrenceStartsAt, payload),
		deleteOccurrence: (id: string, occurrenceStartsAt: string) =>
			changeOccurrence(id, occurrenceStartsAt, null),
	};
}
