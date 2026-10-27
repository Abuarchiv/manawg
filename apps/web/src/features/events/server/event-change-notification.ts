import 'server-only';
import { afterResponse } from '@/core/infra/after-response';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an event stops mattering: its end, or for an all-day event the end of its day. */
export function eventRelevantUntil(startsAt: number, endsAt: number | null, allDay: boolean) {
	return endsAt ?? (allDay ? startsAt + DAY_MS : startsAt);
}

interface EventChange {
	wg: { id: string; name: string; shareCode: string };
	actor: { memberId: string; name: string };
	/** Omitted when the event is deleted, so the push links to the calendar. */
	eventId?: string | undefined;
	title: string;
	startsAt: string;
	allDay: boolean;
	recurring?: boolean;
	/** Old and new start of a single event; a start within a day makes the push urgent. */
	affectedStarts?: readonly number[];
}

/**
 * Tells the other members that an event moved or was cancelled. The push runs after
 * the response, so saving never waits on delivery; the actor is left out.
 */
export function notifyEventChange(event: 'event.moved' | 'event.cancelled', change: EventChange) {
	// Someone with quiet hours still has to hear tonight that tomorrow morning's event is off.
	const now = Date.now();
	const urgent = (change.affectedStarts ?? []).some(
		(startsAt) => startsAt > now - DAY_MS && startsAt - now < DAY_MS,
	);
	afterResponse(() =>
		dispatchNotificationSafely({
			wg: change.wg,
			event,
			payload: {
				eventId: change.eventId,
				title: change.title,
				startsAt: change.startsAt,
				allDay: change.allDay,
				recurring: change.recurring === true,
				actorName: change.actor.name,
			},
			excludeMemberId: change.actor.memberId,
			urgent,
		}),
	);
}

type OccurrenceBody =
	| { action: 'cancel'; occurrenceStartsAt: string }
	| {
			action: 'detach';
			occurrenceStartsAt: string;
			title: string;
			startsAt: string;
			allDay: boolean;
	  };

/**
 * Notifies about a freshly written occurrence change: a cancelled occurrence, or a detached
 * one that moved to another date, time or to/from all-day. Occurrences that are over, moves
 * into the past and title-only edits stay silent.
 */
export function notifyOccurrenceChange(input: {
	body: OccurrenceBody;
	result: { event: { title: string; allDay: boolean }; created: { id: string } | null } | null;
	eventId: string;
	wg: EventChange['wg'];
	actor: EventChange['actor'];
}): void {
	const { body, result, wg, actor } = input;
	if (!result) return;
	const now = Date.now();
	if (body.action === 'cancel') {
		const startsAt = Date.parse(body.occurrenceStartsAt);
		if (eventRelevantUntil(startsAt, null, result.event.allDay) < now) return;
		notifyEventChange('event.cancelled', {
			wg,
			actor,
			eventId: input.eventId,
			title: result.event.title,
			startsAt: body.occurrenceStartsAt,
			allDay: result.event.allDay,
			affectedStarts: [startsAt],
		});
		return;
	}
	const from = Date.parse(body.occurrenceStartsAt);
	const to = Date.parse(body.startsAt);
	if (from === to && body.allDay === result.event.allDay) return;
	if (eventRelevantUntil(to, null, body.allDay) < now) return;
	notifyEventChange('event.moved', {
		wg,
		actor,
		eventId: result.created?.id,
		title: body.title,
		startsAt: body.startsAt,
		allDay: body.allDay,
		affectedStarts: [from, to],
	});
}
