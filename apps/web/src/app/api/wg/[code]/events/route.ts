import { recordAuditEvent } from '@/core/audit';
import { db, idempotencyResponses, wgEvents } from '@/core/db';
import {
	completeClaimedResponse,
	lockClaimedResponse,
	releaseClaimedResponse,
} from '@/core/db/claimed-response';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { claimReplaySlotWithRetry } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	serverError,
	serviceUnavailable,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { getCachedResponse, readIdempotencyKey } from '@/core/idempotency-store';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	buildEventsWindowFilter,
	withEventWindowCandidates,
} from '@/features/events/event-reminder-window';
import {
	eventDateTimeSchema,
	eventDescriptionSchema,
	eventLocationSchema,
	eventRecurrenceSchema,
	eventTitleSchema,
} from '@/features/events/event-schemas';
import {
	type SerializedWgEvent,
	formatRecurrenceRule,
	parseRecurrenceRule,
	serializeWgEvent,
} from '@/features/events/events';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type EventCreateResponseBody = { event: SerializedWgEvent; warning: NotificationWarning };
type EventCreateReplayResponse<T = unknown> = { status: number; body: T };

function readEventCreateReplayResponse(value: unknown): EventCreateReplayResponse | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.status === 'number' &&
		Number.isInteger(record.status) &&
		record.status >= 200 &&
		record.status <= 599 &&
		'body' in record
	) {
		return { status: record.status, body: record.body };
	}
	return 'event' in record ? { status: 200, body: value as EventCreateResponseBody } : null;
}

function isEventCreateReplayable(value: unknown): value is unknown {
	return readEventCreateReplayResponse(value) !== null;
}

function replayEventCreateResponse(value: unknown): NextResponse {
	const replay = readEventCreateReplayResponse(value);
	return replay
		? NextResponse.json(replay.body, { status: replay.status })
		: serverError('idempotency_response_invalid');
}

const createSchema = z.object({
	title: eventTitleSchema,
	description: eventDescriptionSchema.optional(),
	startsAt: eventDateTimeSchema,
	endsAt: eventDateTimeSchema.nullable().optional(),
	allDay: z.boolean().optional().default(false),
	location: eventLocationSchema.optional(),
	recurrence: eventRecurrenceSchema.optional(),
});

function normalizeRecurrence(value: string | null | undefined): string | null {
	if (value === undefined || value === null || value.length === 0) return null;
	const parsed = parseRecurrenceRule(value);
	if (!parsed) return 'invalid';
	return formatRecurrenceRule(parsed);
}

