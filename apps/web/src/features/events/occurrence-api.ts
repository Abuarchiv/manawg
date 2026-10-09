import { apiFetch } from '@/core/infra/api-client';

interface OccurrencePayload {
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	/** The series version the form was opened on; a newer one rejects the change. */
	expectedUpdatedAt?: string | undefined;
}

/** `payload` null cancels the date; otherwise the date becomes a single event with these values. */
export function postOccurrenceChange<E>(
	eventsBaseUrl: string,
	memberId: string,
	eventId: string,
	occurrenceStartsAt: string,
	payload: OccurrencePayload | null,
) {
	return apiFetch<{ event: E; created: E | null }>(
		`${eventsBaseUrl}/${encodeURIComponent(eventId)}/occurrence`,
		{
			method: 'POST',
			memberId,
			body: JSON.stringify(
				payload
					? {
							action: 'detach',
							occurrenceStartsAt,
							title: payload.title,
							description: payload.description,
							startsAt: payload.startsAt,
							endsAt: payload.endsAt,
							allDay: payload.allDay,
							location: payload.location,
							expectedUpdatedAt: payload.expectedUpdatedAt,
						}
					: { action: 'cancel', occurrenceStartsAt },
			),
		},
	);
}
