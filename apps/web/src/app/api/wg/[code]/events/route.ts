import { and, asc, eq, gt, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgEvents } from '@/core/db';
import { responseCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	rateLimitResponse,
	serverError,
	serviceUnavailable,
	tooMany,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import { isEventYearInRange } from '@/features/events/event-limits';
import {
	eventDateTimeSchema,
	eventDescriptionSchema,
	eventInstant,
	eventLocationSchema,
	eventRecurrenceSchema,
	eventTitleSchema,
} from '@/features/events/event-schemas';
import {
	canonicalRecurrenceRule,
	type SerializedWgEvent,
	serializeWgEvent,
} from '@/features/events/events';
import {
	buildEventsWindowFilter,
	withEventWindowCandidates,
} from '@/features/events/server/event-reminder-window';

type EventCreateResponseBody = { event: SerializedWgEvent; warning: NotificationWarning };
const eventCreateCodec = responseCodec();

const createSchema = z.object({
	title: eventTitleSchema,
	description: eventDescriptionSchema.optional(),
	startsAt: eventDateTimeSchema,
	endsAt: eventDateTimeSchema.nullable().optional(),
	allDay: z.boolean().optional().default(false),
	location: eventLocationSchema.optional(),
	recurrence: eventRecurrenceSchema.optional(),
});

export const GET = withWgRoute('events GET', async (req, { code }) => {
	const limit = rateLimitResponse(
		await checkRateLimit(wgReadLimiter, `events:${clientIpKey(req)}`),
		'rate_limited',
	);
	if (limit) return limit;

	const url = new URL(req.url);
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	const from = fromParam ? new Date(fromParam) : null;
	const to = toParam ? new Date(toParam) : null;
	if (from !== null && !isEventYearInRange(from)) return badRequest('from_invalid');
	if (to !== null && !isEventYearInRange(to)) return badRequest('to_invalid');
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
});

export const POST = withWgRoute('events POST', async (req, { code }) => {
	const parsed = await parseBody(req, createSchema, {
		fieldErrors: {
			title: 'title_invalid',
			startsAt: 'starts_at_invalid',
			endsAt: 'ends_at_invalid',
			description: 'description_invalid',
			location: 'location_invalid',
			recurrence: 'recurrence_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const { allDay } = parsed.data;
	const startsAt = eventInstant(parsed.data.startsAt, allDay);
	const endsAt = parsed.data.endsAt ? eventInstant(parsed.data.endsAt, allDay) : null;
	if (endsAt && endsAt.getTime() < startsAt.getTime()) {
		return badRequest('ends_before_start');
	}
	const recurrence = canonicalRecurrenceRule(parsed.data.recurrence);
	if (!recurrence.ok) return badRequest('recurrence_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const key = readIdempotencyKey(req);
	const scope = `event-create:${wg.id}:${auth.member.memberId}`;
	const data = parsed.data;
	const member = auth.member;
	const createEvent = () =>
		withIdempotentWrite(
			{
				scope,
				key,
				codec: eventCreateCodec,
				prepare: async () => {
					const limit = await checkRateLimit(wgWriteLimiter, `events:${wg.id}:${member.memberId}`);
					return limit.success ? { input: undefined } : { stop: tooMany('rate_limited') };
				},
			},
			async (tx) => {
				const [row] = await tx
					.insert(wgEvents)
					.values({
						wgId: wg.id,
						title: data.title,
						description: data.description ?? null,
						startsAt,
						endsAt,
						allDay: data.allDay ?? false,
						location: data.location ?? null,
						recurrence: recurrence.rule,
						createdByMemberId: member.memberId,
					})
					.returning();
				if (!row) throw new TransactionAbort('insert_failed');
				const body: EventCreateResponseBody = { event: serializeWgEvent(row), warning: null };
				return { status: 200, body, context: row };
			},
		);
	let result: Awaited<ReturnType<typeof createEvent>>;
	try {
		result = await createEvent();
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		if (err instanceof Error && err.message === 'idempotency_response_invalid') {
			return serverError('idempotency_response_invalid');
		}
		throw err;
	}
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'replayed' || !result.context) {
		return NextResponse.json(result.body, { status: result.status });
	}

	const row = result.context;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'event.created',
		entityType: 'wg_event',
		entityId: row.id,
		actorName: auth.member.name,
		metadata: {
			title: row.title,
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

	let responseWarning: NotificationWarning = warning;
	if (key && warning !== null) {
		try {
			const persisted = await setReplayWarning(
				scope,
				key,
				{
					match: [{ path: ['body', 'event', 'id'], equals: row.id }],
					warningPath: ['body', 'warning'],
					replaces: [null],
				},
				warning,
			);
			if (!persisted) responseWarning = null;
		} catch (err) {
			responseWarning = null;
			logApiError('[events POST] warning replay update failed', err);
		}
	}
	const body: EventCreateResponseBody = { event: serializeWgEvent(row), warning: responseWarning };
	return NextResponse.json(body, { status: result.status });
});
