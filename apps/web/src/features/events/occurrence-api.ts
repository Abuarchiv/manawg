import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
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

// A retry of the same change reuses its key, so a change whose answer was lost is replayed by
// the server instead of failing with "occurrence not found".
const pendingKeys = new Map<string, string>();

/** `payload` null cancels the date; otherwise the date becomes a single event with these values. */
export async function postOccurrenceChange<E>(
	eventsBaseUrl: string,
	memberId: string,
	eventId: string,
	occurrenceStartsAt: string,
	payload: OccurrencePayload | null,
) {
	const requestId = JSON.stringify([eventId, occurrenceStartsAt, payload]);
	const idempotencyKey = pendingKeys.get(requestId) ?? createIdempotencyKey();
	// Without a key a lost answer could not be replayed, so nothing is sent.
	if (!idempotencyKey)
		return { ok: false as const, status: 0, error: 'idempotency_key_unavailable' };
	pendingKeys.set(requestId, idempotencyKey);
	const res = await apiFetch<{ event: E; created: E | null }>(
		`${eventsBaseUrl}/${encodeURIComponent(eventId)}/occurrence`,
		{
			method: 'POST',
			memberId,
			headers: { 'Idempotency-Key': idempotencyKey },
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
	// A definitive answer (also a refusal) ends the attempt; a lost, rate-limited or failed one
	// keeps the key.
	if (res.ok || shouldReleaseIdempotencyKey(res.status, res.error)) pendingKeys.delete(requestId);
	return res;
}
