import { and, eq, type SQL, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgEvents } from '@/core/db';
import { rowHoldsPatch } from '@/core/db/row-holds-patch';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, notFound, rateLimitResponse } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import { berlinDayKey } from '@/core/utils/berlin-day';
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
	parseRecurrenceRule,
	serializeWgEvent,
} from '@/features/events/events';
import { shiftedSeriesRule } from '@/features/events/recurrence-shift';
import {
	eventRelevantUntil,
	notifyEventChange,
} from '@/features/events/server/event-change-notification';

const patchSchema = z.object({
	title: eventTitleSchema.optional(),
	description: eventDescriptionSchema.optional(),
	startsAt: eventDateTimeSchema.optional(),
	endsAt: eventDateTimeSchema.nullable().optional(),
	allDay: z.boolean().optional(),
	location: eventLocationSchema.optional(),
	recurrence: eventRecurrenceSchema.optional(),
	// The version the form was opened on; a newer one means the series changed meanwhile
	// (an edit, or one date taken out of it).
	expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export const GET = withWgRoute<{ id: string }>('events GET id', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const limit = rateLimitResponse(
		await checkRateLimit(wgReadLimiter, `events:${clientIpKey(req)}`),
		'rate_limited',
	);
	if (limit) return limit;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rows = await db
		.select()
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const row = rows[0];
	if (!row) return notFound('event_not_found');
	return NextResponse.json({ event: serializeWgEvent(row) });
});

export const PATCH = withWgRoute<{ id: string }>('events PATCH', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const parsed = await parseBody(req, patchSchema, {
		fieldErrors: {
			title: 'title_invalid',
			startsAt: 'starts_at_invalid',
			endsAt: 'ends_at_invalid',
			description: 'description_invalid',
			location: 'location_invalid',
			recurrence: 'recurrence_invalid',
			expectedUpdatedAt: 'expected_state_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;

	const recurrenceInput = parsed.data.recurrence;
	const recurrence =
		recurrenceInput === undefined ? undefined : canonicalRecurrenceRule(recurrenceInput);
	const legacyByDayRule =
		recurrence?.ok === false && recurrenceInput !== undefined
			? parseRecurrenceRule(recurrenceInput)
			: null;
	const legacyByDayCandidate =
		legacyByDayRule?.byDay !== undefined && legacyByDayRule.freq !== 'WEEKLY';
	if (recurrence?.ok === false && !legacyByDayCandidate) return badRequest('recurrence_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const existing = await db
		.select({
			createdByMemberId: wgEvents.createdByMemberId,
			startsAt: wgEvents.startsAt,
			endsAt: wgEvents.endsAt,
			allDay: wgEvents.allDay,
			recurrence: wgEvents.recurrence,
			updatedAt: wgEvents.updatedAt,
		})
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const current = existing[0];
	if (!current) return notFound('event_not_found');
	const denied = await requireOwnerOrAdmin(wgId, auth.member, current.createdByMemberId);
	if (denied) return denied;

	const update: Omit<Partial<typeof wgEvents.$inferInsert>, 'updatedAt'> & { updatedAt: SQL } = {
		updatedAt: sql`greatest(clock_timestamp(), ${wgEvents.updatedAt} + interval '1 millisecond')`,
	};
	if (parsed.data.title !== undefined) update.title = parsed.data.title;
	if (parsed.data.description !== undefined) update.description = parsed.data.description;
	const allDay = parsed.data.allDay ?? current.allDay;
	// Turning a timed event into an all-day one without new dates keeps its Berlin dates.
	const switchedToAllDay = allDay && !current.allDay;
	const storedTime = (instant: Date) => eventInstant(berlinDayKey(instant), true);
	if (parsed.data.startsAt !== undefined) {
		update.startsAt = eventInstant(parsed.data.startsAt, allDay);
	} else if (switchedToAllDay) update.startsAt = storedTime(current.startsAt);
	if (parsed.data.endsAt !== undefined) {
		update.endsAt = parsed.data.endsAt ? eventInstant(parsed.data.endsAt, allDay) : null;
	} else if (switchedToAllDay && current.endsAt) update.endsAt = storedTime(current.endsAt);
	if (parsed.data.allDay !== undefined) update.allDay = parsed.data.allDay;
	if (parsed.data.location !== undefined) update.location = parsed.data.location;

	const effectiveStartsAt = update.startsAt ?? current.startsAt;
	const effectiveEndsAt = update.endsAt === undefined ? current.endsAt : update.endsAt;
	if (effectiveEndsAt && effectiveEndsAt.getTime() < effectiveStartsAt.getTime()) {
		return badRequest('ends_before_start');
	}

	let recurrenceToStore = recurrence?.ok ? recurrence.rule : undefined;
	if (legacyByDayCandidate) {
		const storedRule = current.recurrence ? parseRecurrenceRule(current.recurrence) : null;
		if (!storedRule?.byDay || storedRule.freq === 'WEEKLY' || !current.recurrence) {
			return badRequest('recurrence_invalid');
		}
		const shifted = shiftedSeriesRule(
			current.recurrence,
			current.startsAt.toISOString(),
			effectiveStartsAt,
			allDay,
			current.allDay,
		);
		if (!shifted || recurrenceInput !== shifted) return badRequest('recurrence_invalid');
		recurrenceToStore = shifted;
	}
	if (recurrenceToStore !== undefined) update.recurrence = recurrenceToStore;

	const expectedVersion = parsed.data.expectedUpdatedAt
		? new Date(parsed.data.expectedUpdatedAt)
		: legacyByDayCandidate
			? current.updatedAt
			: undefined;

	const [row] = await db
		.update(wgEvents)
		.set(update)
		.where(
			and(
				eq(wgEvents.id, id),
				eq(wgEvents.wgId, wgId),
				expectedVersion
					? sql`date_trunc('milliseconds', ${wgEvents.updatedAt}) = ${expectedVersion}`
					: undefined,
			),
		)
		.returning();
	if (!row) {
		const [stored] = await db
			.select()
			.from(wgEvents)
			.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
			.limit(1);
		if (!stored) return notFound('event_not_found');
		// The retry of a save whose answer got lost finds its own values in place.
		if (rowHoldsPatch(stored, { ...update, updatedAt: undefined })) {
			return NextResponse.json({ event: serializeWgEvent(stored) });
		}
		// Otherwise the version differed: someone saved or changed a date meanwhile.
		return conflict('event_changed');
	}

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'event.updated',
		entityType: 'wg_event',
		entityId: row.id,
		actorName: auth.member.name,
		metadata: {
			title: row.title,
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
		},
	});

	// Only a changed start or all-day flag counts as moved. Moves that end up in the past stay
	// silent; a series always counts.
	const moved =
		row.startsAt.getTime() !== current.startsAt.getTime() || row.allDay !== current.allDay;
	const stillRelevant =
		row.recurrence !== null ||
		eventRelevantUntil(row.startsAt.getTime(), row.endsAt?.getTime() ?? null, row.allDay) >=
			Date.now();
	if (moved && stillRelevant) {
		notifyEventChange('event.moved', {
			wg: { id: wgId, name: auth.wg.name, shareCode: code },
			actor: auth.member,
			eventId: row.id,
			title: row.title,
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
			recurring: row.recurrence !== null,
			affectedStarts:
				row.recurrence === null ? [current.startsAt.getTime(), row.startsAt.getTime()] : [],
		});
	}
	return NextResponse.json({ event: serializeWgEvent(row) });
});

export const DELETE = withWgRoute<{ id: string }>('events DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const existing = await db
		.select({
			createdByMemberId: wgEvents.createdByMemberId,
			title: wgEvents.title,
			startsAt: wgEvents.startsAt,
			endsAt: wgEvents.endsAt,
			allDay: wgEvents.allDay,
			recurrence: wgEvents.recurrence,
		})
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const row = existing[0];
	if (!row) return notFound('event_not_found');
	const denied = await requireOwnerOrAdmin(wgId, auth.member, row.createdByMemberId);
	if (denied) return denied;

	const result = await db
		.delete(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.returning({ id: wgEvents.id });
	if (result.length === 0) return notFound('event_not_found');

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'event.deleted',
		entityType: 'wg_event',
		entityId: id,
		actorName: auth.member.name,
		metadata: { title: row.title },
	});

	// Deleting a finished single event changes nothing for anyone; a series always counts.
	const until = eventRelevantUntil(
		row.startsAt.getTime(),
		row.endsAt?.getTime() ?? null,
		row.allDay,
	);
	if (row.recurrence !== null || until >= Date.now()) {
		notifyEventChange('event.cancelled', {
			wg: { id: wgId, name: auth.wg.name, shareCode: code },
			actor: auth.member,
			title: row.title,
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
			recurring: row.recurrence !== null,
			affectedStarts: row.recurrence === null ? [row.startsAt.getTime()] : [],
		});
	}
	return NextResponse.json({ deleted: true });
});
