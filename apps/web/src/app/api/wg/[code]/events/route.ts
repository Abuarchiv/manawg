import { recordAuditEvent } from '@/core/audit';
import { db, wgEvents } from '@/core/db';
import { badRequest, serverError, tooMany } from '@/core/errors';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import { computeRecurrenceLookbackStart } from '@/features/events/event-reminder-window';
import {
	EVENTS_LIST_LIMIT,
	type SerializedWgEvent,
	formatRecurrenceRule,
	parseRecurrenceRule,
	serializeWgEvent,
} from '@/features/events/events';
import { and, asc, eq, gte, isNotNull, lte, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2_000;
const LOCATION_MAX = 200;
const RECURRENCE_MAX = 200;

type EventCreateWarning = null | 'notification_delivery_failed' | 'notification_delivery_unknown';

const createSchema = z.object({
	title: z.string().trim().min(1).max(TITLE_MAX),
	description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
	startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }).nullable().optional(),
	allDay: z.boolean().optional().default(false),
	location: z.string().trim().max(LOCATION_MAX).nullable().optional(),
	recurrence: z.string().trim().max(RECURRENCE_MAX).nullable().optional(),
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
		const windowFilter =
			from && to
				? or(
						and(gte(wgEvents.startsAt, from), lte(wgEvents.startsAt, to)),
						// include recurring rows that may produce occurrences in window
						and(
							isNotNull(wgEvents.recurrence),
							lte(wgEvents.startsAt, to),
							gte(wgEvents.startsAt, computeRecurrenceLookbackStart(from)),
						),
					)
				: undefined;
		const where = windowFilter ? and(wgFilter, windowFilter) : wgFilter;

		const rows = await db
			.select()
			.from(wgEvents)
			.where(where)
			.orderBy(asc(wgEvents.startsAt))
			.limit(EVENTS_LIST_LIMIT);

		const events: SerializedWgEvent[] = rows.map(serializeWgEvent);
		return NextResponse.json({ events });
	},
	{
		fixture: () => {
			return NextResponse.json(
				{ events: [] },
				{ headers: { 'Cache-Control': 'private, no-store' } },
			);
		},
	},
);

export const POST = withWgRoute('events POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
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

	return withIdempotentJsonResponse(
		req,
		`event-create:${wg.id}:${auth.member.memberId}`,
		async () => {
			const limit = await checkRateLimit(wgWriteLimiter, `events:${wg.id}:${auth.member.memberId}`);
			if (!limit.success) return tooMany('rate_limited');

			const [row] = await db
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
			if (!row) return serverError('insert_failed');

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

			const { warning }: { warning: EventCreateWarning } = await dispatchNotificationSafely({
				wg: { id: wg.id, name: wg.name, shareCode: code },
				event: 'event.created',
				payload: {
					eventId: row.id,
					title: row.title,
					startsAt: row.startsAt.toISOString(),
					actorName: auth.member.name,
				},
				excludeMemberId: auth.member.memberId,
			});

			return NextResponse.json({ event: serializeWgEvent(row), warning });
		},
	);
});