export const GET = withWgRoute(
	'events GET',
	async (req, { code }) => {
		const limit = await checkRateLimit(wgReadLimiter, `events:${clientIpKey(req)}`);
		if (!limit.success) return tooMany('rate_limited');

		const url = new URL(req.url);
		const fromParam = url.searchParams.get('from');
		const toParam = url.searchParams.get('to');
		const from = fromParam ? new Date(fromParam) : null;
		const to = toParam ? new Date(toParam) : null;
		if (from !== null && Number.isNaN(from.getTime())) return badRequest('from_invalid');
		if (to !== null && Number.isNaN(to.getTime())) return badRequest('to_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;

		const wgFilter = eq(wgEvents.wgId, wg.id);
		const windowFilter = buildEventsWindowFilter(from, to);
		return withEventWindowCandidates(
			from,
			async (cursor, pageLimit) => {
				const cursorFilter = cursor
					? or(
							gt(wgEvents.startsAt, cursor.startsAt),
							and(eq(wgEvents.startsAt, cursor.startsAt), gt(wgEvents.id, cursor.id)),
						)
					: undefined;
				const baseFilter = windowFilter ? and(wgFilter, windowFilter) : wgFilter;
				const where = cursorFilter ? and(baseFilter, cursorFilter) : baseFilter;
				return db
					.select()
					.from(wgEvents)
					.where(where)
					.orderBy(asc(wgEvents.startsAt), asc(wgEvents.id))
					.limit(pageLimit);
			},
			() => serviceUnavailable('events_window_too_large'),
			(rows) => {
				const events: SerializedWgEvent[] = rows.map(serializeWgEvent);
				return NextResponse.json({ events });
			},
		);
	},
	{
		fixture: () => {
			return NextResponse.json({ events: [] });
		},
	},
);

export const POST = withWgRoute('events POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch (err) {
		return unreadableJsonBody(err);
	}
	const parsed = createSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.title) return badRequest('title_invalid');
		if (fieldErrors.startsAt) return badRequest('starts_at_invalid');
		if (fieldErrors.endsAt) return badRequest('ends_at_invalid');
		if (fieldErrors.description) return badRequest('description_invalid');
		if (fieldErrors.location) return badRequest('location_invalid');
		if (fieldErrors.recurrence) return badRequest('recurrence_invalid');
		return badRequest('invalid_body');
	}
	const startsAt = new Date(parsed.data.startsAt);
	const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
	if (endsAt && endsAt.getTime() < startsAt.getTime()) {
		return badRequest('ends_before_start');
	}
	const recurrence = normalizeRecurrence(parsed.data.recurrence ?? null);
	if (recurrence === 'invalid') return badRequest('recurrence_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const idemKey = readIdempotencyKey(req);
	const idemScope = idemKey ? `event-create:${wg.id}:${auth.member.memberId}` : null;
	if (idemScope && idemKey) {
		const cached = await getCachedResponse<unknown>(idemScope, idemKey);
		if (cached) return replayEventCreateResponse(cached);
	}

	const limit = await checkRateLimit(wgWriteLimiter, `events:${wg.id}:${auth.member.memberId}`);
	if (!limit.success) return tooMany('rate_limited');
	if (idemScope && idemKey) {
		const slot = await claimReplaySlotWithRetry<unknown>(idemScope, idemKey);
		if (!slot.won) return replayEventCreateResponse(slot.cached);
	}

	let written:
		| { replayed: true; response: EventCreateReplayResponse }
		| {
				replayed: false;
				row: typeof wgEvents.$inferSelect;
				response: EventCreateReplayResponse<EventCreateResponseBody>;
		  };
	const rollback = { claimExpiresAt: null as Date | null, failed: false, error: null as unknown };
	try {
		written = await withTransaction(async (tx) => {
			try {
				if (idemScope && idemKey) {
					const claim = await lockClaimedResponse(tx, idemScope, idemKey, isEventCreateReplayable);
					if (claim.kind === 'completed') {
						const replay = readEventCreateReplayResponse(claim.body);
						if (!replay) throw new TransactionAbort('idempotency_claim_invalid');
						return { replayed: true as const, response: replay };
					}
					rollback.claimExpiresAt = claim.leaseExpiresAt;
				}

				const [row] = await tx
					.insert(wgEvents)
					.values({
						wgId: wg.id,
						title: parsed.data.title,
						description: parsed.data.description ?? null,
						startsAt,
						endsAt,
						allDay: parsed.data.allDay ?? false,
						location: parsed.data.location ?? null,
						recurrence,
						createdByMemberId: auth.member.memberId,
					})
					.returning();
				if (!row) throw new TransactionAbort('insert_failed');
				const response: EventCreateReplayResponse<EventCreateResponseBody> = {
					status: 200,
					body: { event: serializeWgEvent(row), warning: null },
				};
				if (idemScope && idemKey && rollback.claimExpiresAt) {
					await completeClaimedResponse(tx, idemScope, idemKey, response, rollback.claimExpiresAt);
				}
				return { replayed: false as const, row, response };
			} catch (err) {
				rollback.failed = true;
				rollback.error = err;
				throw err;
			}
		});
	} catch (err) {
		if (
			rollback.failed &&
			err === rollback.error &&
			rollback.claimExpiresAt &&
			idemScope &&
			idemKey
		) {
			await releaseClaimedResponse(idemScope, idemKey, rollback.claimExpiresAt);
		}
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
	if (written.replayed) return replayEventCreateResponse(written.response);

	const row = written.row;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'event.created',
		entityType: 'wg_event',
		entityId: row.id,
		summary: `${auth.member.name} hat den Termin „${row.title}“ angelegt.`,
		metadata: {
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
			recurring: row.recurrence !== null,
		},
	});

	const { warning }: { warning: NotificationWarning } = await dispatchNotificationSafely({
		wg: { id: wg.id, name: wg.name, shareCode: code },
		event: 'event.created',
		payload: {
			eventId: row.id,
			title: row.title,
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
			actorName: auth.member.name,
		},
		excludeMemberId: auth.member.memberId,
	});

	let response: EventCreateReplayResponse<EventCreateResponseBody> = {
		...written.response,
		body: { ...written.response.body, warning },
	};
	if (idemScope && idemKey && warning !== null) {
		try {
			const updated = await db
				.update(idempotencyResponses)
				.set({
					responseBody: sql`jsonb_set(${idempotencyResponses.responseBody}, '{body,warning}', to_jsonb(${warning}::text))`,
				})
				.where(
					and(
						eq(idempotencyResponses.scope, idemScope),
						eq(idempotencyResponses.key, idemKey),
						gt(idempotencyResponses.expiresAt, new Date()),
						sql`${idempotencyResponses.responseBody}->'body'->'event'->>'id' = ${row.id}`,
						sql`${idempotencyResponses.responseBody}->'body'->'warning' = 'null'::jsonb`,
					),
				)
				.returning({ scope: idempotencyResponses.scope });
			if (updated.length !== 1) response = written.response;
		} catch {
			response = written.response;
			console.warn('[events POST] warning replay update failed');
		}
	}
	return replayEventCreateResponse(response);
});
